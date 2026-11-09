import type { startChatSession } from "@/app/chats/actions";

export async function getChatAccessToken(chatId: string): Promise<string> {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/session`, { cache: "no-store" });
  if (!response.ok) throw new Error("Couldn’t reconnect to this chat. Please try again.");
  return (await response.json()).publicAccessToken;
}

export async function connectChatSession(chatId: string, recipientId?: string): Promise<Awaited<ReturnType<typeof startChatSession>>> {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientId }),
  });
  if (!response.ok) throw new Error("Couldn’t start the reply. Please try again.");
  return response.json();
}
