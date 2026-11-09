import type { BloomListeningProfile } from "../../uiTypes";
import { stableCos, stableSin } from "../stableTrig";

export const PAINTING_BANDS = ["dawn", "day", "evening", "night"] as const;
export type PaintingLayout = "orbit" | "ribbon" | "fan" | "gallery";

/** Integer mixing keeps authored geometry identical on the server and browser. */
export function paintingFraction(seed: number, salt: number) {
  let value = ((Number.isFinite(seed) ? seed : 0) >>> 0) ^ Math.imul(salt + 1, 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Bands are decoration until the hour chapter discloses real measurements. */
export function listeningPaintingLayout(seed: number, composition: number, stage: number, listening?: BloomListeningProfile) {
  const layout = (["orbit", "ribbon", "fan", "gallery"] as const)[((composition + stage) % 4 + 4) % 4];
  const values = PAINTING_BANDS.map(id => (listening?.hourBands || []).filter(band => band.id === id).reduce((total, band) => total + (Number.isFinite(band.audibleMs) && band.audibleMs > 0 ? band.audibleMs : 0), 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const rotation = paintingFraction(seed, 71 + stage) * .7 - .35;
  const bands = PAINTING_BANDS.map((id, index) => {
    const angle = index / 4 * Math.PI * 2 - Math.PI / 2 + rotation;
    const share = total ? values[index] / total : undefined;
    const x = layout === "orbit" ? 240 + stableCos(angle) * 158 : 64 + index * 116 + (paintingFraction(seed, index + stage * 7) - .5) * 12;
    const y = layout === "orbit" ? 108 + stableSin(angle) * 65 : layout === "ribbon" ? 94 + stableSin(index * 1.6 + rotation) * 23 : 94 + paintingFraction(seed, 21 + index + stage) * 25;
    return { id, x, y, angle, share, audibleMs: total ? values[index] : undefined, scale: share === undefined ? 1 : .62 + Math.sqrt(share) * 1.05, turn: (paintingFraction(seed, 40 + index) - .5) * 30 };
  });
  return { layout: layout as PaintingLayout, measured: total > 0, bands, rotation };
}
