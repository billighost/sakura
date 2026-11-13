export interface ArtworkDimensions { width: number; height: number }
const valid = (width: number, height: number): ArtworkDimensions | null =>
  Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { width, height } : null;

/** Read common raster headers without first allocating a full decoded bitmap.
 * Unknown/extended containers keep the browser's original decode path. */
export function artworkDimensions(bytes: Uint8Array): ArtworkDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, text: string) => offset + text.length <= bytes.length && [...text].every((letter, index) => bytes[offset + index] === letter.charCodeAt(0));
  if (bytes.length >= 24 && tag(1, "PNG\r\n\x1a\n") && bytes[0] === 137 && tag(12, "IHDR"))
    return valid(view.getUint32(16), view.getUint32(20));
  if (bytes.length >= 30 && tag(0, "RIFF") && tag(8, "WEBP")) {
    if (tag(12, "VP8X")) return valid(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16));
    if (tag(12, "VP8 ") && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  if (bytes.length >= 25 && tag(0, "RIFF") && tag(8, "WEBP") && tag(12, "VP8L") && bytes[20] === 47)
    return valid(1 + ((bytes[21] | bytes[22] << 8) & 0x3fff), 1 + ((bytes[22] >> 6 | bytes[23] << 2 | bytes[24] << 10) & 0x3fff));
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) return null;
      while (at < bytes.length && bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) return null;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (at + 2 > bytes.length) return null;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) return null;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && length >= 7)
        return valid(view.getUint16(at + 5), view.getUint16(at + 3));
      at += length;
    }
  }
  return null;
}

/** Keep aspect ratio; never upscale a small source. Square covers can use the
 * exact destination dimensions, while unknown/non-square sources keep their
 * original geometry and the established canvas crop. */
export function artworkBitmapOptions(dimensions: ArtworkDimensions | null, paintedSize: number): ImageBitmapOptions | undefined {
  if (!dimensions || dimensions.width !== dimensions.height || dimensions.width <= paintedSize) return;
  return { resizeWidth: paintedSize, resizeHeight: paintedSize, resizeQuality: "high" };
}
