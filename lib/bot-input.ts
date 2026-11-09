import { botCreateSchema, botUpdateSchema } from "./db/bot-validation";
import type { BotInputErrors } from "./bot-form-schema";

export { AVATAR_SEED_LENGTH, BOT_LIMITS } from "./bot-form-schema";
export type { BotField, BotInputErrors } from "./bot-form-schema";

export function parseBotInput(formData: FormData) {
  const fields = ["name", "job", "instructions", "avatar"] as const;
  const input: Record<string, unknown> = {};
  const errors: BotInputErrors = {};

  for (const field of fields) {
    const entries = formData.getAll(field);
    input[field] = entries.length > 1 ? entries : entries[0] ?? "";
  }

  const result = botCreateSchema.safeParse(input);
  if (result.success) return { values: result.data, errors, valid: true };

  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof BotInputErrors;
    if (fields.includes(field)) errors[field] ??= issue.message;
  }

  return { values: { name: "", job: "", instructions: "", avatar: "" }, errors, valid: false };
}

export function parseBotUpdateInput(formData: FormData) {
  const fields = ["name", "job", "instructions"] as const;
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const entries = formData.getAll(field);
    input[field] = entries.length > 1 ? entries : entries[0] ?? "";
  }
  const result = botUpdateSchema.safeParse(input);
  if (result.success) return { valid: true as const, values: result.data };
  const errors: BotInputErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as typeof fields[number];
    if (fields.includes(field)) errors[field] ??= issue.message;
  }
  return { valid: false as const, errors };
}
