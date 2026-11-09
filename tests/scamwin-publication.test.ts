import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, keccak256, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MemoryStore } from "../lib/scamwin/store";
import { relayWarning, relayRetraction, type RelayRpc } from "../lib/scamwin/publication";
import { threatRegistryAbi } from "../lib/scamwin/registry-abi";

const key = `0x${"11".repeat(32)}` as Hex; // Synthetic, public test fixture. Never funded.
const account = privateKeyToAccount(key);
const now = new Date("2026-11-08T12:00:00Z");
const env = { SCAMWIN_REGISTRY_CHAIN_ID: "84532", SCAMWIN_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000001", SCAMWIN_REGISTRY_PUBLISHER: account.address, SCAMWIN_PUBLISHER_PRIVATE_KEY: key };
const blockHash = `0x${"ab".repeat(32)}` as Hex;
async function fixture() {
  const store = new MemoryStore({ now: () => now, initialRoles: [{ ownerId: "reviewer", role: "reviewer" }] });
  const check = await store.createCheck("alice", { url: "https://example.com", message: "An offer", promisedBenefit: "Refund", intendedAction: "Receive money", images: [] }, "one");
  await store.saveObservation("alice", { id: "e1", checkId: check.id, runId: check.runId, kind: "origin", status: "observed", sourceKind: "origin_probe", sourceRef: "https://example.com", observedAt: now.toISOString(), data: { fixture: true }, collectorVersion: "1", policyVersion: "1" });
  const w = await store.submitWarning("alice", { checkId: check.id, hostname: "example.com", summary: "Reviewed synthetic domain-wide warning.", category: "payment", evidenceIds: ["e1"], consent: true });
  await store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Reviewed synthetic evidence", expectedRevision: 1 });
  return { store, warning: (await store.getWarning(w.id))! };
}
function rpc(options: { assertionRevision?: number; finalizedBlock?: bigint; chainId?: number; maxFeePerGas?: bigint } = {}) {
  let nonceReads = 0, broadcasts = 0, timeout = true, receipt: { transactionHash: Hex; blockNumber: bigint; blockHash: Hex; status: "success" | "reverted" } | undefined;
  let onBroadcast: (raw: Hex) => Promise<void> = async () => {};
  const client = {
    getChainId: async () => options.chainId ?? 84532,
    getBlock: async (args: { blockTag?: string }) => ({ number: args.blockTag === "finalized" ? options.finalizedBlock ?? 98n : args.blockTag === "safe" ? 99n : 100n, hash: blockHash, timestamp: BigInt(now.getTime() / 1000) }),
    getBytecode: async () => "0x6000",
    readContract: async ({ functionName }: { functionName: string }) => functionName === "VERSION" ? 1 : functionName === "issuancePaused" ? false : functionName === "publisherConfig" ? [true, 1n] : { revision: options.assertionRevision ?? 0, issuedAt: 0n, expiresAt: 0n, category: 0, retracted: false },
    simulateContract: async () => ({}),
    estimateGas: async () => 180000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: options.maxFeePerGas ?? 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateL1Fee: async () => 1000n,
    estimateOperatorFee: async (args: { account: string; to: string; data: Hex; gas: bigint }) => {
      assert.equal(args.account.toLowerCase(), account.address.toLowerCase());
      assert.equal(args.to.toLowerCase(), env.SCAMWIN_REGISTRY_ADDRESS);
      assert.ok(args.data.startsWith("0x")); assert.ok(args.gas > 0n);
      return 0n;
    },
    getTransactionCount: async () => { nonceReads++; return 7; },
    getTransactionReceipt: async () => { if (!receipt) throw Error("not found"); return receipt; },
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => { broadcasts++; await onBroadcast(serializedTransaction); if (timeout) throw Error("uncertain timeout"); return keccak256(serializedTransaction); },
  };
  return { client: client as unknown as RelayRpc, get nonceReads() { return nonceReads; }, get broadcasts() { return broadcasts; }, set timeout(value: boolean) { timeout = value; }, set onBroadcast(value: typeof onBroadcast) { onBroadcast = value; }, set receipt(value: typeof receipt) { receipt = value; } };
}

test("unconfigured publication returns without loading store or signing", async () => {
  assert.equal((await relayWarning("missing", { env: {} })).status, "unconfigured");
});

test("relay persists signed raw bytes before broadcast and replays identical bytes after timeout without a new nonce", async () => {
  const { store, warning } = await fixture(); const transport = rpc(); const raws: Hex[] = [];
  transport.onBroadcast = async raw => {
    const persisted = await store.getPublication(warning.id, warning.revision);
    assert.equal(persisted?.signedRawTransaction, raw);
    assert.equal(persisted?.transactionHash, keccak256(raw));
    raws.push(raw);
  };
  const first = await relayWarning(warning.id, { env, store, client: transport.client, now });
  assert.equal(first.status, "uncertain");
  transport.timeout = false;
  const second = await relayWarning(warning.id, { env, store, client: transport.client, now });
  assert.equal(second.status, "submitted");
  assert.equal(transport.nonceReads, 1); assert.equal(transport.broadcasts, 2); assert.equal(raws[0], raws[1]);
  const parsed = parseTransaction(raws[0]);
  assert.equal(parsed.chainId, 84532); assert.equal(parsed.nonce, 7); assert.equal(parsed.value ?? 0n, 0n);
  const decoded = decodeFunctionData({ abi: threatRegistryAbi, data: parsed.data! });
  assert.equal(decoded.functionName, "publish");
  assert.equal(decoded.args?.[0], "example.com"); assert.equal(decoded.args?.[2], 604800n);
});

test("an included receipt remains included until safe/finalized and never causes a second broadcast", async () => {
  const { store, warning } = await fixture(); const transport = rpc(); transport.timeout = false;
  await relayWarning(warning.id, { env, store, client: transport.client, now });
  const p = (await store.getPublication(warning.id, warning.revision))!;
  transport.receipt = { transactionHash: p.transactionHash as Hex, blockNumber: 100n, blockHash, status: "success" };
  const result = await relayWarning(warning.id, { env, store, client: transport.client, now });
  assert.equal(result.status, "included"); assert.equal(result.retry, true);
  assert.equal(transport.broadcasts, 1); assert.equal(transport.nonceReads, 1);
});

test("only one concurrent lease signs and a rejected durable write cannot broadcast", async () => {
  const { store, warning } = await fixture(); const transport = rpc(); transport.timeout = false;
  const results = await Promise.all([relayWarning(warning.id, { env, store, client: transport.client, now }), relayWarning(warning.id, { env, store, client: transport.client, now })]);
  assert.deepEqual(results.map(r => r.status).sort(), ["busy", "submitted"]);
  assert.equal(transport.nonceReads, 1); assert.equal(transport.broadcasts, 1);
  const other = await fixture(), unavailable = rpc();
  const rejectingStore = new Proxy(other.store, { get(target, property) {
    if (property === "updatePublication") return async () => null;
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await relayWarning(other.warning.id, { env, store: rejectingStore, client: unavailable.client, now })).status, "unavailable");
  assert.equal(unavailable.broadcasts, 0);
  assert.equal((await other.store.getPublication(other.warning.id, other.warning.revision))?.signedRawTransaction, undefined);
});

test("fee caps and wrong-chain RPC refuse to sign or broadcast without a paid fallback", async () => {
  for (const options of [{ maxFeePerGas: 100_000_000_000n }, { chainId: 8453 }]) {
    const { store, warning } = await fixture(), transport = rpc(options);
    assert.equal((await relayWarning(warning.id, { env, store, client: transport.client, now })).status, "unavailable");
    assert.equal(transport.nonceReads, 0); assert.equal(transport.broadcasts, 0);
    assert.equal((await store.getPublication(warning.id, warning.revision))?.signedRawTransaction, undefined);
  }
});

test("confirmed finality releases the operation and reviewed retraction signs only its bounded correction call", async () => {
  const { store, warning } = await fixture(), transport = rpc({ finalizedBlock: 100n }); transport.timeout = false;
  await relayWarning(warning.id, { env, store, client: transport.client, now });
  const p = (await store.getPublication(warning.id, warning.revision))!;
  transport.receipt = { transactionHash: p.transactionHash as Hex, blockNumber: 100n, blockHash, status: "success" };
  const finalized = await relayWarning(warning.id, { env, store, client: transport.client, now });
  assert.equal(finalized.status, "finalized"); assert.equal(finalized.retry, false);
  await store.retractWarning("reviewer", warning.id, { reason: "Reviewed correction", expectedRevision: warning.revision });
  const correction = rpc({ assertionRevision: 1 }); correction.timeout = false;
  correction.onBroadcast = async raw => {
    const tx = parseTransaction(raw), decoded = decodeFunctionData({ abi: threatRegistryAbi, data: tx.data! });
    assert.equal(decoded.functionName, "retract");
    assert.equal(decoded.args?.[0].toLowerCase(), account.address.toLowerCase());
    assert.equal(decoded.args?.[2], 1);
  };
  assert.equal((await relayRetraction(warning.id, { env, store, client: correction.client, now })).status, "submitted");
});
