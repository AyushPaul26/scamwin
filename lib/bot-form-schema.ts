import { z } from "zod";

export const BOT_LIMITS = { name: 80, job: 240, instructions: 4000 } as const;
export const AVATAR_SEED_LENGTH = 21;

export const botFormSchema = z.object({
  name: z.string({ error: "Enter text for this field." }).trim()
    .min(1, "Give your bot a name.")
    .max(BOT_LIMITS.name, `Use ${BOT_LIMITS.name} characters or fewer.`),
  job: z.string({ error: "Enter text for this field." }).trim()
    .min(1, "Describe your bot’s job.")
    .max(BOT_LIMITS.job, `Use ${BOT_LIMITS.job} characters or fewer.`),
  instructions: z.string({ error: "Enter text for this field." }).trim()
    .max(BOT_LIMITS.instructions, `Use ${BOT_LIMITS.instructions} characters or fewer.`),
});

export const AVATAR_INPUT_ERROR = "We couldn’t verify your bot’s avatar. Please reopen this dialog and try again.";
export const avatarSeedSchema = z.string({ error: AVATAR_INPUT_ERROR })
  .length(AVATAR_SEED_LENGTH, AVATAR_INPUT_ERROR)
  .regex(/^[A-Za-z0-9_-]+$/, AVATAR_INPUT_ERROR);

export type BotFormValues = z.infer<typeof botFormSchema>;
export type EditableBot = BotFormValues & { id: string; avatar: string };
export type BotField = keyof BotFormValues;
export type BotInputErrors = Partial<Record<BotField | "avatar", string>>;
