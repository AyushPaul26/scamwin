import { createInsertSchema } from "drizzle-zod";
import { avatarSeedSchema, botFormSchema } from "../bot-form-schema";
import { bots } from "./schema";

export const botInsertSchema = createInsertSchema(bots, {
  name: botFormSchema.shape.name,
  job: botFormSchema.shape.job,
  instructions: botFormSchema.shape.instructions.nullable().optional(),
  avatar: avatarSeedSchema.optional(),
});

// Only these fields may come from a browser. Ownership and generated fields
// remain server-controlled, and creation must retain the exact preview seed.
export const botCreateSchema = botInsertSchema
  .pick({ name: true, job: true, instructions: true, avatar: true })
  .extend({ instructions: botFormSchema.shape.instructions, avatar: avatarSeedSchema });

export const botUpdateSchema = botCreateSchema.omit({ avatar: true });
