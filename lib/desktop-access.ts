import 'server-only';
import { and, eq } from 'drizzle-orm';
import { auth0 } from '@/lib/auth0';
import { getDb } from '@/lib/db';
import { bots, chats, chatMembers } from '@/lib/db/schema';
import { chatIdSchema } from '@/lib/chat-input';
import { getBotDesktopConnection } from '@/lib/daytona';
export async function getDesktopAccess(input: string) {
  const session = await auth0.getSession();
  const parsed = chatIdSchema.safeParse(input);
  if (!session?.user.sub || !parsed.success) throw new Error('Desktop unavailable.');
  try {
    const [row] = await getDb().select({ sandboxId: bots.sandboxId }).from(chats)
      .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
      .innerJoin(bots, and(eq(bots.id, chatMembers.botId), eq(bots.userId, session.user.sub)))
      .where(and(eq(chats.id, parsed.data), eq(chats.userId, session.user.sub), eq(chats.kind, 'direct'))).limit(1);
    if (!row) throw new Error('Missing desktop');
    return await getBotDesktopConnection(row.sandboxId);
  } catch { throw new Error('Could not connect to this desktop. Please retry.'); }
}
