import { relations } from "drizzle-orm";
import { bigint, integer, jsonb, uniqueIndex, index, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
export * from "./scamwin-schema";

export const bots = pgTable(
  "bots",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    avatar: text("avatar").notNull().$defaultFn(() => nanoid()),
    job: text("job").notNull(),
    instructions: text("instructions"),
    sandboxId: text("sandbox_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bots_user_id_idx").on(table.userId)],
);

export const chatKind = pgEnum("chat_kind", ["direct", "group"]);

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    // Auth0 session.user.sub, assigned by authenticated server code.
    userId: text("user_id").notNull(),
    kind: chatKind("kind").notNull().default("direct"),
    // Direct chats use the member bot's name instead.
    name: text("name"),
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chats_user_id_idx").on(table.userId)],
);

export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.botId] }),
    index("chat_members_bot_id_idx").on(table.botId),
  ],
);

export const botsRelations = relations(bots, ({ many }) => ({
  memberships: many(chatMembers),
}));

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
}));

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, { fields: [chatMembers.chatId], references: [chats.id] }),
  bot: one(bots, { fields: [chatMembers.botId], references: [bots.id] }),
}));

export const usageEntries = pgTable("usage_entries", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  environment: text("environment").notNull(),
  kind: text("kind").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cachedTokens: integer("cached_tokens"),
  costMicros: bigint("cost_micros", { mode: "number" }),
  rates: jsonb("rates"),
  sandboxSeconds: integer("sandbox_seconds"),
  eventAt: timestamp("event_at", { withTimezone: true }).notNull().defaultNow(),
  idempotencyKey: text("idempotency_key").notNull(),
}, (table) => [uniqueIndex("usage_entries_key_idx").on(table.idempotencyKey), index("usage_entries_owner_env_idx").on(table.userId, table.environment, table.eventAt)]);
