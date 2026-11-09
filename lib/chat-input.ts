import { z } from "zod";
import type { UIMessage } from "ai";
import { CHAT_IMAGE_BYTES, CHAT_IMAGE_COUNT, isChatImage } from "./chat-images";

export const CHAT_TEXT_LIMIT = 12000;
export const replyStyles = {
  balanced: { label: "Balanced", instruction: "Give clear, practical answers at an appropriate level of detail." },
  concise: { label: "Concise", instruction: "Keep answers short and direct, while retaining essential details." },
  detailed: { label: "Detailed", instruction: "Explain the reasoning and include useful examples and concrete steps." },
} as const;
export type ReplyStyle = keyof typeof replyStyles;

export const chatIdSchema = z.string().min(1).max(128);
export const chatPreferencesSchema = z.object({
  recipientId: chatIdSchema.optional(),
  style: z.enum(["balanced", "concise", "detailed"]).default("balanced"),
});

const textPart = z.object({ type: z.literal("text"), text: z.string().max(CHAT_TEXT_LIMIT) });
const imagePart = z.object({
  type: z.literal("file"),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  filename: z.string().max(256).optional(),
  url: z.string().max(Math.ceil(CHAT_IMAGE_BYTES / 3) * 4 + 32),
}).refine(isChatImage);

const incomingMessagesSchema = z.array(z.object({
  id: z.string().min(1).max(128),
  role: z.literal("user"),
  metadata: z.object({ recipientId: chatIdSchema.optional() }).optional(),
  parts: z.array(z.union([textPart, imagePart])).min(1).max(16),
}).refine(({ parts }) => parts.some(part => part.type === "file" || part.text.trim()) &&
  parts.filter(part => part.type === "file").length <= CHAT_IMAGE_COUNT &&
  parts.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0) <= CHAT_TEXT_LIMIT)).max(1);

/** The worker receives only the new user message; history belongs to storage. */
export function validateIncomingMessages(messages: UIMessage[]): UIMessage[] {
  const parsed = incomingMessagesSchema.safeParse(messages);
  if (!parsed.success) throw new Error("Send a message within the text limit and up to 4 supported images.");
  return parsed.data;
}
