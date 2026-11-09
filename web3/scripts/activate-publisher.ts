import { pathToFileURL } from "node:url";
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { publicActionsL2 } from "viem/op-stack";
import { registryAbi } from "../../lib/scamwin/registry-abi.js";

type Environment = Record<string, string | undefined>;
type EstimateRequest = { account: Address; to: Address; data: Hex; value: 0n };
type ActivationWrite = {
  account: PrivateKeyAccount; chain: typeof baseSepolia; address: Address; abi: typeof registryAbi;
  functionName: "setPublisher"; args: readonly [Address, true]; value: 0n; gas: bigint;
  maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; nonce: number;
};
export type ActivationPublicClient = {
  getChainId(): Promise<number>;
  getBytecode(request: { address: Address }): Promise<Hex | undefined>;
  getOwner(address: Address): Promise<Address>;
  getPublisherConfig(address: Address, publisher: Address, blockNumber?: bigint): Promise<readonly [boolean, bigint]>;
  estimateGas(request: EstimateRequest): Promise<bigint>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  estimateL1Fee(request: EstimateRequest): Promise<bigint>;
  estimateOperatorFee(request: EstimateRequest & { gas: bigint }): Promise<bigint>;
  getTransactionCount(request: { address: Address; blockTag: "pending" }): Promise<number>;
  waitForTransactionReceipt(request: { hash: Hex; timeout: number }): Promise<{ status: string; blockNumber: bigint }>;
};
export type ActivationDependencies = {
  createPublicClient?: (rpcUrl: string) => ActivationPublicClient;
  createWalletClient?: (rpcUrl: string, account: PrivateKeyAccount) => { writeContract(request: ActivationWrite): Promise<Hex> };
  /** Persist or display the public hash immediately, before waiting. Never retry automatically. */
  onBroadcast?: (hash: Hex) => void;
};
const HARD_FEE_CAP_WEI = 1_000_000_000_000_000n; // 0.001 Base Sepolia TEST ETH only.

function transport(rpcUrl: string) {
  return http(rpcUrl, { timeout: 15_000, retryCount: 0, fetchOptions: { redirect: "error" } });
}

function publicClient(rpcUrl: string): ActivationPublicClient {
  const client = createPublicClient({ chain: baseSepolia, transport: transport(rpcUrl) }).extend(publicActionsL2());
  return {
    getChainId: () => client.getChainId(),
    getBytecode: (request) => client.getBytecode(request),
    getOwner: (address) => client.readContract({ address, abi: registryAbi, functionName: "owner" }),
    getPublisherConfig: (address, publisher, blockNumber) => client.readContract({ address, abi: registryAbi, functionName: "publisherConfig", args: [publisher], blockNumber }),
    estimateGas: (request) => client.estimateGas(request),
    estimateFeesPerGas: () => client.estimateFeesPerGas(),
    estimateL1Fee: (request) => client.estimateL1Fee(request),
    estimateOperatorFee: (request) => client.estimateOperatorFee(request),
    getTransactionCount: (request) => client.getTransactionCount(request),
    waitForTransactionReceipt: (request) => client.waitForTransactionReceipt(request),
  };
}

function walletClient(rpcUrl: string, account: PrivateKeyAccount) {
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: transport(rpcUrl) });
  return { writeContract: (request: ActivationWrite) => {
    const { value, ...parameters } = request;
    if (value !== 0n) throw new Error("Activation must use zero value");
    // Nonpayable ABI types require value to be omitted; viem sends zero ETH.
    return wallet.writeContract(parameters);
  } };
}

function address(value: string | undefined, label: string): Address {
  if (!value || !isAddress(value) || getAddress(value) === zeroAddress) throw new Error(`Nonzero valid registry ${label} address required`);
  return getAddress(value);
}

function config(env: Environment) {
  if (env.REGISTRY_CHAIN_ID !== "84532") throw new Error("Only Base Sepolia (84532) is supported");
  let rpc: URL;
  try { rpc = new URL(env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"); }
  catch { throw new Error("Valid HTTPS RPC required"); }
  if (rpc.protocol !== "https:") throw new Error("HTTPS RPC required");
  if (rpc.username || rpc.password || rpc.hash) throw new Error("RPC URL credentials and fragments are forbidden");
  const owner = address(env.REGISTRY_OWNER_ADDRESS, "owner");
  const contract = address(env.REGISTRY_CONTRACT_ADDRESS, "contract");
  const publisher = address(env.REGISTRY_PUBLISHER_ADDRESS, "publisher");
  if (publisher === owner || publisher === contract) throw new Error("Dedicated publisher must differ from owner and contract");
  const privateKey = env.REGISTRY_DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-f]{64}$/i.test(privateKey)) throw new Error("Valid registry owner private key required");
  let account: PrivateKeyAccount;
  try { account = privateKeyToAccount(privateKey as Hex); }
  catch { throw new Error("Valid registry owner private key required"); }
  if (account.address !== owner) throw new Error("Private key does not match registry owner");
  const cap = env.REGISTRY_MAX_FEE_WEI;
  if (cap !== undefined && !/^[1-9][0-9]*$/.test(cap)) throw new Error("Invalid test ETH fee cap");
  const maxFeeWei = cap === undefined ? HARD_FEE_CAP_WEI : BigInt(cap);
  if (maxFeeWei > HARD_FEE_CAP_WEI) throw new Error("Test ETH fee cap cannot exceed 0.001");
  return { owner, contract, publisher, account, rpcUrl: rpc.href, maxFeeWei };
}

