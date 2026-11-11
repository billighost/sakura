/** Bounded, read-only comparison of live catalogue/provider metadata to HEAD.
 * No audio, publication, account data or acquisition. Evidence stays ignored.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import { selectLyricsCandidate, type LyricIdentity, type LyricMatch, type LrcLibTrack } from "../src/rebuild/lyrics/provider";
import { JAPANESE_LYRIC_CORPUS } from "../src/rebuild/lyrics/corpus";
import { parseTimedLyrics } from "../src/rebuild/lyrics/parse";
import { createLyricTransport } from "../src/rebuild/lyrics/transport";

interface CatalogTrack { id: number; title: string; title_version?: string; duration: number; artist: { name: string }; album: { title: string }; contributors?: { name: string }[] }
const examples = [
  { title: "We Don't Talk Anymore", artist: "Charlie Puth" },
  { title: "INDUSTRY BABY", artist: "Lil Nas X" },
  { title: "Levitating", artist: "Dua Lipa" },
  { title: "Hips Don't Lie", artist: "Shakira" },
  { title: "Let It Be", artist: "The Beatles" },
  { title: "Starman", artist: "David Bowie" },
  { title: "I Want To Break Free", artist: "Queen" },
  { title: "Halo", artist: "Beyoncé" },
  { title: "What Was I Made For", artist: "Billie Eilish" },
  { title: "My Heart Will Go On", artist: "Céline Dion" },
  { title: "Unchained Melody", artist: "The Righteous Brothers" },
  { title: "愛にできることはまだあるかい", artist: "RADWIMPS" },
  { title: "光年之外", artist: "G.E.M." },
  { title: "打上花火", artist: "DAOKO" },
  { title: "Stay", artist: "The Kid LAROI" },
];

async function main() {
  const baselineCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const baselineSource = execFileSync("git", ["show", `${baselineCommit}:src/rebuild/lyrics/provider.ts`], { encoding: "utf8" });
  const compiled = ts.transpileModule(baselineSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const baseline: { selectLyricsCandidate?: typeof selectLyricsCandidate } = {};
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (name === "node:crypto") return { createHash };
    if (name === "./corpus") return { JAPANESE_LYRIC_CORPUS };
    if (name === "./parse") return { parseTimedLyrics };
    if (name === "./transport") return { createLyricTransport };
    throw new Error("Unexpected baseline dependency: " + name);
  }, { exports: baseline }, baseline);
  const startedAt = Date.now(), deadline = startedAt + 15 * 60_000;
  const prior = process.argv.includes("--resume") ? JSON.parse(await readFile(".local/lyrics-discovery-live.json", "utf8")) : null;
  let requests = prior?.metadataRequestCount || 0;
  const upstreams: { url: string; status: number; responseBytes: number }[] = prior?.upstreams || [];
  const exactOnly = process.argv.includes("--exact-only");
  const cases: unknown[] = exactOnly ? prior?.cases || [] : [];
  let exactProbe: unknown;
  const report = () => ({ checkedAt: new Date().toISOString(), baselineCommit, scope: "Live candidate comparison against unmodified HEAD selector; search result sets are not proof the old full provider had no other candidate", metadataRequestCount: requests, metadataRequestLimit: 50, responseBytes: upstreams.reduce((sum, item) => sum + item.responseBytes, 0), priorAttempts: exactOnly ? prior?.priorAttempts || [] : prior?.cases || [], exactProbe, cases, upstreams });
  await mkdir(".local", { recursive: true });
  const save = () => writeFile(".local/lyrics-discovery-live.json", JSON.stringify(report(), null, 2));
  async function read(url: string) {
    if (requests >= 50 || Date.now() >= deadline) throw new Error("Metadata audit budget reached");
    requests++;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error", headers: { "User-Agent": "Sakura/2.0 read-only lyrics metadata audit" } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    upstreams.push({ url, status: response.status, responseBytes: bytes.byteLength });
    if (bytes.byteLength > 2_000_000) throw new Error("Provider response exceeded metadata budget");
    if (!response.ok) throw new Error("Provider HTTP " + response.status);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const summarize = (match: LyricMatch) => match.status === "matched" ? { status: match.status, id: match.track.id, title: match.track.trackName, artist: match.track.artistName, album: match.track.albumName, duration: match.track.duration, timing: match.track.syncedLyrics ? "synced" : "plain" } : { status: match.status, reason: match.reason };
  for (const [index, example] of (exactOnly ? [] : examples).entries()) {
    try {
      const catalog = await read("https://api.deezer.com/search?" + new URLSearchParams({ q: `${example.title} ${example.artist}`, limit: "5" })) as { data?: CatalogTrack[] };
      const summary = catalog.data?.find(item => item.artist.name.toLowerCase() === example.artist.toLowerCase());
      if (!summary) { cases.push({ query: example, limitation: "No catalogue metadata returned" }); await save(); continue; }
      const track = index < 5 ? await read(`https://api.deezer.com/track/${summary.id}`) as CatalogTrack : summary;
      if (!track.title || !track.artist?.name || !track.duration) throw new Error("Incomplete catalogue metadata");
      const identity: LyricIdentity = { title: track.title, artist: track.artist.name, artists: track.contributors?.map(item => item.name), album: track.album.title, durationSeconds: track.duration };
      const candidates = await read("https://lrclib.net/api/search?" + new URLSearchParams({ track_name: example.title, artist_name: track.artist.name })) as LrcLibTrack[];
      if (!Array.isArray(candidates)) throw new Error("Unexpected provider response");
      const old = baseline.selectLyricsCandidate!(identity, candidates), current = selectLyricsCandidate(identity, candidates);
      const improvedCandidates = candidates.filter(candidate => baseline.selectLyricsCandidate!(identity, [candidate]).status !== "matched" && selectLyricsCandidate(identity, [candidate]).status === "matched");
      cases.push({ query: example, catalogId: track.id, identity, baseline: summarize(old), current: summarize(current), candidateCount: candidates.length, improvedCandidates: improvedCandidates.map(candidate => summarize({ status: "matched", track: candidate, provider: "lrclib" })), controls: {
        wrongArtist: summarize(selectLyricsCandidate({ ...identity, artist: "Unrelated audit performer", artists: [] }, candidates)),
        instrumental: summarize(selectLyricsCandidate({ ...identity, title: identity.title + " (Instrumental)" }, candidates)),
      } });
      await writeFile(`.local/lyrics-discovery-candidates-${index + 1}.json`, JSON.stringify({ identity, candidates }, null, 2));
      console.log(JSON.stringify({ query: example.title, catalogue: identity.title, baseline: old.status, current: current.status, improvedCandidates: improvedCandidates.length }));
    } catch (error) { cases.push({ query: example, limitation: error instanceof Error ? error.message : String(error) }); }
    await save();
  }
  if (exactOnly) {
    const item = prior.cases.find((entry: { query?: { title: string } }) => entry.query?.title === "Starman");
    const identity = item.identity as LyricIdentity;
    const url = "https://lrclib.net/api/get?" + new URLSearchParams({ track_name: identity.title, artist_name: identity.artist, album_name: identity.album!, duration: String(identity.durationSeconds) });
    try {
      const candidate = await read(url) as LrcLibTrack;
      exactProbe = { catalogId: item.catalogId, identity, baseline: summarize(baseline.selectLyricsCandidate!(identity, [candidate])), current: summarize(selectLyricsCandidate(identity, [candidate])), candidate: { id: candidate.id, title: candidate.trackName, artist: candidate.artistName, album: candidate.albumName, duration: candidate.duration }, limitation: "An exact-response comparison plus the broad live search pool; the full old fallback service was not replayed" };
    } catch (error) { exactProbe = { identity, limitation: error instanceof Error ? error.message : String(error) }; }
  }
  // The reported instrumental edition is a rejection control, never a vocal success.
  const title = "众里寻他千百度(电视剧《逐玉》爱情主题曲) (The Endless Quest (Love Theme Song from the TV Series ''Pursuit of Jade'')) (伴奏版)";
  if (!exactOnly) cases.push({ reportedInstrumentalControl: summarize(selectLyricsCandidate({ title, artist: "张碧晨", durationSeconds: 180 }, [{ id: 1, trackName: title, artistName: "张碧晨", duration: 180, plainLyrics: "Vocal text must not pass" }])), controlKind: "fixture-only, reported catalogue title and vocal candidate with identical title/duration" });
  await save();
  console.log(JSON.stringify({ requests, elapsedMs: Date.now() - startedAt, evidence: ".local/lyrics-discovery-live.json" }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
