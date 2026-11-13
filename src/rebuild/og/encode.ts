import sharp from "sharp";

export type OgImageFormat = "jpeg" | "webp" | "png";
export function isOgImageFormat(value: unknown): value is OgImageFormat { return value === "jpeg" || value === "webp" || value === "png"; }

export async function encodeOgImage(png: Uint8Array, format: OgImageFormat) {
  const image = sharp(png, { limitInputPixels: 1200 * 630, failOn: "error" });
  if (format === "webp") return image.webp({ quality: 82, effort: 4 }).toBuffer();
  if (format === "png") return image.png({ palette: true, quality: 95, effort: 7 }).toBuffer();
  return image.jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:4:4", progressive: true }).toBuffer();
}
export function ogImageMime(format: OgImageFormat) { return format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png"; }
