import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { registryAbi } from "../lib/scamwin/registry-abi";

// Public, deterministic fixture key only; no environment files or live RPCs are used.
const owner = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const registry = "0x1111111111111111111111111111111111111111";
const publisher = "0x2222222222222222222222222222222222222222";
const env = {
  REGISTRY_CHAIN_ID: "84532", BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  REGISTRY_DEPLOYER_PRIVATE_KEY: `0x${"0".repeat(63)}1`, REGISTRY_OWNER_ADDRESS: owner,
  REGISTRY_CONTRACT_ADDRESS: registry, REGISTRY_PUBLISHER_ADDRESS: publisher,
};
const execute = ["--execute-base-sepolia"];

async function helper() {
  const module = await import("../web3/scripts/activate-publisher.js").catch(() => null);
  assert.ok(module?.activatePublisher && module?.preparePublisherActivation, "Deliberate publisher activation helper is required");
  return module;
}

function fixture(options: { chain?: number; contractOwner?: string; code?: string; l1Fee?: bigint; operatorFee?: bigint; active?: boolean; receipt?: string } = {}) {
  const writes: Record<string, unknown>[] = [];
  const estimates: Record<string, unknown>[] = [];
  let wallets = 0;
  const client = {
    getChainId: async () => options.chain ?? 84532,
    getBytecode: async () => (options.code ?? "0x6000") as Hex,
    getOwner: async () => (options.contractOwner ?? owner) as Address,
    getPublisherConfig: async () => [writes.length ? options.active ?? true : false, 1n] as const,
    estimateGas: async (request: Record<string, unknown>) => { estimates.push(request); return 100_000n; },
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100n }),
    estimateL1Fee: async () => options.l1Fee ?? 100n,
    estimateOperatorFee: async () => options.operatorFee ?? 100n,
    getTransactionCount: async (request: { blockTag: string }) => { assert.equal(request.blockTag, "pending"); return 7; },
    waitForTransactionReceipt: async () => ({ status: options.receipt ?? "success", blockNumber: 123n }),
  };
  const deps = {
    createPublicClient: () => client,
    createWalletClient: () => { wallets++; return { writeContract: async (request: Record<string, unknown>) => { writes.push(request); return `0x${"ab".repeat(32)}` as Hex; } }; },
  };
  return { deps, writes, estimates, wallets: () => wallets };
}

test("activation requires explicit execution before RPC or wallet creation", async () => {
  const { activatePublisher } = await helper();
  await assert.rejects(activatePublisher(env, [], {
    createPublicClient: () => { throw Error("RPC must not be constructed"); },
    createWalletClient: () => { throw Error("Wallet must not be constructed"); },
  }), /Explicit execution flag/);
});

test("read-only activation proposal has exact destination, calldata, bounded OP fees and no key", async () => {
  const { preparePublisherActivation } = await helper();
  const fake = fixture();
  const proposal = await preparePublisherActivation(env, fake.deps);
  assert.equal(fake.wallets(), 0);
  assert.equal(fake.writes.length, 0);
  assert.equal(proposal.chainId, 84532);
  assert.equal(proposal.contract, registry);
  assert.equal(proposal.publisher, publisher);
  assert.equal(proposal.owner, owner);
  assert.equal(proposal.gas, 120_000n);
  assert.equal(proposal.maximumFeeWei, 120_000_000_400n);
  assert.equal(proposal.maxFeeWei, 1_000_000_000_000_000n);
  assert.equal(proposal.value, 0n);
  assert.deepEqual(decodeFunctionData({ abi: registryAbi, data: proposal.data }), { functionName: "setPublisher", args: [publisher, true] });
  assert.equal("privateKey" in proposal, false);
});

test("activation chain, owner, bytecode and total fee guards run before signing", async () => {
  const { activatePublisher } = await helper();
  for (const [change, options, message] of [
    [{ REGISTRY_CHAIN_ID: "1" }, {}, /Base Sepolia/],
    [{}, { chain: 1 }, /chain mismatch/],
    [{ REGISTRY_OWNER_ADDRESS: "0x3333333333333333333333333333333333333333" }, {}, /key.*owner/i],
    [{}, { contractOwner: publisher }, /contract owner/i],
    [{}, { code: "0x" }, /bytecode/],
    [{}, { l1Fee: 1_000_000_000_000_000n }, /fee cap/],
    [{}, { operatorFee: 1_000_000_000_000_000n }, /fee cap/],
    [{ BASE_SEPOLIA_RPC_URL: "http://sepolia.base.org" }, {}, /HTTPS/],
    [{ BASE_SEPOLIA_RPC_URL: "https://secret@sepolia.base.org" }, {}, /credentials/],
    [{ REGISTRY_PUBLISHER_ADDRESS: "0x0000000000000000000000000000000000000000" }, {}, /publisher/i],
    [{ REGISTRY_CONTRACT_ADDRESS: "" }, {}, /contract/i],
    [{ REGISTRY_MAX_FEE_WEI: "1000000000000001" }, {}, /fee cap/],
  ] as const) {
    const fake = fixture(options);
    await assert.rejects(activatePublisher({ ...env, ...change }, execute, fake.deps), message);
    assert.equal(fake.wallets(), 0);
    assert.equal(fake.writes.length, 0);
  }
});

test("approved activation sends exactly one zero-value owner transaction with pending nonce", async () => {
  const { activatePublisher } = await helper();
  const fake = fixture();
  const result = await activatePublisher(env, execute, fake.deps);
  assert.equal(fake.wallets(), 1);
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.writes[0].address, registry);
  assert.equal(fake.writes[0].functionName, "setPublisher");
  assert.deepEqual(fake.writes[0].args, [publisher, true]);
  assert.equal(fake.writes[0].value, 0n);
  assert.equal(fake.writes[0].nonce, 7);
  assert.equal(fake.writes[0].gas, 120_000n);
  assert.equal(result.finality, "included");
  assert.equal(result.publisherActive, true);
});

test("failed receipt or inactive publisher never retries a transaction", async () => {
  const { activatePublisher } = await helper();
  for (const options of [{ receipt: "reverted" }, { active: false }]) {
    const fake = fixture(options);
    await assert.rejects(activatePublisher(env, execute, fake.deps), /Activation/);
    assert.equal(fake.writes.length, 1);
  }
});

test("import is inert and CLI refusal prints no supplied secrets", async () => {
  await helper();
  const result = spawnSync(process.execPath, ["--import", "tsx", "web3/scripts/activate-publisher.ts"], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test", REGISTRY_DEPLOYER_PRIVATE_KEY: "never-print-activation-secret" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Explicit execution flag/);
  assert.doesNotMatch(result.stdout + result.stderr, /never-print-activation-secret/);
});
