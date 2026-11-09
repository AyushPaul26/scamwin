import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let owned = true;
let ownershipReads = 0;
const calls: unknown[] = [];
mock.module("../queries/bots.ts", { namedExports: { getUserChat: async (chatId: string) => { ownershipReads++; return owned && chatId === "owned-chat" ? { id: chatId, members: [{ id: "member-1" }] } : null; } } });
mock.module(require.resolve("@trigger.dev/sdk"), { namedExports: { auth: { createPublicToken: async (options: unknown) => { calls.push(options); return "scoped-token"; } } } });
mock.module(require.resolve("@trigger.dev/sdk/ai"), { namedExports: {
  defaultStorage: {},
  chat: {
    createStartSessionAction: () => async (options: unknown) => { calls.push(options); return { publicAccessToken: "scoped-token" }; },
    createLoadTranscriptAction: () => async (options: unknown) => { calls.push(options); return { messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "saved" }] }], cursors: { lastOutEventId: "42" } }; },
  },
} });
const { startChatSession, mintChatAccessToken, loadChatHistory } = await import("../app/chats/actions");
const { GET, POST } = await import("../app/api/chats/[chatId]/session/route");
const { GET: GET_HISTORY } = await import("../app/api/chats/[chatId]/history/route");

test("start, refresh, and history reject unauthenticated, foreign and invalid chats before contacting Trigger", async () => {
  for (const chatId of ["foreign-chat", "", "x".repeat(129), "owned-chat"]) {
    owned = chatId !== "owned-chat";
    const before = calls.length;
    await assert.rejects(startChatSession({ chatId }));
    await assert.rejects(mintChatAccessToken(chatId));
    await assert.rejects(loadChatHistory(chatId));
    assert.equal(calls.length, before);
  }
});

test("recipient validation reuses the owned chat without reading it twice", async () => {
  owned = true; ownershipReads = 0; calls.length = 0;
  await startChatSession({ chatId: "owned-chat", recipientId: "member-1" });
  assert.equal(ownershipReads, 1);
  assert.deepEqual(calls[0], { chatId: "owned-chat", clientData: { style: "balanced", recipientId: "member-1" } });
  const before = calls.length;
  await assert.rejects(startChatSession({ chatId: "owned-chat", recipientId: "foreign-member" }));
  assert.equal(calls.length, before);
});

test("authorized actions pin the task inputs and scope tokens and transcript cursors to the owned chat", async () => {
  owned = true; calls.length = 0;
  await startChatSession({ chatId: "owned-chat", userId: "forged", triggerConfig: { task: "forged" } } as { chatId: string });
  assert.deepEqual(calls[0], { chatId: "owned-chat", clientData: { style: "balanced" } });
  await mintChatAccessToken("owned-chat");
  assert.deepEqual(calls[1], { scopes: { read: { sessions: "owned-chat" }, write: { sessions: "owned-chat" } }, expirationTime: "1h" });
  const history = await loadChatHistory("owned-chat");
  assert.equal(history.messages[0].id, "user-1");
  assert.deepEqual(history.session, { publicAccessToken: "scoped-token", lastEventId: "42" });
});

test("session endpoints return scoped JSON without a route render and reject foreign origins, malformed bodies and unowned chats", async () => {
  owned = true; calls.length = 0;
  const params = Promise.resolve({ chatId: "owned-chat" });
  const request = (body: string, origin = "http://localhost") => new Request("http://localhost/api/chats/owned-chat/session", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body });
  assert.equal((await POST(request("{}", "https://foreign.example"), { params })).status, 403);
  assert.equal((await POST(request("invalid-json"), { params })).status, 400);
  assert.equal((await POST(request('{"recipientId":42}'), { params })).status, 400);
  assert.equal(calls.length, 0);
  const started = await POST(request('{"recipientId":"member-1","task":"forged","userId":"forged"}'), { params });
  assert.equal(started.status, 200);
  assert.equal(started.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await started.json(), { publicAccessToken: "scoped-token" });
  assert.deepEqual(calls[0], { chatId: "owned-chat", clientData: { style: "balanced", recipientId: "member-1" } });
  const token = await GET(new Request("http://localhost/api/chats/owned-chat/session"), { params });
  assert.deepEqual(await token.json(), { publicAccessToken: "scoped-token" });
  owned = false;
  const before = calls.length;
  assert.equal((await POST(request("{}"), { params })).status, 403);
  assert.equal((await GET(new Request("http://localhost/api/chats/owned-chat/session"), { params })).status, 403);
  assert.equal(calls.length, before);
});

test("history recovery authenticates ownership and returns only the transcript", async () => {
  const params = Promise.resolve({ chatId: "owned-chat" });
  const request = new Request("http://localhost/api/chats/owned-chat/history");
  owned = false; calls.length = 0;
  assert.equal((await GET_HISTORY(request, { params })).status, 403);
  assert.equal(calls.length, 0);
  owned = true;
  const response = await GET_HISTORY(request, { params });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["messages"]);
  assert.equal(body.messages[0].parts[0].text, "saved");
});
