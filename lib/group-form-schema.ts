import { z } from 'zod';
export const groupFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a group name.').max(50, 'Use 50 characters or fewer.'),
  botIds: z.array(z.string().min(1).max(128)).min(2, 'Select at least two bots.').max(50, 'Select at most 50 bots.').refine(ids => new Set(ids).size === ids.length, 'Each bot can only be selected once.'),
});
export type GroupValues = z.infer<typeof groupFormSchema>;
export type GroupMember = { id: string; name: string; avatar: string; job: string };
export function parseGroupForm(data: FormData) {
  if (data.getAll('name').length !== 1) return groupFormSchema.safeParse({});
  return groupFormSchema.safeParse({ name: data.get('name'), botIds: data.getAll('botIds') });
}
