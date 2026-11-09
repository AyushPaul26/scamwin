import assert from "node:assert/strict";
import test from "node:test";
import { createPublisherHandler, type PublisherDependencies } from "../publisher/handler";

const dispatch = "d".repeat(64), cron = "c".repeat(64);
const env = { SCAMWIN_PUBLISHER_DISPATCH_SECRET: dispatch, CRON_SECRET: cron };
function fixture(kind: "publish_warning" | "retract_warning" = "publish_warning") {
  const calls: unknown[] = [];
  const dependencies: PublisherDependencies = {
    store: { async listPendingPublications(limit) { calls.push(["list", limit]); return [{ warningId: "approved", kind }, { warningId: "second", kind }]; } },
    async relayWarning(id) { calls.push(["publish", id]); return { status: "included", retry: true }; },
    async relayRetraction(id) { calls.push(["retract", id]); return { status: "submitted", retry: true }; },
  };
  const handler = createPublisherHandler({ env, async load() { calls.push("load"); return dependencies; } });
  return { calls, handler, dependencies };
}
test("missing/wrong auth and unsupported methods never load database or signer", async () => {
  const { handler, calls } = fixture();
  for (const [method, secret, status] of [["POST", "", 401], ["POST", cron, 401], ["GET", dispatch, 401], ["GET", "bad", 401], ["PUT", dispatch, 405]] as const) {
    const response = await handler(new Request("https://publisher.test/api/relay", { method, headers: { authorization: `Bearer ${secret}` } }));
    assert.equal(response.status, status);
  }
  assert.deepEqual(calls, []);
});
test("short or missing configured secrets fail closed before dependencies load", async () => {
  for (const secret of [undefined, "short"]) {
    let loaded = false;
    const handler = createPublisherHandler({ env: { SCAMWIN_PUBLISHER_DISPATCH_SECRET: secret }, async load() { loaded = true; throw Error("no"); } });
    assert.equal((await handler(new Request("https://publisher.test/api/relay", { method: "POST", headers: { authorization: `Bearer ${secret}` } }))).status, 503);
    assert.equal(loaded, false);
  }
});
test("POST ignores hostile body/query and relays only the first database operation", async () => {
  const { handler, calls } = fixture();
  const response = await handler(new Request("https://publisher.test/api/relay?warningId=attacker&to=0x123", { method: "POST", headers: { authorization: `Bearer ${dispatch}` }, body: JSON.stringify({ kind: "retract_warning", warningId: "attacker", calldata: "0x123" }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["load", ["list", 1], ["publish", "approved"]]);
  assert.deepEqual(await response.json(), { status: "included", retry: true, processed: 1 });
});
test("authenticated GET cron relays a database retraction", async () => {
  const { handler, calls } = fixture("retract_warning");
  assert.equal((await handler(new Request("https://publisher.test/api/relay", { headers: { authorization: `Bearer ${cron}` } }))).status, 200);
  assert.deepEqual(calls, ["load", ["list", 1], ["retract", "approved"]]);
});
test("empty queue returns idle without relay", async () => {
  const { handler, calls, dependencies } = fixture();
  dependencies.store.listPendingPublications = async () => [];
  assert.deepEqual(await (await handler(new Request("https://publisher.test/api/relay", { method: "POST", headers: { authorization: `Bearer ${dispatch}` } }))).json(), { status: "idle", processed: 0 });
  assert.deepEqual(calls, ["load"]);
});
test("dependency exceptions and unexpected relay data never leak details", async () => {
  const secret = "private-key-and-database-url";
  for (const failure of ["load", "list", "relay", "result"]) {
    const { dependencies } = fixture();
    if (failure === "list") dependencies.store.listPendingPublications = async () => { throw Error(secret); };
    if (failure === "relay") dependencies.relayWarning = async () => { throw Error(secret); };
    if (failure === "result") dependencies.relayWarning = async () => ({ status: secret, retry: false });
    const handler = createPublisherHandler({ env, async load() { if (failure === "load") throw Error(secret); return dependencies; } });
    const response = await handler(new Request("https://publisher.test/api/relay", { method: "POST", headers: { authorization: `Bearer ${dispatch}` } }));
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes(secret), false);
  }
});
