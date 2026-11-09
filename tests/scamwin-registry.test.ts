import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupRegistry, registryAvailability, type RegistryRpc } from "../lib/scamwin/registry";

const env = {
  SCAMWIN_REGISTRY_CHAIN_ID: "84532", SCAMWIN_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000001",
  SCAMWIN_REGISTRY_PUBLISHER: "0x0000000000000000000000000000000000000002",
};
const hash = `0x${"ab".repeat(32)}` as const;
function client(overrides: { enabled?: boolean; epoch?: bigint; retracted?: boolean; expiresAt?: bigint; timestamp?: bigint; chainId?: number } = {}) {
  return {
    getChainId: async () => overrides.chainId ?? 84532,
    getBlock: async () => ({ number: 100n, hash, timestamp: overrides.timestamp ?? 1000n }),
    getBytecode: async () => "0x6000",
    readContract: async (args: { functionName: string; args?: readonly unknown[]; blockNumber: bigint }) => {
      assert.equal(args.blockNumber, 100n);
      if (args.functionName === "VERSION") return 1;
      if (args.functionName === "publisherConfig") return [overrides.enabled ?? true, overrides.epoch ?? 2n];
      assert.equal(args.functionName, "getAssertion");
      assert.equal(args.args?.[1], overrides.epoch ?? 2n);
      return { revision: 1, issuedAt: 900n, expiresAt: overrides.expiresAt ?? 2000n, category: 2, retracted: overrides.retracted ?? false };
    },
  } as unknown as RegistryRpc;
}

test("missing registry config is explicit and never turns reviewed local warnings into chain evidence", async () => {
  const result = await lookupRegistry("example.com", { env: {} });
  assert.equal(result.status, "unconfigured"); assert.deepEqual(result.warnings, []);
  assert.equal(registryAvailability({}).status, "unconfigured");
});

test("registry trusts only configured issuer current epoch and derives suspension/retraction/expiry", async () => {
  for (const [overrides, active] of [[{}, true], [{ enabled: false }, false], [{ retracted: true }, false], [{ expiresAt: 1000n }, false]] as const) {
    const result = await lookupRegistry("EXAMPLE.COM.", { env, client: client(overrides), now: new Date(1_010_000) });
    assert.equal(result.status, "ready");
    assert.equal(result.warnings[0].active, active);
    assert.equal(result.warnings[0].fresh, true);
    assert.equal(result.warnings[0].trusted, true);
    assert.equal(result.warnings[0].publisher.toLowerCase(), env.SCAMWIN_REGISTRY_PUBLISHER);
  }
});

test("old chain timestamps are stale and a wrong chain cannot become a trusted warning", async () => {
  const stale = await lookupRegistry("example.com", { env, client: client(), now: new Date(1_061_000) });
  assert.equal(stale.status, "stale"); assert.equal(stale.warnings[0].fresh, false);
  const wrong = await lookupRegistry("example.com", { env, client: client({ chainId: 8453 }), now: new Date(1_010_000) });
  assert.equal(wrong.status, "unavailable"); assert.deepEqual(wrong.warnings, []);
});
