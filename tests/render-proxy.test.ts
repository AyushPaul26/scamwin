import assert from "node:assert/strict";
import test from "node:test";
// The installed Next.js testing API still exports the middleware-era name.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

test("health checks bypass Auth0 while application and similarly named paths retain it", async () => {
  Object.assign(process.env, {
    AUTH0_DOMAIN: "auth.example.com",
    AUTH0_CLIENT_ID: "test-client",
    AUTH0_CLIENT_SECRET: "test-client-secret",
    AUTH0_SECRET: "a".repeat(64),
    APP_BASE_URL: "https://openmods.example.com",
  });
  const { config } = await import("../proxy");
  const matches = (path: string) => unstable_doesMiddlewareMatch({
    config,
    url: `https://openmods.example.com${path}`,
  });

  for (const path of ["/healthz", "/healthz?probe=render"]) {
    assert.equal(matches(path), false, path);
  }
  for (const path of ["/", "/dashboard", "/auth/login", "/auth/callback", "/healthz-private", "/healthz/child"]) {
    assert.equal(matches(path), true, path);
  }
});
