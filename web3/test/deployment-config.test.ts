import assert from "node:assert/strict";
import { it } from "node:test";
import { validateDeploymentConfig } from "../src/deployment-config.ts";

it("deployment remains opt-in and rejects mainnet, missing secrets and insecure RPC", () => {
  const env = {
    REGISTRY_CHAIN_ID: "84532", BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    REGISTRY_OWNER_ADDRESS: "0x0000000000000000000000000000000000000001",
    // Public, synthetic test fixture only; never funded or used by a transaction.
    REGISTRY_DEPLOYER_PRIVATE_KEY: "0x" + "11".repeat(32),
  };
  assert.throws(() => validateDeploymentConfig(env, []), /Explicit execution flag/);
  const args = ["--execute-base-sepolia"];
  assert.throws(() => validateDeploymentConfig({ ...env, REGISTRY_CHAIN_ID: "8453" }, args), /Base Sepolia/);
  assert.throws(() => validateDeploymentConfig({ ...env, BASE_SEPOLIA_RPC_URL: "http://example.com" }, args), /HTTPS/);
  assert.throws(() => validateDeploymentConfig({ ...env, REGISTRY_DEPLOYER_PRIVATE_KEY: "" }, args), /private key/);
  assert.throws(() => validateDeploymentConfig({ ...env, REGISTRY_OWNER_ADDRESS: "0x0000000000000000000000000000000000000000" }, args), /owner/);
  const config = validateDeploymentConfig(env, args);
  assert.equal(config.chainId, 84532);
  assert.equal(config.maxFeeWei, 1_000_000_000_000_000n);
});
