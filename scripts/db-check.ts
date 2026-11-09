import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
  const db = drizzle(process.env.DATABASE_URL);
  await db.execute(sql`select 1 as connected`);
  console.log("Neon connection verified through Drizzle ORM.");
}

main().catch(() => {
  console.error("Database check failed. Check DATABASE_URL and Neon connectivity.");
  process.exitCode = 1;
});
