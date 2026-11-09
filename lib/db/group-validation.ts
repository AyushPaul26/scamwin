import { createInsertSchema } from 'drizzle-zod';
import { chats } from './schema';
import { groupFormSchema } from '../group-form-schema';
export const groupInsertSchema = createInsertSchema(chats, { name: groupFormSchema.shape.name });
export const groupSaveSchema = groupInsertSchema.pick({ name: true }).extend({ botIds: groupFormSchema.shape.botIds });
