/** Shared UTF-16 boundaries for persisted metadata and immutable child input. */
export const BODY_CHUNK_LENGTH = 11744;
export const BODY_OVERLAP = 512;
export type TextChunk = { id: string; start: number; end: number; text: string };
function boundary(text: string, offset: number) {
  return offset > 0 && offset < text.length && /[\uDC00-\uDFFF]/.test(text[offset]) && /[\uD800-\uDBFF]/.test(text[offset - 1]) ? offset - 1 : offset;
}
export function planTextChunks(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (let start = 0; start < text.length;) {
    const end = boundary(text, Math.min(text.length, start + BODY_CHUNK_LENGTH));
    chunks.push({ id: `body-${chunks.length}`, start, end, text: text.slice(start, end) });
    if (end === text.length) break;
    start = boundary(text, end - BODY_OVERLAP);
  }
  return chunks;
}
export const supportedRaster = (mediaType: string) => ['image/jpeg', 'image/png', 'image/webp'].includes(mediaType.toLowerCase());
