import { domainToASCII } from "node:url";
import { encodeAbiParameters, keccak256, type Hex } from "viem";

export const REGISTRY_NORMALIZATION_VERSION = 1;
export const REGISTRY_INDICATOR_TYPE = 1;
const nonPublicTlds = new Set(["localhost", "local", "internal", "invalid", "test", "example", "onion", "home", "lan"]);

/** Bare hostname only. This is a scope/encoding check, never DNS or ownership verification. */
export function normalizeRegistryHostname(input: string): string {
  if (typeof input !== "string" || !input || /[\s\u0000-\u0020\u007f:/\\@?#%]/u.test(input)) {
    throw new Error("Registry requires a bare public hostname");
  }
  const ascii = domainToASCII(input).toLowerCase();
  const hostname = ascii.endsWith(".") ? ascii.slice(0, -1) : ascii;
  const labels = hostname.split(".");
  if (!hostname || hostname.length > 253 || labels.length < 2 || labels.some(label =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ) || !/[a-z]/.test(labels.at(-1)!) || nonPublicTlds.has(labels.at(-1)!)) {
    throw new Error("Registry requires a bare public hostname");
  }
  return hostname;
}

/** Exact canonical host, ABI encoding (not packed), version=1 and hostname type=1. */
export function registryIndicatorId(input: string): Hex {
  return keccak256(encodeAbiParameters([
    { type: "uint16" }, { type: "uint8" }, { type: "string" },
  ], [REGISTRY_NORMALIZATION_VERSION, REGISTRY_INDICATOR_TYPE, normalizeRegistryHostname(input)]));
}
export const normalizePublicHostname = normalizeRegistryHostname;
export const indicatorId = registryIndicatorId;
