import "server-only";
import { cache } from "react";
import { and, asc, desc, eq } from "drizzle-orm";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { bots, chatMembers, chats } from "@/lib/db/schema";

/** The owner always comes from the server session, never caller input. */
export async function getUserChats() {
  return getOwnedChats();
}

// Deduplicate ownership/member reads within one render or action, never across
// requests or users. The page and transcript loader both require this check.
export const getUserChat = cache(async (chatId: string) => {
  const session = await auth0.getSession();
  if (!session?.user.sub) return null;
  const ownedChats = await getOwnedChats(chatId);
  const chat = ownedChats[0];
  if (!chat) return null;
  const members = await getDb().select({
    id: bots.id, name: bots.name, avatar: bots.avatar, job: bots.job, instructions: bots.instructions,
  }).from(chatMembers)
    .innerJoin(chats, and(eq(chats.id, chatMembers.chatId), eq(chats.userId, session.user.sub)))
    .innerJoin(bots, and(eq(bots.id, chatMembers.botId), eq(bots.userId, session.user.sub)))
    .where(eq(chatMembers.chatId, chatId))
    .orderBy(asc(chatMembers.joinedAt), asc(chatMembers.botId));
  const bot = chat.kind === "direct" ? members[0] : undefined;
  return { ...chat, members, bot: bot ? { ...bot, instructions: bot.instructions ?? "" } : null };
});

async function getOwnedChats(chatId?: string) {
  const session = await auth0.getSession();
  if (!session?.user.sub) return [];
  const owner = session.user.sub;
  const rows = await getDb().select({
    id: chats.id,
    kind: chats.kind,
    name: chats.name,
    preview: chats.lastMessagePreview,
    lastMessageAt: chats.lastMessageAt,
    botName: bots.name,
    avatar: bots.avatar,
  }).from(chats)
    .leftJoin(chatMembers, eq(chatMembers.chatId, chats.id))
    // Guard member data too, even if an invalid cross-owner membership exists.
    .leftJoin(bots, and(eq(bots.id, chatMembers.botId), eq(bots.userId, owner)))
    .where(and(eq(chats.userId, owner), chatId === undefined ? undefined : eq(chats.id, chatId)))
    .orderBy(desc(chats.lastMessageAt), desc(chats.id), asc(chatMembers.joinedAt), asc(chatMembers.botId));

  const unique = new Map<string, {
    id: string; kind: "direct" | "group"; name: string; avatar: string | null; preview: string | null; lastMessageAt: Date;
  }>();
  for (const row of rows) {
    const previous = unique.get(row.id);
    if (previous?.avatar || (previous && !row.avatar)) continue;
    unique.set(row.id, {
      id: row.id,
      kind: row.kind,
      name: row.kind === "group" ? row.name || row.botName || "Group chat" : row.botName || "New chat",
      avatar: row.avatar,
      preview: row.preview,
      lastMessageAt: row.lastMessageAt,
    });
  }
  return [...unique.values()];
}
