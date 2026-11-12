import { getRebuildPool } from "./db";
import type { PublicShare } from "../player/SharedSong";

export function validShareSlug(slug: string) { return /^[A-Za-z0-9_-]{16}$/.test(slug); }

/** Coalesce concurrent page/API reads; deletion is visible on the very next read. */
export function createPublicShareReader(load: (slug: string) => Promise<PublicShare | undefined>) {
  const flights = new Map<string, Promise<PublicShare | undefined>>();
  return (slug: string) => {
    if (!validShareSlug(slug)) return Promise.resolve(undefined);
    const current = flights.get(slug);
    if (current) return current;
    const pending = Promise.resolve().then(() => load(slug)).finally(() => { if (flights.get(slug) === pending) flights.delete(slug); });
    flights.set(slug, pending);
    return pending;
  };
}

export const readPublicShare = createPublicShareReader(async slug => {
  const result = await getRebuildPool().query('SELECT slug, kind, payload, created_at FROM sakura_v2."Share" WHERE slug = $1 AND deleted_at IS NULL', [slug]);
  return result.rows[0] as PublicShare | undefined;
});
