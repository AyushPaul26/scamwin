import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-verify/**",
    ".next-chat-check/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".trigger/**",
    "publisher/lib/**",
    "web3/artifacts/**",
    "web3/cache/**",
  ]),
]);

export default eslintConfig;
