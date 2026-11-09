import type { ScamwinStore } from "./contracts";
import { PostgresStore, ScamwinStoreError } from "./store";

let injected: ScamwinStore | null = null;
let production: ScamwinStore | null = null;
export function setScamwinStoreForTests(store: ScamwinStore | null) {
  if (process.env.NODE_ENV === "production") throw new ScamwinStoreError("test_injection_disabled");
  injected = store;
}
export function getScamwinStore(): ScamwinStore {
  if (injected) return injected;
  const url = process.env.DATABASE_URL;
  if (!url) throw new ScamwinStoreError("database_unavailable", "Scamwin storage is unavailable: DATABASE_URL is required.");
  production ??= new PostgresStore(url, { trustedAdminSubjects: (process.env.SCAMWIN_ADMIN_SUBJECTS ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
  return production;
}

