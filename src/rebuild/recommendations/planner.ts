/** Provider-neutral recommendation selection. IDs refer to canonical recordings,
 * so a catalog result and an already-downloaded song cannot occupy two slots.
 * Candidate acquisition and persistence belong to separate server adapters. */
export interface Candidate {
  recordingId: string;
  artistId: string;
  genres: readonly string[];
  affinity: number;
  popularity?: number;
  durationMs?:number|null;
  /** Absent means eligible for every specification (legacy generic pools). */
  eligibleMixIds?:readonly string[];
}
export interface MixSpec {
  id: string;
  kind: 'daily' | 'discover' | 'deep-cuts' | 'repeat';
  genres: readonly string[];
  size: number;
  minimum: number;
  maxPerArtist: number;
  /** Fraction shared with ANY prior mix, measured against the shorter mix. */
  maximumOverlap: number;
  maximumDurationMs?:number;
}
export interface ListeningContext {
  seed: string;
  nowMs: number;
  heardRecordings: ReadonlySet<string>;
  familiarArtists: ReadonlySet<string>;
  blockedRecordings: ReadonlySet<string>;
  blockedArtists: ReadonlySet<string>;
  snoozedUntil: ReadonlyMap<string, number>;
  recentPlays: ReadonlyMap<string, number>;
  /** Recent plays excluded from daily/discovery/deep-cuts; repeat is intentional. */
  recentWindowMs: number;
}
export interface PlannedMix {
  id: string;
  recordingIds: string[];
  status: 'ready' | 'insufficient-candidates';
  eligibleCount: number;
  uniqueArtists: number;
  reason?: string;
}
const genre = (value: string) => value.normalize('NFKC').trim().toLowerCase();
function jitter(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}
function eligible(candidate: Candidate, spec: MixSpec, context: ListeningContext): boolean {
  const id = candidate.recordingId;
  if (!id || !candidate.artistId || !Number.isFinite(candidate.affinity)) return false;
  if(candidate.eligibleMixIds&&!candidate.eligibleMixIds.includes(spec.id))return false;
  if (context.blockedRecordings.has(id) || context.blockedArtists.has(candidate.artistId)) return false;
  if ((context.snoozedUntil.get(id) ?? 0) > context.nowMs) return false;
  if (spec.genres.length && !candidate.genres.some(g => spec.genres.some(s => genre(g) === genre(s)))) return false;
  if (spec.kind !== 'repeat' && context.nowMs - (context.recentPlays.get(id) ?? -Infinity) < context.recentWindowMs) return false;
  if (spec.kind === 'discover' && (context.heardRecordings.has(id) || context.familiarArtists.has(candidate.artistId))) return false;
  if (spec.kind === 'deep-cuts' && (context.heardRecordings.has(id) || !context.familiarArtists.has(candidate.artistId))) return false;
  if (spec.kind === 'repeat' && !context.heardRecordings.has(id)) return false;
  return true;
}
function score(candidate: Candidate, spec: MixSpec, seed: string): number {
  const popularity = Math.min(1, Math.max(0, candidate.popularity ?? 0.5));
  return candidate.affinity
    + (spec.kind === 'deep-cuts' ? (1 - popularity) * 0.35 : 0)
    + jitter(`${seed}:${spec.id}:${candidate.recordingId}`) * 0.3;
}
function validate(spec: MixSpec): void {
  if (!spec.id || !Number.isInteger(spec.size) || spec.size < 1 || !Number.isInteger(spec.minimum)
      || spec.minimum < 1 || spec.minimum > spec.size || !Number.isInteger(spec.maxPerArtist)
      || spec.maxPerArtist < 1 || !Number.isFinite(spec.maximumOverlap)
      || spec.maximumOverlap < 0 || spec.maximumOverlap > 1
      || (spec.maximumDurationMs!==undefined&&(!Number.isFinite(spec.maximumDurationMs)||spec.maximumDurationMs<=0))) throw new Error('Invalid mix selection contract.');
}
export function planMixes(specs: readonly MixSpec[], candidates: readonly Candidate[], context: ListeningContext): PlannedMix[] {
  if (!Number.isFinite(context.nowMs) || !Number.isFinite(context.recentWindowMs) || context.recentWindowMs < 0) throw new Error('Invalid listening context.');
  const canonical = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = canonical.get(candidate.recordingId);
    if (!existing || candidate.affinity > existing.affinity) canonical.set(candidate.recordingId, candidate);
  }
  const completed: Candidate[][] = [];
  const result: PlannedMix[] = [];
  for (const spec of specs) {
    validate(spec);
    const choices = [...canonical.values()].filter(c => eligible(c, spec, context));
    choices.sort((a,b) => score(b,spec,context.seed) - score(a,spec,context.seed) || a.recordingId.localeCompare(b.recordingId));
    const previous = completed.map(list => new Set(list.map(c => c.recordingId)));
    const usedArtists = new Map<string, number>();
    const overlaps = previous.map(() => 0);
    let selected: Candidate[] = [];
    let durationMs=0;
    for (const candidate of choices) {
      if(spec.maximumDurationMs!==undefined&&(!candidate.durationMs||candidate.durationMs<=0||durationMs+candidate.durationMs>spec.maximumDurationMs))continue;
      if ((usedArtists.get(candidate.artistId) ?? 0) >= spec.maxPerArtist) continue;
      if (previous.some((ids,i) => ids.has(candidate.recordingId)
          && overlaps[i] >= Math.floor(Math.min(spec.size, ids.size) * spec.maximumOverlap))) continue;
      selected.push(candidate);
      durationMs+=candidate.durationMs||0;
      usedArtists.set(candidate.artistId, (usedArtists.get(candidate.artistId) ?? 0) + 1);
      previous.forEach((ids,i) => { if (ids.has(candidate.recordingId)) overlaps[i]++; });
      if (selected.length >= spec.size) break;
    }
    // Sparse pools must also honor the final shorter-length denominator. Never
    // fill a shelf by silently relaxing the contract or relabeling a duplicate.
    let changed = true;
    while (changed) {
      changed = false;
      for (const ids of previous) {
        const common = selected.filter(c => ids.has(c.recordingId));
        const cap = Math.floor(Math.min(selected.length, ids.size) * spec.maximumOverlap);
        if (common.length <= cap) continue;
        const remove = new Set(common.slice(cap).map(c => c.recordingId));
        selected = selected.filter(c => !remove.has(c.recordingId));
        changed = true;
      }
    }
    if (selected.length < spec.minimum) {
      result.push({ id: spec.id, recordingIds: [], status: 'insufficient-candidates', eligibleCount: choices.length, uniqueArtists: 0,
        reason: 'Too few distinct recordings satisfy the genre, listening, artist and overlap constraints.' });
      continue;
    }
    // Prefer changing artists between adjacent songs without changing membership.
    const ordered: Candidate[] = [];
    const remaining = [...selected];
    while (remaining.length) {
      const index = remaining.findIndex(c => c.artistId !== ordered.at(-1)?.artistId);
      ordered.push(...remaining.splice(Math.max(0,index),1));
    }
    completed.push(ordered);
    result.push({ id: spec.id, recordingIds: ordered.map(c => c.recordingId), status: 'ready', eligibleCount: choices.length,
      uniqueArtists: new Set(ordered.map(c => c.artistId)).size });
  }
  return result;
}
