import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../lib/db/schema";

config({ path: ".env.local", quiet: true });

function hasDatabaseCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  return ("code" in error && error.code === code)
    || ("cause" in error && hasDatabaseCode(error.cause, code));
}

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required.");
  const db = drizzle(process.env.DATABASE_URL, { schema });
  const { bots, chats, chatMembers } = schema;
  const userId = `auth0|chat-schema-check-${randomUUID()}`;

  try {
    const [bot] = await db.insert(bots).values({ sandboxId: "schema-check-sandbox", userId, name: "Schema check", job: "Check relations" }).returning();
    const [direct] = await db.insert(chats).values({ userId }).returning();
    const [group] = await db.insert(chats).values({ userId, kind: "group", name: "Team" }).returning();
    assert.match(direct.id, /^[A-Za-z0-9_-]{21}$/);
    assert.equal(direct.userId, userId);
    assert.equal(direct.kind, "direct");
    assert.equal(direct.name, null);
    assert.equal(direct.lastMessagePreview, null);
    assert.ok(direct.createdAt instanceof Date);
    assert.ok(direct.lastMessageAt instanceof Date);
    assert.equal(group.kind, "group");

    await db.insert(chatMembers).values([
      { chatId: direct.id, botId: bot.id },
      { chatId: group.id, botId: bot.id },
    ]);
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, direct.id),
      with: { members: { with: { bot: true, chat: true } } },
    });
    assert.equal(chat?.members.length, 1);
    assert.equal(chat.members[0].bot.id, bot.id);
    assert.equal(chat.members[0].chat.id, direct.id);
    assert.ok(chat.members[0].joinedAt instanceof Date);
    const relatedBot = await db.query.bots.findFirst({
      where: eq(bots.id, bot.id), with: { memberships: true },
    });
    assert.equal(relatedBot?.memberships.length, 2);
    assert.deepEqual(await db.select().from(chats).where(eq(chats.userId, `${userId}-other`)), []);

    await assert.rejects(
      db.insert(chatMembers).values({ chatId: direct.id, botId: bot.id }),
      (error) => hasDatabaseCode(error, "23505"),
    );
    await assert.rejects(
      db.insert(chatMembers).values({ chatId: randomUUID(), botId: bot.id }),
      (error) => hasDatabaseCode(error, "23503"),
    );
    await assert.rejects(
      db.insert(chatMembers).values({ chatId: direct.id, botId: randomUUID() }),
      (error) => hasDatabaseCode(error, "23503"),
    );
    await assert.rejects(
      db.execute(sql`insert into chats (id, user_id, kind) values (${randomUUID()}, ${userId}, 'invalid')`),
      (error) => hasDatabaseCode(error, "22P02"),
    );
    await assert.rejects(
      db.execute(sql`insert into chats (id) values (${randomUUID()})`),
      (error) => hasDatabaseCode(error, "23502"),
    );

    // Verify rollback at both failure boundaries in the bot/chat/member batch.
    for (const failure of ["chat", "membership"] as const) {
      const botId = randomUUID();
      const chatId = failure === "chat" ? direct.id : randomUUID();
      await assert.rejects(db.batch([
        db.insert(bots).values({ sandboxId: "schema-check-sandbox", id: botId, userId, name: "Must roll back", job: "Rollback check" }),
        db.insert(chats).values({ id: chatId, userId, kind: "direct" }),
        db.insert(chatMembers).values({ chatId, botId: randomUUID() }),
      ]), (error) => hasDatabaseCode(error, failure === "chat" ? "23505" : "23503"));
      assert.deepEqual(await db.select().from(bots).where(eq(bots.id, botId)), [], "failed batch leaves no bot");
      if (failure === "membership") {
        assert.deepEqual(await db.select().from(chats).where(eq(chats.id, chatId)), [], "failed batch leaves no chat");
      }
      assert.equal((await db.select().from(chatMembers).where(eq(chatMembers.chatId, direct.id))).length, 1, "rollback preserves existing membership");
    }

    await db.delete(chats).where(eq(chats.id, direct.id));
    assert.deepEqual(await db.select().from(chatMembers).where(eq(chatMembers.chatId, direct.id)), []);
    assert.equal((await db.select().from(chatMembers).where(eq(chatMembers.chatId, group.id))).length, 1);
    await db.delete(bots).where(eq(bots.id, bot.id));
    assert.deepEqual(await db.select().from(chatMembers).where(eq(chatMembers.chatId, group.id)), []);
    assert.equal((await db.select().from(chats).where(eq(chats.id, group.id))).length, 1);
  } finally {
    // Remove only this run's synthetic records, including after a failed assertion.
    await db.delete(chats).where(eq(chats.userId, userId));
    await db.delete(bots).where(eq(bots.userId, userId));
  }
  console.log("Chat schema verified: defaults, relations, constraints, cascading deletion, and atomic batch rollback.");
}

main().catch(() => {
  console.error("Chat schema check failed. Check the applied schema and database connectivity.");
  process.exitCode = 1;
});