async function preflight(env: Environment, dependencies: ActivationDependencies) {
  const settings = config(env);
  const client = (dependencies.createPublicClient ?? publicClient)(settings.rpcUrl);
  if (await client.getChainId() !== 84532) throw new Error("RPC chain mismatch; refusing activation");
  const code = await client.getBytecode({ address: settings.contract });
  if (!code || code === "0x") throw new Error("Registry bytecode missing");
  if (getAddress(await client.getOwner(settings.contract)) !== settings.owner) throw new Error("Registry contract owner mismatch");
  const [enabled] = await client.getPublisherConfig(settings.contract, settings.publisher);
  if (enabled) throw new Error("Publisher already active; refusing duplicate activation");
  const data = encodeFunctionData({ abi: registryAbi, functionName: "setPublisher", args: [settings.publisher, true] });
  const request = { account: settings.owner, to: settings.contract, data, value: 0n } as const;
  const estimated = await client.estimateGas(request);
  const gas = (estimated * 120n + 99n) / 100n;
  const fees = await client.estimateFeesPerGas();
  const [l1Fee, operatorFee] = await Promise.all([
    client.estimateL1Fee(request), client.estimateOperatorFee({ ...request, gas }),
  ]);
  if (estimated <= 0n || fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas < 0n || fees.maxPriorityFeePerGas > fees.maxFeePerGas || l1Fee < 0n || operatorFee < 0n) throw new Error("Invalid activation fee estimate");
  const maximumFeeWei = gas * fees.maxFeePerGas + 2n * (l1Fee + operatorFee);
  if (maximumFeeWei > settings.maxFeeWei) throw new Error("Activation exceeds test ETH fee cap");
  const nonce = await client.getTransactionCount({ address: settings.owner, blockTag: "pending" });
  const proposal = {
    chainId: 84532 as const, network: "Base Sepolia TESTNET", owner: settings.owner,
    contract: settings.contract, publisher: settings.publisher, value: 0n, data, gas, ...fees,
    l1Fee, operatorFee, maximumFeeWei, maxFeeWei: settings.maxFeeWei, nonce,
  };
  return { settings, client, proposal };
}

/** Read-only proposal. Derives the owner locally, but never creates a signing wallet or broadcasts. */
export async function preparePublisherActivation(env: Environment, dependencies: ActivationDependencies = {}) {
  return (await preflight(env, dependencies)).proposal;
}

/** One deliberate owner transaction. Importing this module never executes it. */
export async function activatePublisher(env: Environment, args: string[], dependencies: ActivationDependencies = {}) {
  if (!args.includes("--execute-base-sepolia")) throw new Error("Explicit execution flag --execute-base-sepolia required after release authorization");
  const { settings, client, proposal } = await preflight(env, dependencies);
  const wallet = (dependencies.createWalletClient ?? walletClient)(settings.rpcUrl, settings.account);
  const hash = await wallet.writeContract({
    account: settings.account, chain: baseSepolia, address: settings.contract, abi: registryAbi,
    functionName: "setPublisher", args: [settings.publisher, true], value: 0n, nonce: proposal.nonce,
    gas: proposal.gas, maxFeePerGas: proposal.maxFeePerGas, maxPriorityFeePerGas: proposal.maxPriorityFeePerGas,
  });
  dependencies.onBroadcast?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("Activation transaction did not succeed; reconcile hash before retry");
  const [publisherActive, epoch] = await client.getPublisherConfig(settings.contract, settings.publisher, receipt.blockNumber);
  if (!publisherActive) throw new Error("Activation publisher verification failed; reconcile hash before retry");
  return { ...proposal, transactionHash: hash, blockNumber: receipt.blockNumber, publisherActive, epoch, finality: "included" as const };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await activatePublisher(process.env, process.argv.slice(2), { onBroadcast: (hash) => console.log(hash) }); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("Explicit execution flag")) console.error(error.message);
    else console.error("Activation unavailable or broadcast uncertain. Reconcile any printed transaction hash before retrying. No automatic retry performed.");
    process.exitCode = 1;
  }
}
