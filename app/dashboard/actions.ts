"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { nanoid } from "nanoid";
import { and, eq, inArray } from "drizzle-orm";
import { auth0 } from "@/lib/auth0";
import { parseBotInput, parseBotUpdateInput, type BotInputErrors } from "@/lib/bot-input";
import { getDb } from "@/lib/db";
import { createBotSandbox, deleteBotSandbox } from "@/lib/daytona";
import { BotProvisioningError } from "@/lib/bot-provisioning-error";
import { reportOperation } from "@/lib/monitoring";
import { bots, chats, chatMembers } from "@/lib/db/schema";

export type CreateBotState = {
  success?: boolean;
  errors?: BotInputErrors;
  error?: string;
};

export async function createBot(formData: FormData): Promise<CreateBotState> {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect("/sign-in");

  const { values, errors, valid } = parseBotInput(formData);
  if (!valid) return { errors };

  let sandboxId: string | undefined;
  try {
    const db = getDb();
    const botId = nanoid();
    const chatId = nanoid();
    sandboxId = await createBotSandbox(botId);
    // Neon HTTP batches run in one transaction: no partial bot/chat on failure.
    await db.batch([
      db.insert(bots).values({
        id: botId,
        sandboxId,
        userId: session.user.sub,
        name: values.name,
        avatar: values.avatar,
        job: values.job,
        instructions: values.instructions || null,
      }),
      db.insert(chats).values({ id: chatId, userId: session.user.sub, kind: "direct" }),
      db.insert(chatMembers).values({ chatId, botId }),
    ]);
  } catch (error) {
    if (sandboxId) {
      try { await deleteBotSandbox(sandboxId); } catch { console.error("Sandbox cleanup required", { sandboxId }); }
    }
    if (error instanceof BotProvisioningError) {
      return { error: error.stage === "toolkit"
        ? "We couldn’t install your bot’s tools. Your details are still here — please try again."
        : "We couldn’t prepare your bot’s computer. Your details are still here — please try again." };
    }
    reportOperation(sandboxId ? "bot-create-save" : "bot-create-config");
    return { error: "We couldn’t save your bot. Your details are still here — please try again." };
  }

  // Reload the shared sidebar's chat query as well as the dashboard's bot list.
  revalidatePath("/(dashboard)", "layout");
  return { success: true };
}

export async function updateBot(botId: string, formData: FormData): Promise<CreateBotState> {
  const session = await auth0.getSession();
  if (!session?.user.sub) return { error: "Please sign in again before saving your bot." };
  if (typeof botId !== "string" || !botId || botId.length > 128) {
    return { error: "This bot is no longer available to edit." };
  }
  const input = parseBotUpdateInput(formData);
  if (!input.valid) return { errors: input.errors };
  try {
    const updated = await getDb().update(bots).set({
      name: input.values.name,
      job: input.values.job,
      instructions: input.values.instructions || null,
    }).where(and(eq(bots.id, botId), eq(bots.userId, session.user.sub)))
      .returning({ id: bots.id });
    if (!updated.length) return { error: "This bot is no longer available to edit." };
  } catch {
    return { error: "We couldn’t save your bot. Your details are still here — please try again." };
  }
  revalidatePath("/(dashboard)", "layout");
  return { success: true };
}

export async function deleteBot(botId: string): Promise<{ error?: string }> {
  const session = await auth0.getSession();
  if (!session?.user.sub) return { error: "Please sign in again before deleting your bot." };
  if (typeof botId !== "string" || !botId || botId.length > 128) {
    return { error: "This bot is no longer available to delete." };
  }
  try {
    const db = getDb();
    const [ownedBot] = await db.select({ sandboxId: bots.sandboxId }).from(bots).where(and(eq(bots.id, botId), eq(bots.userId, session.user.sub)));
    if (!ownedBot) return { error: "This bot is no longer available to delete." };
    await deleteBotSandbox(ownedBot.sandboxId);
    const ownedMemberships = db.select({ chatId: chatMembers.chatId }).from(chatMembers)
      .innerJoin(bots, and(eq(bots.id, chatMembers.botId), eq(bots.userId, session.user.sub)))
      .where(eq(bots.id, botId));
    // One transaction removes direct chats and the bot. Group chats survive;
    // their membership rows are removed by the bot foreign key's cascade.
    const [, deleted] = await db.batch([
      db.delete(chats).where(and(
        eq(chats.userId, session.user.sub), eq(chats.kind, "direct"),
        inArray(chats.id, ownedMemberships),
      )),
      db.delete(bots).where(and(eq(bots.id, botId), eq(bots.userId, session.user.sub)))
        .returning({ id: bots.id }),
    ]);
    if (!deleted.length) return { error: "This bot is no longer available to delete." };
  } catch {
    return { error: "We couldn’t delete your bot. Please try again." };
  }
  revalidatePath("/(dashboard)", "layout");
  redirect("/dashboard", RedirectType.replace);
}
