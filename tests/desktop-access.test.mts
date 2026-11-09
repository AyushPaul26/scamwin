import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/neon-http";
const require = createRequire(import.meta.url);
let authenticated = true, owned = true, failing = false;
const queries: { sql: string; params: unknown[] }[] = [];
const sandboxes: string[] = [];
mock.module("server-only", { namedExports: {} });
mock.module(require.resolve("../lib/auth0"), { namedExports: { auth0: { getSession: async () => authenticated ? { user: { sub: "trusted-owner" } } : null } } });
const db = drizzle.mock();
mock.module(require.resolve("../lib/db"), { namedExports: { getDb: () => ({
  select: (...args: Parameters<typeof db.select>) => {
    const builder = db.select(...args);
    const from = builder.from.bind(builder);
    builder.from = ((...tables: Parameters<typeof from>) => {
      const query = from(...tables);
      query.execute = async () => {
        const sql = query.toSQL(); queries.push(sql);
        return owned ? [{ sandboxId: "owned-computer" }] : [];
      };
      return query;
    }) as typeof builder.from;
    return builder;
  },
}) } });
mock.module(require.resolve("../lib/daytona"), { namedExports: { getBotDesktopConnection: async (id: string) => {
  sandboxes.push(id); if (failing) throw new Error("private-url-and-token");
  return { url: "wss://desktop.example/websockify?token=scoped", expiresAt: 123 };
} } });
const { getDesktopAccess } = await import("../lib/desktop-access");
const { POST } = await import("../app/api/chats/[chatId]/desktop/route");
test("desktop checks authentication, input, direct-chat ownership and bot ownership before issuing access", async () => {
  authenticated = false;
  await assert.rejects(getDesktopAccess("chat-1"));
  authenticated = true;
  await assert.rejects(getDesktopAccess(""));
  assert.equal(queries.length, 0);
  owned = false;
  await assert.rejects(getDesktopAccess("chat-1"));
  assert.equal(sandboxes.length, 0);
  owned = true;
  assert.deepEqual(await getDesktopAccess("chat-1"), { url: "wss://desktop.example/websockify?token=scoped", expiresAt: 123 });
  assert.deepEqual(sandboxes, ["owned-computer"]);
  assert.deepEqual(queries.at(-1)?.params, ["trusted-owner", "chat-1", "trusted-owner", "direct", 1]);
});
test("connection endpoint rejects cross-origin calls, returns only connection data, and sanitizes failures", async () => {
  const params = Promise.resolve({ chatId: "chat-1" });
  const request = (origin: string) => new Request("http://localhost/api/chats/chat-1/desktop", { method: "POST", headers: { origin } });
  const before = sandboxes.length;
  assert.equal((await POST(request("https://foreign.example"), { params })).status, 403);
  assert.equal(sandboxes.length, before);
  const response = await POST(request("http://localhost"), { params });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { url: "wss://desktop.example/websockify?token=scoped", expiresAt: 123 });
  failing = true;
  const failed = await POST(request("http://localhost"), { params });
  assert.equal(failed.status, 403);
  assert.doesNotMatch(await failed.text(), /private-url-and-token/);
});
