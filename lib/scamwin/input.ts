import { z } from "zod";
import type { PreparedImage } from "./contracts";

export const INPUT_LIMITS = { url: 4096, text: 12000, images: 4, sourceImageBytes: 10 * 1024 * 1024, preparedImageBytes: 160 * 1024 } as const;
export function isPublicInputUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const u = new URL(value), host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.port) return false;
    // No DNS request here: intake only validates the selected string. The collector enforces DNS/egress independently.
    if (host.includes(":") || /^\d+(\.\d+)*$/.test(host) || !host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(host)) return false;
    return /^[a-z0-9.-]+$/.test(host) && host.split(".").every((part) => part.length > 0 && part.length <= 63 && !part.startsWith("-") && !part.endsWith("-"));
  } catch { return false; }
}
export function validatePreparedImage(value: unknown): PreparedImage & { byteLength: number } {
  const parsed = z.object({ name: z.string().min(1).max(200), mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataUrl: z.string().max(Math.ceil(INPUT_LIMITS.preparedImageBytes / 3) * 4 + 100) }).strict().parse(value);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(parsed.dataUrl);
  if (!match || match[1] !== parsed.mediaType || match[2].length % 4 !== 0) throw new Error("Use a valid prepared PNG, JPEG or WebP image.");
  const encoded = match[2];
  // atob works in both the browser and Node, keeping validation shared.
  const decoded = atob(encoded);
  if (!decoded.length || decoded.length > INPUT_LIMITS.preparedImageBytes || btoa(decoded) !== encoded) throw new Error("Prepared images must be at most 160 KiB.");
  const bytes = Array.from(decoded.slice(0, 12), (c) => c.charCodeAt(0));
  const matches = parsed.mediaType === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
    : parsed.mediaType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : decoded.startsWith("RIFF") && decoded.slice(8, 12) === "WEBP";
  if (!matches) throw new Error("Image bytes do not match the declared raster type.");
  return { ...parsed, byteLength: decoded.length };
}
export const preparedImageSchema = z.object({ name: z.string().min(1).max(200), mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataUrl: z.string().max(Math.ceil(INPUT_LIMITS.preparedImageBytes / 3) * 4 + 100) }).strict().superRefine((value, ctx) => {
  try { validatePreparedImage(value); } catch { ctx.addIssue({ code: "custom", message: "Use a valid PNG, JPEG or WebP image of at most 160 KiB." }); }
});
export const checkInputSchema = z.object({
  url: z.string().trim().max(INPUT_LIMITS.url).refine((v) => !v || isPublicInputUrl(v), "Enter one public HTTP or HTTPS link without credentials or a custom port."),
  message: z.string().trim().max(INPUT_LIMITS.text), promisedBenefit: z.string().trim().max(INPUT_LIMITS.text), intendedAction: z.string().trim().max(INPUT_LIMITS.text),
  images: z.array(preparedImageSchema).max(INPUT_LIMITS.images),
}).strict().superRefine((value, ctx) => {
  if (![value.url, value.message, value.promisedBenefit, value.intendedAction].some(Boolean) && !value.images.length) ctx.addIssue({ code: "custom", path: ["message"], message: "Add a link, message or screenshot to check." });
  if (value.message.length + value.promisedBenefit.length + value.intendedAction.length > INPUT_LIMITS.text) ctx.addIssue({ code: "custom", path: ["message"], message: "Keep the combined offer text within 12,000 characters." });
});
export const parseCheckInput = (value: unknown) => checkInputSchema.parse(value);
