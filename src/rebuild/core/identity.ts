import type { ProviderReference, RecordingMetadata, RecordingVersion, RecordingVersionKind } from "./types";

/** Preserve every writing system; punctuation and Unicode presentation forms do not establish identity. */
export function normalizeMetadataText(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const VERSION_RULES: readonly [RecordingVersionKind, RegExp][] = [
  ["remix", /\b(?:remix|mix)\b/iu],
  ["live", /\blive\b/iu],
  ["acoustic", /\bacoustic\b/iu],
  ["instrumental", /\binstrumental\b/iu],
  ["karaoke", /\bkaraoke\b/iu],
  ["demo", /\bdemo\b/iu],
  ["sped-up", /\b(?:sped[\s-]*up|speed[\s-]*up|nightcore)\b/iu],
  ["slowed", /\b(?:slowed|slow[\s-]*reverb)\b/iu],
  ["edit", /\b(?:radio\s*edit|extended|edit|version)\b/iu],
  ["remaster", /\bremaster(?:ed)?\b/iu],
];

export interface ParsedTitle {
  base: string;
  version: RecordingVersion;
  featuredArtists: readonly string[];
}

/** Only remove a title suffix when its meaning is represented in the result. */
export function parseRecordingTitle(title: string): ParsedTitle {
  const kinds = new Set<RecordingVersionKind>();
  const labels = new Set<string>();
  const featuredArtists: string[] = [];
  const takeTag = (tag: string): boolean => {
    const parts=tag.split(/\s*;\s*/).filter(Boolean);
    if(parts.length>1&&parts.every(part=>/^\s*(?:feat\.?|ft\.?|featuring)\s+.+$/iu.test(part)||VERSION_RULES.some(([,pattern])=>pattern.test(part))||/^original(?:\s+(?:mix|version))?$/iu.test(part))){
      parts.forEach(part=>takeTag(part));return true;
    }
    const embeddedFeature=/^(.+?)\s*(?:[;,]\s*|\s+)(?:feat\.?|ft\.?|featuring)\s+(.+)$/iu.exec(tag);
    if(embeddedFeature&&(VERSION_RULES.some(([,pattern])=>pattern.test(embeddedFeature[1]))||/^original(?:\s+(?:mix|version))?$/iu.test(embeddedFeature[1].trim()))){
      takeTag(embeddedFeature[1]);takeTag(`feat. ${embeddedFeature[2]}`);return true;
    }
    const feature = /^\s*(?:feat\.?|ft\.?|featuring)\s+(.+)$/iu.exec(tag);
    if (feature) {
      featuredArtists.push(...feature[1].split(/\s*(?:,|&|\band\b)\s*/iu).filter(Boolean));
      return true;
    }
    if (/^\s*(?:original(?:\s+(?:mix|version))?|studio(?:\s+version)?)\s*$/iu.test(tag)) return true;
    const detected = VERSION_RULES.filter(([, pattern]) => pattern.test(tag)).map(([kind]) => kind);
    if (!detected.length) return false;
    detected.forEach((kind) => kinds.add(kind));
    labels.add(normalizeMetadataText(tag));
    return true;
  };
  let base = title.replace(/\(([^()]*)\)|\[([^\[\]]*)\]/gu, (full, round: string, square: string) =>
    takeTag(round ?? square) ? " " : full);
  const feature = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/iu.exec(base);
  if (feature) {
    takeTag(feature[0].trim());
    base = base.slice(0, feature.index);
  }
  const suffix = /\s[-–—]\s(.+)$/u.exec(base);
  if (suffix && takeTag(suffix[1])) base = base.slice(0, suffix.index);
  // A trailing standalone form such as "Finesse Remix" is also significant.
  const trailing = /\s+(remix|live|acoustic|instrumental|karaoke|demo|sped[\s-]*up|slowed|radio\s+edit|remaster(?:ed)?)$/iu.exec(base);
  if (trailing && takeTag(trailing[1])) base = base.slice(0, trailing.index);
  return { base: normalizeMetadataText(base), version: { kinds: [...kinds].sort(), labels: [...labels].sort() }, featuredArtists };
}

/** Source tags sometimes combine independently known credits into one performer
 * field. Only split when every part is an exact known name; punctuation in a
 * band's own name stays intact and unknown guests never become accepted aliases. */
function knownArtistParts(value: string, knownArtists: ReadonlySet<string>): readonly string[] | null {
  const normalized = normalizeMetadataText(value);
  if (knownArtists.has(normalized)) return [value];
  for (const delimiter of value.matchAll(/[,;&]|\s+and\s+/giu)) {
    const left = value.slice(0, delimiter.index).trim();
    if (!knownArtists.has(normalizeMetadataText(left))) continue;
    const rest = knownArtistParts(value.slice(delimiter.index! + delimiter[0].length).trim(), knownArtists);
    if (rest) return [left, ...rest];
  }
  return null;
}

export function normalizedRecording(metadata: RecordingMetadata, knownArtists?: readonly string[]) {
  const parsed = parseRecordingTitle(metadata.title);
  const kinds = new Set([...parsed.version.kinds, ...(metadata.version?.kinds ?? [])]);
  const labels = new Set(parsed.version.labels),featured=[...parsed.featuredArtists];
  for(const label of metadata.version?.labels??[]){
    const structured=parseRecordingTitle(`recording (${label})`);
    if(structured.version.kinds.length){structured.version.labels.forEach(value=>labels.add(value));featured.push(...structured.featuredArtists);}
    else labels.add(normalizeMetadataText(label));
  }
  const known = new Set(knownArtists ?? []);
  const artists = [...metadata.artists, ...featured].flatMap(artist=>{
    const feature=/^(.+?)\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/iu.exec(artist);
    return feature?[feature[1],...feature[2].split(/\s*(?:,|&|\band\b)\s*/iu).filter(Boolean)]:[artist];
  }).flatMap(artist => known.size ? knownArtistParts(artist, known) ?? [artist] : [artist]).map(normalizeMetadataText).filter(Boolean);
  return {
    title: parsed.base,
    primaryArtist: artists[0] ?? "",
    artists: [...new Set(artists)],
    version: { kinds: [...kinds].sort(), labels: [...labels].sort() },
    explicit: metadata.explicit ?? "unknown",
    durationMs: Number.isFinite(metadata.durationMs) && Number(metadata.durationMs) > 0 ? Number(metadata.durationMs) : null,
  };
}

/** Structured keys cannot collide when a provider, chat or ID contains separators. */
export function referenceKey(ref: ProviderReference): string {
  const id = ref.provider === "isrc" ? ref.id.replace(/[\s-]/g, "").toUpperCase() : ref.id.trim();
  if (!id) throw new Error("Provider reference requires an ID");
  if (ref.provider === "isrc" && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(id)) throw new Error("Invalid ISRC");
  if (ref.provider === "telegram" && !ref.scope?.trim()) throw new Error("Telegram references require a chat scope");
  return JSON.stringify([ref.provider, ref.scope?.trim() ?? "", id]);
}

/**
 * A caller binds aliases only after verifying the recording. Metadata similarity
 * is deliberately absent: the registry must never turn a fuzzy result into a durable identity.
 * Persist bindings in a table with UNIQUE(provider, scope, provider_id) and a transaction.
 */
export class RecordingAliases {
  private readonly aliasToRecording = new Map<string, string>();

  bind(recordingId: string, references: readonly ProviderReference[]): void {
    if (!recordingId.trim()) throw new Error("Canonical recording ID is required");
    const keys = references.map(referenceKey);
    for (const key of keys) {
      const existing = this.aliasToRecording.get(key);
      if (existing && existing !== recordingId) throw new Error("Provider alias already belongs to a different recording");
    }
    keys.forEach((key) => this.aliasToRecording.set(key, recordingId));
  }

  resolve(reference: ProviderReference): string | undefined {
    return this.aliasToRecording.get(referenceKey(reference));
  }

  resolveAll(references: readonly ProviderReference[]): string | undefined {
    const recordings = new Set(references.map((ref) => this.resolve(ref)).filter((id): id is string => !!id));
    if (recordings.size > 1) throw new Error("Conflicting canonical references require review");
    return [...recordings][0];
  }

  entries(): readonly { reference: ProviderReference; recordingId: string }[] {
    return [...this.aliasToRecording].map(([key, recordingId]) => {
      const [provider, scope, id] = JSON.parse(key) as [ProviderReference["provider"], string, string];
      return { reference: { provider, id, ...(scope ? { scope } : {}) }, recordingId };
    });
  }
}
