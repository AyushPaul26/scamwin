import { getAddress, isAddress } from "viem";
import { readRegistryAssertion } from "../src/reader.ts";

const [address, publisher, hostname] = process.argv.slice(2);
if (!isAddress(address ?? "") || !isAddress(publisher ?? "") || !hostname) {
  console.error("Usage: npm run read -- <registry-address> <publisher-address> <bare-hostname>");
  process.exitCode = 1;
} else {
  try {
    const assertion = await readRegistryAssertion({
      chainId: 84532, address: getAddress(address), rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      deploymentBlock: BigInt(process.env.REGISTRY_DEPLOYMENT_BLOCK ?? "0"),
    }, getAddress(publisher), hostname);
    console.log(JSON.stringify({ network: "Base Sepolia TESTNET", ...assertion }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
  } catch {
    console.error("Registry read unavailable: verify network, deployment, hostname and RPC access. No warning status was inferred.");
    process.exitCode = 1;
  }
}
