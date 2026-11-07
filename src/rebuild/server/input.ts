import { InputError } from "./contracts";
import type { ResolveRecordingInput } from "./contracts";
import type { RecordingMetadata, RecordingVersion, RecordingVersionKind } from "../core/types";
import { sameRequestOrigin } from "../requestOrigin";

const KINDS = new Set<RecordingVersionKind>(["remix", "live", "acoustic", "instrumental", "karaoke", "demo", "sped-up", "slowed", "edit", "remaster"]);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new InputError(`${label} must be non-empty text up to ${max} characters`);
  return value.trim();
}
function textArray(value: unknown, label: string, maxItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new InputError(`${label} must be a bounded text array`);
  return value.map((item) => text(item, label, 300));
}

export function parseRecordingMetadata(value: unknown): RecordingMetadata {
  const input = object(value);
  const title = text(input.title, "title");
  const artists = textArray(input.artists, "artists", 20);
  if (!artists.length) throw new InputError("At least one artist is required");
  if(input.artistsComplete!==undefined&&typeof input.artistsComplete!=="boolean")throw new InputError("artistsComplete must be a boolean");
  let durationMs: number | null = null;
  if (input.durationMs !== undefined && input.durationMs !== null) {
    if (typeof input.durationMs !== "number" || !Number.isSafeInteger(input.durationMs) || input.durationMs <= 0 || input.durationMs > 24 * 60 * 60 * 1000) throw new InputError("durationMs must be a positive integer of milliseconds, up to 24 hours");
    durationMs = input.durationMs;
  }
  let version: RecordingVersion | undefined;
  if (input.version !== undefined) {
    const raw = object(input.version);
    const kinds = textArray(raw.kinds, "version kinds", 10);
    if (kinds.some((kind) => !KINDS.has(kind as RecordingVersionKind))) throw new InputError("Unknown recording version kind");
    version = { kinds: kinds as RecordingVersionKind[], labels: textArray(raw.labels ?? [], "version labels", 10) };
  }
  if (input.explicit !== undefined && !["unknown", "clean", "explicit"].includes(String(input.explicit))) throw new InputError("explicit must be unknown, clean or explicit");
  return { title, artists, durationMs,...(input.artistsComplete!==undefined?{artistsComplete:input.artistsComplete as boolean}:{}),...(version ? { version } : {}), explicit: input.explicit as RecordingMetadata["explicit"] ?? "unknown" };
}

export function parseResolveInput(value: unknown): ResolveRecordingInput {
  const input = object(value);
  const reference = object(input.reference);
  const provider = text(reference.provider, "provider", 40);
  const id = text(reference.id, "provider ID", 128);
  if (provider !== "deezer" && provider !== "spotify") throw new InputError("Public resolution accepts deezer or spotify catalogue references");
  if (provider === "deezer" && !/^[1-9]\d{0,17}$/.test(id)) throw new InputError("Deezer ID must be a positive decimal catalogue ID");
  if (provider === "spotify" && !/^[A-Za-z0-9]{22}$/.test(id)) throw new InputError("Spotify track ID must be 22 alphanumeric characters");
  return { reference: { provider, id }, ...(input.expected !== undefined ? { expected: parseRecordingMetadata(input.expected) } : {}) };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizedAudioMime(value: string): string { return value.split(";")[0].trim().toLowerCase(); }
const AUDIO_MIMES = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/flac", "audio/x-flac", "audio/ogg", "audio/opus", "audio/wav", "audio/x-wav", "audio/webm"]);
export function supportedAudioMime(value: string): boolean { return AUDIO_MIMES.has(normalizedAudioMime(value)); }

export async function readRequestJson(request: Request): Promise<unknown> {
  if (!sameRequestOrigin(request)) throw new InputError("Request origin does not match this application");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) throw new InputError("Content-Type must be application/json");
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("A JSON request body is required");
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { void reader.cancel(); reject(new InputError("Request body timed out")); }, 5000);
  });
  try {
    const read = async () => {
      const parts: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32768) { await reader.cancel(); throw new InputError("Request body must be at most 32KB"); }
        parts.push(value);
      }
      const buffer = new Uint8Array(bytes);
      let at = 0;
      for (const part of parts) { buffer.set(part, at); at += part.length; }
      let json: unknown;
      try { json = JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new InputError("Request body must be valid JSON"); }
      return json;
    };
    return await Promise.race([read(), timeout]);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export async function readResolveInput(request:Request):Promise<ResolveRecordingInput>{return parseResolveInput(await readRequestJson(request));}
