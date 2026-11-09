import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hre from "hardhat";
import { encodeAbiParameters, keccak256, toHex, zeroHash, decodeEventLog } from "viem";

const { viem, networkHelpers } = await hre.network.create();
const wallets = await viem.getWalletClients();
const [owner, publisher, second, guardian, outsider] = wallets;
const publicClient = await viem.getPublicClient();
const id = keccak256(encodeAbiParameters([{ type: "uint16" }, { type: "uint8" }, { type: "string" }], [1, 1, "example.com"]));
let sequence = 0;
const op = () => toHex(++sequence, { size: 32 });
async function fixture() {
  // Dynamic ABI until the first build generates Hardhat's contract type augmentation.
  const registry: any = await viem.deployContract("ThreatRegistryV1", [owner.account.address]);
  await registry.write.setPublisher([publisher.account.address, true]);
  await registry.write.setGuardian([guardian.account.address, true]);
  return registry;
}
const publish = (r: any, overrides: { category?: number; ttl?: bigint; revision?: number; operation?: `0x${string}`; hostname?: string; wallet?: typeof publisher } = {}) => r.write.publish([
  overrides.hostname ?? "example.com", overrides.category ?? 1, overrides.ttl ?? 3600n, overrides.revision ?? 0, overrides.operation ?? op(),
], { account: (overrides.wallet ?? publisher).account });

