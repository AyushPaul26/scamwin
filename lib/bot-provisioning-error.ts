export class BotProvisioningError extends Error {
  constructor(readonly stage: "create" | "toolkit" | "memory") {
    super(`Bot computer setup failed: ${stage}`);
    this.name = "BotProvisioningError";
  }
}
