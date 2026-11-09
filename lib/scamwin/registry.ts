import { createPublicClient, getAddress, http, isAddress, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { threatRegistryAbi, REGISTRY_CHAIN_ID } from "./registry-abi";
import { normalizeRegistryHostname, registryIndicatorId } from "./registry-normalization";

export type RegistryEnvironment = Record<string, string | undefined>;
export type RegistryConfiguration = { chainId: 84532; address: Address; publisher: Address; rpcUrl: string };
export type RegistryRpc = Pick<PublicClient, "getChainId" | "readContract" | "getBytecode"> & {
  getBlock(args: { blockTag: "latest"; blockNumber?: never } | { blockNumber: bigint; blockTag?: never }): Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>;
};
export type WarningLookup = {
  status: "ready" | "unconfigured" | "stale" | "unavailable"; chainId: 84532;
  checkedAt?: string; message: string; blockNumber?: string; blockHash?: Hex;
  warnings: { publisher: string; active: boolean; fresh: boolean; trusted: boolean; category: number; revision: number; expiresAt: string }[];
};

export function registryConfiguration(env: RegistryEnvironment = process.env): RegistryConfiguration | null {
  const { SCAMWIN_REGISTRY_ADDRESS: address, SCAMWIN_REGISTRY_PUBLISHER: publisher } = env;
  if ((env.SCAMWIN_REGISTRY_CHAIN_ID ?? "84532") !== "84532" || !address || !publisher || !isAddress(address) || !isAddress(publisher) || getAddress(address) === zeroAddress || getAddress(publisher) === zeroAddress) return null;
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  try { if (new URL(rpcUrl).protocol !== "https:") return null; } catch { return null; }
  return { chainId: REGISTRY_CHAIN_ID, address: getAddress(address), publisher: getAddress(publisher), rpcUrl };
}

/** Safe public summary: never exposes RPC credentials or a signer key. */
export function registryAvailability(env: RegistryEnvironment = process.env) {
  const config = registryConfiguration(env);
  return { status: config ? "ready" as const : "unconfigured" as const, chainId: REGISTRY_CHAIN_ID, network: "Base Sepolia testnet", message: config ? "Testnet registry configured; current chain state is checked on demand." : "Testnet sharing is not configured. Reviewed local warnings are not chain assertions." };
}

/** No database projection is accepted as a current chain fact. One configured publisher only. */
export async function lookupRegistry(input: string, options: { env?: RegistryEnvironment; client?: RegistryRpc; now?: Date } = {}): Promise<WarningLookup> {
  const config = registryConfiguration(options.env ?? process.env);
  const base = { chainId: REGISTRY_CHAIN_ID, warnings: [] };
  if (!config) return { ...base, status: "unconfigured", message: registryAvailability(options.env ?? process.env).message };
  try {
    const hostname = normalizeRegistryHostname(input);
    const indicator = registryIndicatorId(hostname);
    const client = options.client ?? createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl, { retryCount: 0, timeout: 8000 }) });
    if (await client.getChainId() !== REGISTRY_CHAIN_ID) throw new Error("Wrong chain");
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || block.hash === null) throw new Error("Missing block");
    const context = { address: config.address, abi: threatRegistryAbi, blockNumber: block.number } as const;
    const [code, version, [enabled, epoch]] = await Promise.all([
      client.getBytecode({ address: config.address, blockNumber: block.number }),
      client.readContract({ ...context, functionName: "VERSION" }),
      client.readContract({ ...context, functionName: "publisherConfig", args: [config.publisher] }),
    ]);
    if (!code || code === "0x" || version !== 1) throw new Error("Unsupported registry");
    const record = await client.readContract({ ...context, functionName: "getAssertion", args: [config.publisher, epoch, indicator] });
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error("Reorg during read");
    const now = options.now ?? new Date();
    const age = now.getTime() / 1000 - Number(block.timestamp);
    const fresh = age >= -15 && age <= 60;
    return {
      chainId: REGISTRY_CHAIN_ID, status: fresh ? "ready" : "stale", checkedAt: now.toISOString(), blockNumber: block.number.toString(), blockHash: block.hash,
      message: fresh ? "Read directly from the configured publisher on Base Sepolia testnet. An issuer assertion is not a global truth label." : "The chain observation is stale; refresh before treating these warnings as current.",
      warnings: record.revision === 0 ? [] : [{ publisher: config.publisher, active: enabled && !record.retracted && block.timestamp < record.expiresAt, fresh, trusted: true, category: record.category, revision: record.revision, expiresAt: new Date(Number(record.expiresAt) * 1000).toISOString() }],
    };
  } catch {
    return { ...base, status: "unavailable", message: "Current registry state is unavailable. No warning match or safety conclusion was inferred." };
  }
}
