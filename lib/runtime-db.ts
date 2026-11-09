import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './db/schema';
export function runtimeDb() {
  if (!process.env.DATABASE_URL) throw new Error('Database unavailable.');
  return drizzle(process.env.DATABASE_URL, { schema });
}
