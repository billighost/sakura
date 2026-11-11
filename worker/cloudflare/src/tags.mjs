import { parseBuffer } from 'music-metadata';

const truncated = value => typeof value === 'string' && /(?:…|\.{3})\s*$/u.test(value);
export const needsTagRecovery = audio => truncated(audio.metadata.title) || audio.metadata.artists.some(truncated);
export async function recoverEmbeddedMetadata(audio, stream) {
  // Inspect at most 1 MiB, including artwork embedded before title/artist tags.
  // Never complete a displayed ellipsis with catalogue
  // text: only the actual file's embedded tags can replace truncated fields.
  const parts = []; let count = 0;
  for await (const chunk of stream) { parts.push(chunk); count += chunk.length; }
  const bytes = Buffer.concat(parts, count);
  const parsed = await parseBuffer(bytes, { mimeType: audio.mimeType, size: bytes.length }, { duration: false, skipCovers: true, skipPostHeaders: true });
  const title = parsed.common.title, artists = parsed.common.artists || (parsed.common.artist ? [parsed.common.artist] : []);
  if (!title || !artists.length || truncated(title) || artists.some(truncated) || title.length > 500 || artists.length > 20 || artists.some(v => v.length > 300)) return null;
  return { title, artists, artistsComplete: true, durationMs: audio.metadata.durationMs };
}
