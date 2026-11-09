import { logger, task } from "@trigger.dev/sdk";

export const healthcheck = task({
  id: "openmods-healthcheck",
  run: async () => {
    logger.info("OpenMods background worker is ready.");

    return {
      status: "ok",
      message: "Trigger.dev is running in OpenMods.",
    };
  },
});
