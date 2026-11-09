import { createPublisherHandler } from "../handler.js";

const handler = createPublisherHandler({
  env: process.env,
  async load() {
    const [{ getScamwinStore }, { relayWarning, relayRetraction }] = await Promise.all([
      import("../lib/repository-core.js"),
      import("../lib/publication.js"),
    ]);
    const store = getScamwinStore();
    return {
      store,
      relayWarning: (id: string) => relayWarning(id, { store }),
      relayRetraction: (id: string) => relayRetraction(id, { store }),
    };
  },
});

export default { fetch: handler };
