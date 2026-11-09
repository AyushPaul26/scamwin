"use server";

import { auth } from "@trigger.dev/sdk";
import { chat, defaultStorage } from "@trigger.dev/sdk/ai";
import { chatIdSchema } from "@/lib/chat-input";
import { getUserChat } from "@/queries/bots";

const startSession = chat.createStartSessionAction("openmods-chat");
const loadTranscript = chat.createLoadTranscriptAction(defaultStorage);

async function requireChatOwner(input: unknown) {
  try {
    const chatId = chatIdSchema.parse(input);
    const owned = await getUserChat(chatId);
    if (owned) return owned;
  } catch {
    // Do not return database errors or validation details to the browser.
  }
  throw new Error("Chat not found.");
}

function mintToken(chatId: string) {
  return auth.createPublicToken({
    scopes: { read: { sessions: chatId }, write: { sessions: chatId } },
    expirationTime: "1h",
  });
}

export async function startChatSession(input: { chatId: string; recipientId?: string }) {
  const owned = await requireChatOwner(input?.chatId);
  const chatId = owned.id;
  try {
    if (input.recipientId) {
      if (!owned?.members.some(member => member.id === input.recipientId)) throw new Error("Invalid recipient");
    }
    return await startSession({ chatId, clientData: { style: "balanced", ...(input.recipientId ? { recipientId: input.recipientId } : {}) } });
  } catch {
    throw new Error("Couldn’t start the reply. Please try again.");
  }
}

export async function mintChatAccessToken(input: string) {
  const { id: chatId } = await requireChatOwner(input);
  try {
    return await mintToken(chatId);
  } catch {
    throw new Error("Couldn’t reconnect to this chat. Please try again.");
  }
}

export async function loadChatHistory(input: string) {
  const { id: chatId } = await requireChatOwner(input);
  const transcript = await loadTranscript({ chatId });
  // Hydrate only existing conversations; opening an empty chat must not start a run.
  return {
    messages: transcript.messages,
    session: transcript.messages.length ? {
      publicAccessToken: await mintToken(chatId),
      lastEventId: transcript.cursors?.lastOutEventId,
    } : undefined,
  };
}
