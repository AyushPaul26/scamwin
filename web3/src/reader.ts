import { createPublicClient, getAddress, http, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { threatRegistryAbi, REGISTRY_CHAIN_ID } from "../../lib/scamwin/registry-abi.ts";
import { normalizeRegistryHostname, registryIndicatorId } from "../../lib/scamwin/registry-normalization.ts";

export type RegistryDeployment = {
  chainId: typeof REGISTRY_CHAIN_ID;
  address: Address;
  rpcUrl: string;
  deploymentBlock: bigint;
};
export type RegistryAssertion = {
  publisher: Address; hostname: string; indicatorId: Hex; epoch: bigint;
  revision: number; issuedAt: bigint; expiresAt: bigint; category: number; retracted: boolean;
  enabled: boolean; status: "missing" | "suspended" | "retracted" | "expired" | "active";
  blockNumber: bigint; blockHash: Hex; chainTimestamp: bigint;
  checkedAt: string; finality: "included" | "safe" | "finalized";
};
export type RegistryReadClient = Pick<PublicClient, "readContract" | "getBytecode"> & {
  getBlock(args: { blockTag: "latest" | "safe" | "finalized"; blockNumber?: never } | { blockNumber: bigint; blockTag?: never }): Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>;
};

/** RPC/state only: the same logic is exercised against Hardhat, without an application DB or API. */
export async function readRegistryAssertionFromClient(client: RegistryReadClient, address: Address, publisher: Address, input: string, blockTag: "latest" | "safe" | "finalized" = "latest"): Promise<RegistryAssertion> {
  if (getAddress(address) === zeroAddress || getAddress(publisher) === zeroAddress) throw new Error("Nonzero registry and publisher addresses required");
  const hostname = normalizeRegistryHostname(input);
  const indicatorId = registryIndicatorId(hostname);
  const block = await client.getBlock({ blockTag });
  if (block.number === null || block.hash === null) throw new Error("Mined block required");
  const context = { address, abi: threatRegistryAbi, blockNumber: block.number } as const;
  const [code, version, [enabled, epoch]] = await Promise.all([
    client.getBytecode({ address, blockNumber: block.number }),
    client.readContract({ ...context, functionName: "VERSION" }),
    client.readContract({ ...context, functionName: "publisherConfig", args: [publisher] }),
  ]);
  if (!code || code === "0x" || version !== 1) throw new Error("Unsupported or missing ThreatRegistryV1 deployment");
  const record = await client.readContract({ ...context, functionName: "getAssertion", args: [publisher, epoch, indicatorId] });
  const verified = await client.getBlock({ blockNumber: block.number });
  if (verified.hash !== block.hash) throw new Error("Chain reorganization during registry read; refresh required");
  const status = record.revision === 0 ? "missing" : !enabled ? "suspended" : record.retracted ? "retracted" : block.timestamp >= record.expiresAt ? "expired" : "active";
  return {
    publisher: getAddress(publisher), hostname, indicatorId, epoch, ...record, enabled, status,
    blockNumber: block.number, blockHash: block.hash, chainTimestamp: block.timestamp,
    checkedAt: new Date().toISOString(), finality: blockTag === "latest" ? "included" : blockTag,
  };
}

/** Remote reader is Base Sepolia only. No wallet, private key, transactions or automatic retry. */
export async function readRegistryAssertion(deployment: RegistryDeployment, publisher: Address, hostname: string): Promise<RegistryAssertion> {
  if (deployment.chainId !== REGISTRY_CHAIN_ID || new URL(deployment.rpcUrl).protocol !== "https:") throw new Error("HTTPS Base Sepolia configuration required");
  const client = createPublicClient({ chain: baseSepolia, transport: http(deployment.rpcUrl, { timeout: 10_000, retryCount: 0 }) });
  if (await client.getChainId() !== REGISTRY_CHAIN_ID) throw new Error("RPC chain mismatch; Base Sepolia required");
  const result = await readRegistryAssertionFromClient(client, deployment.address, publisher, hostname);
  if (result.blockNumber < deployment.deploymentBlock) throw new Error("RPC is behind deployment block");
  return result;
}
