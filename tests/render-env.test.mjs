import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getRenderEnvErrors } from "../scripts/check-render-env.mjs";

const validEnv = {
  DAYTONA_API_KEY: "test-daytona-key",
  OPENMODS_ENV: "production",
  AUTH0_DOMAIN: "auth.example.com",
  AUTH0_CLIENT_ID: "test-client",
  AUTH0_CLIENT_SECRET: "test-client-secret",
  AUTH0_SECRET: "a".repeat(64),
  APP_BASE_URL: "https://openmods.example.com",
  DATABASE_URL: "postgresql://test:password@db.example.com/openmods?sslmode=require",
  TRIGGER_SECRET_KEY: "tr_prod_sk_test_only_not_a_real_key",
};
const script = fileURLToPath(new URL("../scripts/check-render-env.mjs", import.meta.url));

test("accepts the web environment without worker-only OpenAI settings", () => {
  assert.deepEqual(getRenderEnvErrors(validEnv), []);
  assert.deepEqual(getRenderEnvErrors({ ...validEnv, TRIGGER_SECRET_KEY: "tr_prod_0123456789abcdef" }), []);
  assert.deepEqual(getRenderEnvErrors({ ...validEnv, APP_BASE_URL: `${validEnv.APP_BASE_URL}/` }), []);
  assert.deepEqual(getRenderEnvErrors({ ...validEnv, DATABASE_URL: "postgres://test:password@db.example.com/openmods" }), []);
});

test("reports every missing or blank setting by name", () => {
  for (const key of Object.keys(validEnv)) {
    for (const value of [undefined, "", "   "]) {
      const errors = getRenderEnvErrors({ ...validEnv, [key]: value });
      assert.equal(errors.length, 1);
      assert.match(errors[0], new RegExp(`^${key}:`));
    }
  }
  assert.equal(getRenderEnvErrors({}).length, Object.keys(validEnv).length);
});

test("rejects base URLs that cannot be used as a production HTTPS origin", () => {
  for (const value of [
    "not-a-url", "http://openmods.example.com", "https:/openmods.example.com",
    "https://user:password@openmods.example.com", "https://openmods.example.com/dashboard",
    "https://openmods.example.com?secret=private", "https://openmods.example.com#fragment",
    " https://openmods.example.com",
  ]) {
    assert.match(getRenderEnvErrors({ ...validEnv, APP_BASE_URL: value })[0], /^APP_BASE_URL:/);
  }
});

test("rejects malformed database URLs, cookie secrets, and nonproduction Trigger keys", () => {
  const invalid = {
    DATABASE_URL: ["not-a-url", "https://db.example.com/openmods", "postgresql:///openmods", "postgresql://db.example.com", "postgresql://db.example.com/", "postgresql://db.example.com/openmods#fragment"],
    AUTH0_SECRET: ["too-short", "g".repeat(64), "a".repeat(63)],
    TRIGGER_SECRET_KEY: ["tr_dev_test", "tr_stg_sk_test", "tr_prod_", "tr_prod_sk_", "tr_prod_sk_has space"],
  };
  for (const [key, values] of Object.entries(invalid)) {
    for (const value of values) {
      assert.match(getRenderEnvErrors({ ...validEnv, [key]: value })[0], new RegExp(`^${key}:`));
    }
  }
});

test("CLI exits nonzero with actionable names and never echoes invalid values", () => {
  const sentinel = "private-value-that-must-not-be-printed";
  const result = spawnSync(process.execPath, [script], {
    env: { ...validEnv, APP_BASE_URL: sentinel, DATABASE_URL: sentinel, AUTH0_SECRET: sentinel, TRIGGER_SECRET_KEY: sentinel },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  for (const key of ["APP_BASE_URL", "DATABASE_URL", "AUTH0_SECRET", "TRIGGER_SECRET_KEY"]) {
    assert.match(result.stderr, new RegExp(key));
  }
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(sentinel));
});

test("CLI accepts syntactically valid settings without contacting providers", () => {
  // The reserved example.com hosts and fake credentials cannot authenticate.
  const result = spawnSync(process.execPath, [script], { env: validEnv, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, /password|tr_prod_sk_|test-client-secret/);
});
