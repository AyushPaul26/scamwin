import type { FileUIPart } from "ai";

export const CHAT_IMAGE_COUNT = 4;
export const CHAT_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
// Four base64 images plus the maximum text/metadata fit in a 1 MiB message.
export const CHAT_IMAGE_BYTES = 160 * 1024;
export const CHAT_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const CHAT_IMAGE_ERROR = "Add up to 4 PNG, JPEG, WebP, or GIF images, up to 10 MB each.";

/** Validate inline bytes; never let a browser-controlled URL become a worker fetch. */
export function isChatImage(part: { mediaType: string; url: string }): boolean {
  if (part.url.length > Math.ceil(CHAT_IMAGE_BYTES / 3) * 4 + 32) return false;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.url);
  if (!match || match[1] !== part.mediaType || match[2].length % 4) return false;
  const size = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (!size || size > CHAT_IMAGE_BYTES) return false;
  const header = atob(match[2].slice(0, 16));
  return part.mediaType === "image/jpeg" ? header.startsWith("\xff\xd8\xff")
    : part.mediaType === "image/png" ? header.startsWith("\x89PNG\r\n\x1a\n")
    : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
}

/** Resize in the browser before sending. No public upload or storage URL needed. */
export async function prepareChatImages(files: FileUIPart[]): Promise<FileUIPart[]> {
  if (files.length > CHAT_IMAGE_COUNT) throw new Error(CHAT_IMAGE_ERROR);
  return Promise.all(files.map(async (file) => {
    const image = new Image();
    image.src = file.url;
    try {
      await image.decode();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image processing is unavailable.");
      let longest = Math.min(2048, Math.max(image.naturalWidth, image.naturalHeight));
      for (let pass = 0; pass < 5; pass++) {
        const scale = longest / Math.max(image.naturalWidth, image.naturalHeight);
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.9, 0.75, 0.6]) {
          const url = canvas.toDataURL("image/jpeg", quality);
          const part: FileUIPart = { type: "file", mediaType: "image/jpeg", filename: (file.filename || "image").replace(/\.[^.]+$/, "").slice(0, 240) + ".jpg", url };
          if (isChatImage(part)) return part;
        }
        longest *= 0.75;
      }
      throw new Error("Image is too detailed.");
    } catch {
      throw new Error("Couldn’t prepare this image. Try a smaller PNG, JPEG, WebP, or GIF.");
    } finally {
      image.src = "";
    }
  }));
}
