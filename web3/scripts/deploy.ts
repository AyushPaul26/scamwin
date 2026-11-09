import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createPublicClient, createWalletClient, encodeDeployData, http, keccak256, toHex, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { publicActionsL2 } from "viem/op-stack";
import { validateDeploymentConfig } from "../src/deployment-config.ts";

/** Deliberate execution only. Importing this module never deploys. */
export async function deployRegistry(env: Record<string, string | undefined>, args: string[]) {
  const config = validateDeploymentConfig(env, args);
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(config.rpcUrl, { timeout: 15_000, retryCount: 0 });
  const client = createPublicClient({ chain: baseSepolia, transport }).extend(publicActionsL2());
  if (await client.getChainId() !== 84532) throw new Error("RPC chain mismatch; refusing deployment");
  const artifact: { abi: Abi; bytecode: Hex } = JSON.parse(await readFile(new URL("../artifacts/contracts/ThreatRegistryV1.sol/ThreatRegistryV1.json", import.meta.url), "utf8"));
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [config.owner] });
  // Estimate first, with a hard cap on test ETH. No funding or paid fallback exists here.
  const estimated = await client.estimateGas({ account, data });
  const gas = estimated * 120n / 100n;
  const fees = await client.estimateFeesPerGas();
  const [l1Fee, operatorFee] = await Promise.all([client.estimateL1Fee({ account, data }), client.estimateOperatorFee({ account, data, gas })]);
  if (gas * fees.maxFeePerGas + 2n * (l1Fee + operatorFee) > config.maxFeeWei) throw new Error("Deployment exceeds test ETH fee cap");
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [config.owner], gas, ...fees, nonce });
  console.log(`Base Sepolia TESTNET deployment broadcast: ${hash}. Reconcile this hash before any retry.`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment did not succeed");
  const code = await client.getBytecode({ address: receipt.contractAddress, blockNumber: receipt.blockNumber });
  if (!code || code === "0x") throw new Error("Deployment bytecode missing");
  const metadata = {
    name: "ThreatRegistryV1", network: "Base Sepolia TESTNET", chainId: 84532,
    address: receipt.contractAddress, owner: config.owner, deploymentBlock: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash, transactionHash: hash, nonce, finality: "included",
    compiler: "0.8.30", optimizerRuns: 200, viaIR: true, evmVersion: "cancun",
    abiHash: keccak256(toHex(JSON.stringify(artifact.abi))), runtimeCodeHash: keccak256(code),
  };
  const directory = new URL("../deployments/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`84532-${receipt.contractAddress}.json`, directory), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(metadata, null, 2));
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await deployRegistry(process.env, process.argv.slice(2)); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("Explicit execution flag")) console.error(error.message);
    else console.error("Deployment unavailable or broadcast uncertain. Reconcile any printed transaction hash before retrying. No automatic retry performed.");
    process.exitCode = 1;
  }
}
