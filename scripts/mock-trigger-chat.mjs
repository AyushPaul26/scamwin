import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

// Local protocol fixture; never contacts Trigger.dev or a model provider.
export async function createMockTriggerChat(baseUrl) {
  const histories = new Map(), pending = new Map(), streams = new Map();
  const staleSnapshots = new Map();
  const requests = [], timers = new Set();
  let mode = "reply", seq = 0;
  const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const cors = { "Access-Control-Allow-Origin": new URL(baseUrl).origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "*" };
    const json = (data) => { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const id = decodeURIComponent(url.pathname.split("/")[4] ?? "");
    if (url.pathname.endsWith("/snapshot-url")) return json({ presignedUrl: `${origin}/snapshot/${id}` });
    if (url.pathname.startsWith("/snapshot/")) {
      const history = histories.get(url.pathname.slice(10));
      if (!history) { res.writeHead(404); res.end(); return; }
      const chatId = url.pathname.slice(10);
      const stale = staleSnapshots.get(chatId) ?? 0;
      if (stale) staleSnapshots.set(chatId, stale - 1);
      const visible = stale && history.at(-1)?.role === "assistant" ? history.slice(0, -1) : history;
      return json({ version: 2, savedAt: Date.now(), messages: visible.map(message => ({ id: message.id, final: true, message })), state: null, lastOutEventId: String(seq) });
    }
    if (url.pathname.endsWith("/auth/jwt/claims")) return json({});
    if (url.pathname === "/api/v1/sessions") return json({ id: `session_${body.externalId}`, externalId: body.externalId, type: "chat", taskIdentifier: "openmods-chat", tags: [], metadata: null, closedAt: null, closedReason: null, expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runId: "run_test", publicAccessToken: token, isCached: histories.has(body.externalId) });
    if (url.pathname.endsWith("/in/append")) {
      const payload = body.payload;
      const inputSeq = ++seq;
      if (body.kind === "stop") { pending.get(id)?.finish?.(); return json({ seq: inputSeq }); }
      if (payload) {
        requests.push({ ...payload, style: payload.metadata?.style });
        if (payload.trigger === "regenerate-message") { const h = histories.get(id) ?? []; if (h.at(-1)?.role === "assistant") h.pop(); }
        else if (payload.message) histories.set(id, [...(histories.get(id) ?? []), payload.message]);
        pending.set(id, { mode, inputSeq });
      }
      return json({ seq: inputSeq });
    }
    if (url.pathname.endsWith("/out")) {
      const turn = pending.get(id);
      if (!turn) { res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "X-Stream-Version": "v2", "X-Session-Settled": "true" }); res.end("data: [DONE]\n\n"); return; }
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "X-Stream-Version": "v2" });
      const write = record => res.write(`event: batch\ndata: ${JSON.stringify({ records: [record] })}\n\n`);
      for (const record of streams.get(id) ?? []) if (record.seq_num > Number(req.headers["last-event-id"] ?? -1)) write(record);
      const emit = record => { streams.set(id, [...(streams.get(id) ?? []), record]); write(record); };
      const send = (data) => emit({ seq_num: ++seq, timestamp: Date.now(), body: JSON.stringify({ data, id: randomUUID() }) });
      const messageId = randomUUID();
      let text = "Here’s a practical plan";
      let finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        if (turn.mode !== "fail") {
          send({ type: "text-end", id: "text" }); send({ type: "finish-step" }); send({ type: "finish", finishReason: "stop" });
          histories.set(id, [...(histories.get(id) ?? []), { id: messageId, role: "assistant", parts: [{ type: "text", text }] }]);
        }
        emit({ seq_num: ++seq, timestamp: Date.now(), body: "", headers: [["trigger-control", "turn-complete"], ["session-in-event-id", String(turn.inputSeq)]] });
        pending.delete(id); res.end("data: [DONE]\n\n");
      };
      turn.finish = finish;
      if (turn.mode === "fail") { send({ type: "error", errorText: "Couldn’t finish the reply. Please try again." }); finish(); return; }
      send({ type: "start", messageId }); send({ type: "start-step" }); send({ type: "text-start", id: "text" }); send({ type: "text-delta", id: "text", delta: text });
      const timer = setTimeout(() => {
        timers.delete(timer); if (finished) return;
        const delta = turn.mode === "long" ? "\n\nA detailed explanation with enough content to scroll.\n\n".repeat(45) : ":\n\n1. Reproduce the issue.\n2. Add a regression test.\n3. Ship the smallest fix.";
        text += delta; send({ type: "text-delta", id: "text", delta }); finish();
      }, turn.mode === "slow" ? 15000 : 1200);
      timers.add(timer); return;
    }
    res.writeHead(404); res.end("Unexpected mock endpoint");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, requests, histories, delaySnapshot(chatId, reads) { staleSnapshots.set(chatId, reads); }, reset() { histories.clear(); streams.clear(); pending.clear(); staleSnapshots.clear(); }, set mode(value) { mode = value; }, async close() { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