describe("ThreatRegistryV1", () => {
  it("publishes issuer-attributed state and independently decodable versioned event", async () => {
    const r = await fixture();
    const operation = op();
    const hash = await publish(r, { operation });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const record = await r.read.getAssertion([publisher.account.address, 1n, id]);
    assert.equal(record.revision, 1);
    assert.equal(record.expiresAt - record.issuedAt, 3600n);
    assert.equal(record.category, 1);
    assert.equal(record.retracted, false);
    assert.equal(await r.read.isActive([publisher.account.address, 1n, id]), true);
    assert.equal(await r.read.indicatorId(["example.com"]), id);
    const event: any = decodeEventLog({ abi: r.abi, data: receipt.logs[0].data, topics: receipt.logs[0].topics });
    assert.equal(event.eventName, "AssertionPublished");
    assert.equal(event.args.version, 1);
    assert.equal(event.args.publisher.toLowerCase(), publisher.account.address);
    assert.equal(event.args.operationId, operation);
    assert.equal(event.args.indicator, id);
    assert.equal(event.args.hostname, "example.com");
    assert.equal(event.args.expiresAt, record.expiresAt);
  });

  it("rejects stale revisions and replay across publish/retract and activation epochs", async () => {
    const r = await fixture(); const operation = op();
    await publish(r, { operation });
    await assert.rejects(publish(r, { revision: 0 }), /RevisionConflict/);
    await assert.rejects(publish(r, { revision: 1, operation }), /OperationAlreadyUsed/);
    await assert.rejects(r.write.retract([publisher.account.address, id, 1, 1, operation], { account: publisher.account }), /OperationAlreadyUsed/);
    await publish(r, { revision: 1, category: 2 });
    assert.equal((await r.read.getAssertion([publisher.account.address, 1n, id])).revision, 2);
    await r.write.suspendPublisher([publisher.account.address], { account: guardian.account });
    await r.write.setPublisher([publisher.account.address, true]);
    await assert.rejects(publish(r, { operation }), /OperationAlreadyUsed/);
  });

  it("isolates publishers and invalidates old epochs permanently on re-enable", async () => {
    const r = await fixture();
    await r.write.setPublisher([second.account.address, true]);
    await publish(r); await publish(r, { wallet: second, category: 2 });
    await r.write.setPublisher([publisher.account.address, true]);
    assert.deepEqual(await r.read.publisherConfig([publisher.account.address]), [true, 1n]);
    await r.write.suspendPublisher([publisher.account.address], { account: guardian.account });
    assert.equal(await r.read.isActive([publisher.account.address, 1n, id]), false);
    assert.equal(await r.read.isActive([second.account.address, 1n, id]), true);
    await r.write.setPublisher([publisher.account.address, true]);
    assert.deepEqual(await r.read.publisherConfig([publisher.account.address]), [true, 2n]);
    assert.equal(await r.read.isActive([publisher.account.address, 1n, id]), false);
    await publish(r);
    assert.equal(await r.read.isActive([publisher.account.address, 2n, id]), true);
    assert.equal((await r.read.getAssertion([publisher.account.address, 1n, id])).revision, 1);
  });

  it("bounds TTL/category/reason and expires at chain time without expiry transaction", async () => {
    const r = await fixture();
    for (const ttl of [0n, 3599n, 2592001n]) await assert.rejects(publish(r, { ttl }), /InvalidTtl/);
    for (const category of [0, 9, 255]) await assert.rejects(publish(r, { category }), /InvalidCategory/);
    await publish(r);
    const record = await r.read.getAssertion([publisher.account.address, 1n, id]);
    await networkHelpers.time.increaseTo(record.expiresAt);
    assert.equal(await r.read.isActive([publisher.account.address, 1n, id]), false);
    await publish(r, { ttl: 2592000n, revision: 1 });
    await assert.rejects(r.write.retract([publisher.account.address, id, 2, 0, op()], { account: publisher.account }), /InvalidReason/);
    await assert.rejects(r.write.retract([publisher.account.address, id, 2, 9, op()], { account: publisher.account }), /InvalidReason/);
  });

  it("keeps reads, suspension and corrections available while issuance is paused", async () => {
    const r = await fixture(); await publish(r);
    await r.write.pauseIssuance({ account: guardian.account });
    await assert.rejects(publish(r, { revision: 1 }), /IssuancePaused/);
    assert.equal(await r.read.isActive([publisher.account.address, 1n, id]), true);
    const hash = await r.write.retract([publisher.account.address, id, 1, 1, op()], { account: publisher.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const event: any = decodeEventLog({ abi: r.abi, data: receipt.logs[0].data, topics: receipt.logs[0].topics });
    assert.equal(event.eventName, "AssertionRetracted");
    assert.equal(event.args.revision, 2);
    assert.equal(await r.read.isActive([publisher.account.address, 1n, id]), false);
    await assert.rejects(r.write.resumeIssuance({ account: guardian.account }), /OwnableUnauthorizedAccount/);
    await r.write.suspendPublisher([publisher.account.address], { account: guardian.account });
    await r.write.resumeIssuance();
  });

  it("enforces roles and two-step ownership without giving guardians publication rights", async () => {
    const r = await fixture();
    await assert.rejects(publish(r, { wallet: guardian }), /PublisherDisabled/);
    await assert.rejects(publish(r, { wallet: outsider }), /PublisherDisabled/);
    await assert.rejects(r.write.setPublisher([outsider.account.address, true], { account: guardian.account }), /OwnableUnauthorizedAccount/);
    await assert.rejects(r.write.pauseIssuance({ account: outsider.account }), /Unauthorized/);
    await assert.rejects(r.write.suspendPublisher([publisher.account.address], { account: outsider.account }), /Unauthorized|0x82b42900/);
    await publish(r);
    await assert.rejects(r.write.retract([publisher.account.address, id, 1, 1, op()], { account: second.account }), /Unauthorized|0x82b42900/);
    await r.write.transferOwnership([second.account.address]);
    assert.equal((await r.read.owner()).toLowerCase(), owner.account.address);
    await assert.rejects(r.write.acceptOwnership({ account: outsider.account }), /OwnableUnauthorizedAccount/);
    await r.write.acceptOwnership({ account: second.account });
    assert.equal((await r.read.owner()).toLowerCase(), second.account.address);
    await r.write.retract([publisher.account.address, id, 1, 2, op()], { account: guardian.account });
    assert.equal((await r.read.getAssertion([publisher.account.address, 1n, id])).retracted, true);
  });

  it("rejects noncanonical/private hostname inputs and zero operations before storing", async () => {
    const r = await fixture();
    for (const hostname of ["", "Example.com", "example.com.", "https://example.com", "a@b.com", "a.com:443", "a.com/", "a.com?x=1", "a.com#x", "a..com", "-a.com", "a-.com", "a_local.com", "bücher.de", "127.0.0.1", "localhost", "a.local", "a.test", "a.internal", "a.invalid", "a." + "b".repeat(64)]) {
      await assert.rejects(publish(r, { hostname }), /InvalidHostname/, hostname);
    }
    await assert.rejects(publish(r, { operation: zeroHash }), /InvalidOperationId/);
  });

  it("allows a suspended publisher to retract and prevents duplicate/nonexistent retraction", async () => {
    const r = await fixture();
    await assert.rejects(r.write.retract([publisher.account.address, id, 0, 1, op()], { account: publisher.account }), /AssertionMissing/);
    await publish(r);
    await r.write.suspendPublisher([publisher.account.address], { account: guardian.account });
    await r.write.retract([publisher.account.address, id, 1, 3, op()], { account: publisher.account });
    await assert.rejects(r.write.retract([publisher.account.address, id, 2, 3, op()], { account: publisher.account }), /AlreadyRetracted/);
  });
});
