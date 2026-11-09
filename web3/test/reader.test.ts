import assert from "node:assert/strict";
import { it } from "node:test";
import hre from "hardhat";
import { toHex, zeroHash } from "viem";
import { readRegistryAssertion, readRegistryAssertionFromClient, type RegistryReadClient } from "../src/reader.ts";

it("independent RPC reader derives suspended, active, retracted and expired status from one block snapshot", async () => {
  const { viem, networkHelpers } = await hre.network.create();
  const [owner, publisher] = await viem.getWalletClients();
  const client = await viem.getPublicClient();
  const registry = await viem.deployContract("ThreatRegistryV1", [owner.account.address]);
  const read = () => readRegistryAssertionFromClient(client, registry.address, publisher.account.address, "EXAMPLE.COM.");
  assert.equal((await read()).status, "missing");
  await registry.write.setPublisher([publisher.account.address, true]);
  await registry.write.publish(["example.com", 1, 3600n, 0, toHex(1, { size: 32 })], { account: publisher.account });
  const active = await read();
  assert.equal(active.status, "active");
  assert.equal(active.hostname, "example.com");
  assert.equal(active.epoch, 1n);
  assert.equal(active.revision, 1);
  assert.equal(active.finality, "included");
  assert.equal(active.blockHash.length, 66);
  await registry.write.suspendPublisher([publisher.account.address]);
  assert.equal((await read()).status, "suspended");
  await registry.write.setPublisher([publisher.account.address, true]);
  assert.equal((await read()).status, "missing");
  await registry.write.publish(["example.com", 2, 3600n, 0, toHex(2, { size: 32 })], { account: publisher.account });
  await registry.write.retract([publisher.account.address, active.indicatorId, 1, 1, toHex(3, { size: 32 })], { account: publisher.account });
  assert.equal((await read()).status, "retracted");
  await registry.write.publish(["example.com", 2, 3600n, 2, toHex(4, { size: 32 })], { account: publisher.account });
  await networkHelpers.time.increaseTo((await read()).expiresAt);
  assert.equal((await read()).status, "expired");
});

it("independent reader rejects a reorg during its snapshot and rejects non-testnet configuration before HTTP", async () => {
  const { viem } = await hre.network.create();
  const [owner, publisher] = await viem.getWalletClients();
  const client = await viem.getPublicClient();
  const registry = await viem.deployContract("ThreatRegistryV1", [owner.account.address]);
  // Real contract/RPC reads, with only the revalidation response changed to model a reorg.
  let blockReads = 0;
  const changingChain: RegistryReadClient = {
    readContract: client.readContract, getBytecode: client.getBytecode,
    getBlock: async args => {
      const block = await client.getBlock(args);
      return { ...block, hash: ++blockReads === 2 ? zeroHash : block.hash };
    },
  };
  await assert.rejects(readRegistryAssertionFromClient(changingChain, registry.address, publisher.account.address, "example.com"), /reorganization/);
  await assert.rejects(readRegistryAssertion({ chainId: 84532, address: registry.address, rpcUrl: "http://example.com", deploymentBlock: 0n }, publisher.account.address, "example.com"), /HTTPS Base Sepolia/);
});
