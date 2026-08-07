/**
 * URL-safe nanoid — no dependency needed.
 *
 * Uses `crypto.getRandomValues` so it's available in every JS runtime
 * (browser, Node, Edge) and doesn't block the event loop.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function nanoid(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
