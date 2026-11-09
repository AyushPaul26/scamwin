import { and, asc, eq } from 'drizzle-orm';
import { runtimeDb } from './runtime-db';
import { bots, chatMembers, chats } from './db/schema';
export async function getChatContext(chatId: string, recipientId?: string) {
  const db = runtimeDb();
  const [row] = await db.select().from(chats).where(eq(chats.id, chatId));
  if (!row) throw new Error('Chat unavailable.');
  const members = await db.select({ id: bots.id, name: bots.name, avatar: bots.avatar, job: bots.job, instructions: bots.instructions, sandboxId: bots.sandboxId }).from(chatMembers)
    .innerJoin(bots, and(eq(bots.id, chatMembers.botId), eq(bots.userId, row.userId)))
    .where(eq(chatMembers.chatId, chatId)).orderBy(asc(chatMembers.joinedAt), asc(chatMembers.botId));
  const bot = recipientId ? members.find(member => member.id === recipientId) : members[0];
  if (!bot) throw new Error('Select an available teammate in this chat.');
  return { row, members, bot };
}
export type ChatBot = Awaited<ReturnType<typeof getChatContext>>['bot'];
export const botIdentity = (bot: Pick<ChatBot, 'id' | 'name' | 'avatar'>) => ({ id: bot.id, name: bot.name, avatar: bot.avatar });
