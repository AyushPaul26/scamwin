import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
export type DeploymentConfig = { chainId: 84532; rpcUrl: string; owner: Address; privateKey: Hex; maxFeeWei: bigint };

export function validateDeploymentConfig(env: Record<string, string | undefined>, args: string[]): DeploymentConfig {
  if (!args.includes("--execute-base-sepolia")) throw new Error("Explicit execution flag --execute-base-sepolia required after release authorization");
  if (env.REGISTRY_CHAIN_ID !== "84532") throw new Error("Only Base Sepolia (84532) is supported");
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  if (new URL(rpcUrl).protocol !== "https:") throw new Error("HTTPS RPC required");
  if (!env.REGISTRY_DEPLOYER_PRIVATE_KEY || !/^0x[0-9a-f]{64}$/i.test(env.REGISTRY_DEPLOYER_PRIVATE_KEY)) throw new Error("Server-supplied deployer private key required");
  const owner = env.REGISTRY_OWNER_ADDRESS;
  if (!owner || !isAddress(owner) || getAddress(owner) === zeroAddress) throw new Error("Nonzero registry owner required");
  return { chainId: 84532, rpcUrl, owner: getAddress(owner), privateKey: env.REGISTRY_DEPLOYER_PRIVATE_KEY as Hex, maxFeeWei: 1_000_000_000_000_000n };
}
