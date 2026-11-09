import { timingSafeEqual } from "node:crypto";

export type PublisherDependencies = {
  store: { listPendingPublications(limit: number): Promise<{ warningId: string; kind: "publish_warning" | "retract_warning" }[]> };
  relayWarning(id: string): Promise<{ status: string; retry: boolean }>;
  relayRetraction(id: string): Promise<{ status: string; retry: boolean }>;
};
const statuses = new Set(["queued", "signed", "submitted", "included", "safe", "finalized", "failed", "unavailable", "local_only", "unconfigured", "uncertain", "busy"]);
const reply = (body: object, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/** Authentication finishes before loading any database or signing implementation. */
export function createPublisherHandler(options: { env: Record<string, string | undefined>; load(): Promise<PublisherDependencies> }) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST" && request.method !== "GET") return reply({ status: "method_not_allowed" }, 405, { allow: "GET, POST" });
    const secret = request.method === "POST" ? options.env.SCAMWIN_PUBLISHER_DISPATCH_SECRET : options.env.CRON_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) return reply({ status: "unconfigured" }, 503);
    const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(request.headers.get("authorization") ?? "");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return reply({ status: "unauthorized" }, 401);
    try {
      // Payloads and query parameters are deliberately never read.
      const { store, relayWarning, relayRetraction } = await options.load();
      const [operation] = await store.listPendingPublications(1);
      if (!operation) return reply({ status: "idle", processed: 0 });
      if (operation.kind !== "publish_warning" && operation.kind !== "retract_warning") return reply({ status: "unavailable" }, 503);
      const result = await (operation.kind === "publish_warning" ? relayWarning(operation.warningId) : relayRetraction(operation.warningId));
      if (!statuses.has(result.status) || typeof result.retry !== "boolean") return reply({ status: "unavailable" }, 503);
      // Return only bounded status fields; omit arbitrary messages, errors and signed bytes.
      return reply({ status: result.status, retry: result.retry, processed: 1 });
    } catch {
      return reply({ status: "unavailable", retry: true }, 503);
    }
  };
}

