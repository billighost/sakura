import crypto from "crypto";

export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD") // split accented characters into base + accent
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/\([^)]*\)/g, "") // remove anything in parentheses (like "(Remastered)", "(feat. Sia)", "(Radio Edit)")
    .replace(/\[[^\]]*\]/g, "") // remove anything in brackets
    .replace(/\s+feat\..*$/i, "") // remove " feat. ..."
    .replace(/\s+ft\..*$/i, "") // remove " ft. ..."
    .replace(/[^a-z0-9]/g, ""); // keep only alphanumeric characters
}

export function getDeterministicTrackId(title: string, artist: string): string {
  const normTitle = normalizeString(title);
  const normArtist = normalizeString(artist);
  // Fallback if somehow both are empty
  const base = `${normArtist}:${normTitle}` || "unknown:unknown";
  return crypto.createHash("md5").update(base).digest("hex");
}
