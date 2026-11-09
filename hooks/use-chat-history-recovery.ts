"use client";

import { useEffect } from "react";
import type { ChatStatus, UIMessage } from "ai";

/** Trigger finishes saving a turn after closing its live response stream. */
export function useChatHistoryRecovery({ chatId, initialMessages, messages, status, setMessages }: {
  chatId: string;
  initialMessages: UIMessage[];
  messages: UIMessage[];
  status: ChatStatus;
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
}) {
  const initialLast = initialMessages.at(-1);
  const pendingId = initialLast?.role === "user" ? initialLast.id : undefined;
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    // Recover only an unfinished snapshot on page load. Never replace a live
    // response or a newer message the user has sent since loading the page.
    if (!pendingId || lastId !== pendingId || status === "submitted" || status === "streaming") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function recover(attempt: number) {
      try {
        const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/history`, { cache: "no-store", signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;
        const { messages: saved } = await response.json() as { messages: UIMessage[] };
        const index = saved.findIndex(message => message.id === pendingId && message.role === "user");
        if (index >= 0 && saved.slice(index + 1).some(message => message.role === "assistant")) {
          if (!controller.signal.aborted) setMessages(current => current.at(-1)?.id === pendingId ? saved : current);
        } else if (attempt < 4 && !controller.signal.aborted) {
          timer = setTimeout(() => { void recover(attempt + 1); }, 500 * 2 ** attempt);
        }
      } catch { /* Live reconnect/retry stays available if the recovery read fails. */ }
    }
    timer = setTimeout(() => { void recover(0); }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [chatId, pendingId, lastId, status, setMessages]);
}
