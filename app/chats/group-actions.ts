'use server';
import { revalidatePath } from 'next/cache';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { auth0 } from '@/lib/auth0';
import { getDb } from '@/lib/db';
import { bots, chats, chatMembers } from '@/lib/db/schema';
import { groupSaveSchema } from '@/lib/db/group-validation';
import { parseGroupForm, type GroupMember } from '@/lib/group-form-schema';
export type GroupState = { success?: boolean; chatId?: string; error?: string; errors?: { name?: string; botIds?: string } };
export async function listGroupBots(): Promise<GroupMember[]> {
  const session = await auth0.getSession();
  if (!session?.user.sub) return [];
  return getDb().select({ id: bots.id, name: bots.name, avatar: bots.avatar, job: bots.job }).from(bots).where(eq(bots.userId, session.user.sub)).orderBy(asc(bots.createdAt), asc(bots.id));
}
export async function saveGroup(chatId: string | null, _previous: GroupState, form: FormData): Promise<GroupState> {
  const session = await auth0.getSession();
  if (!session?.user.sub) return { error: 'Please sign in again.' };
  const input = parseGroupForm(form);
  if (!input.success) return { errors: { name: input.error.flatten().fieldErrors.name?.[0], botIds: input.error.flatten().fieldErrors.botIds?.[0] } };
  groupSaveSchema.parse(input.data);
  if (chatId !== null && (typeof chatId !== 'string' || !chatId || chatId.length > 128)) return { error: 'Group unavailable.' };
  try {
    const db = getDb();
    const owned = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.userId, session.user.sub), inArray(bots.id, input.data.botIds)));
    if (owned.length !== input.data.botIds.length) return { errors: { botIds: 'Select only available bots that belong to you.' } };
    const id = chatId ?? nanoid();
    if (chatId) {
      const [group] = await db.select({ id: chats.id }).from(chats).where(and(eq(chats.id, id), eq(chats.userId, session.user.sub), eq(chats.kind, 'group')));
      if (!group) return { error: 'Group unavailable.' };
      await db.batch([
        db.update(chats).set({ name: input.data.name }).where(and(eq(chats.id, id), eq(chats.userId, session.user.sub))),
        db.delete(chatMembers).where(and(eq(chatMembers.chatId, id), notInArray(chatMembers.botId, input.data.botIds))),
        db.insert(chatMembers).values(input.data.botIds.map((botId, index) => ({ chatId: id, botId, joinedAt: new Date(Date.now() + index) }))).onConflictDoNothing(),
      ]);
    } else {
      await db.batch([
        db.insert(chats).values({ id, userId: session.user.sub, kind: 'group', name: input.data.name }),
        db.insert(chatMembers).values(input.data.botIds.map((botId, index) => ({ chatId: id, botId, joinedAt: new Date(Date.now() + index) }))),
      ]);
    }
    revalidatePath('/(dashboard)', 'layout');
    return { success: true, chatId: id };
  } catch { return { error: 'Could not save your group. Your changes are still here; please retry.' }; }
}
export async function deleteGroup(chatId: string): Promise<GroupState> {
  const session = await auth0.getSession();
  if (!session?.user.sub || typeof chatId !== 'string' || !chatId || chatId.length > 128) return { error: 'Group unavailable.' };
  try {
    const deleted = await getDb().delete(chats).where(and(eq(chats.id, chatId), eq(chats.kind, 'group'), eq(chats.userId, session.user.sub))).returning({ id: chats.id });
    if (!deleted.length) return { error: 'Group unavailable.' };
    revalidatePath('/(dashboard)', 'layout');
    return { success: true };
  } catch { return { error: 'Could not delete this group. Please retry.' }; }
}
