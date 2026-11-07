/** Live provider corpus audit; persists only metadata, hashes and quality counts. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { JAPANESE_LYRIC_CORPUS, type CorpusSong } from "../src/rebuild/lyrics/corpus";
import { getJapaneseTokenizer, JAPANESE_READING_VERSION, romanizeJapanese, romanizeJapaneseLines } from "../src/rebuild/lyrics/japanese";
import { parseTimedLyrics, type TimedLyric } from "../src/rebuild/lyrics/parse";
import { selectLyricsCandidate, type LrcLibTrack } from "../src/rebuild/lyrics/provider";

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
const reportPath = path.resolve("docs/rebuild/lyrics-corpus-report.json");
const MAX_ATTEMPTS = 4;

async function findSong(song: CorpusSong) {
  const searches = song.artists.flatMap((artist) => song.titles.map((title) => ({ artist, title })));
  // Search Japanese and Romanized aliases before changing the artist alias.
  let error = "No Japanese lyrics found for known artist/title aliases";
  for (const { artist, title } of searches.slice(0, MAX_ATTEMPTS)) {
    const query = new URLSearchParams({ artist_name: artist, track_name: title });
    try {
      const response = await fetch(`https://lrclib.net/api/search?${query}`, {
        headers: { "User-Agent": "Sakura/2.0 lyrics quality audit (https://github.com/billighost/sakura)" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) { error = `LRCLib HTTP ${response.status}`; continue; }
      const data = await response.json() as LrcLibTrack[];
      const candidates = data.filter((track) => song.artists.some((alias) => normalize(alias) === normalize(track.artistName)) &&
        song.titles.some((alias) => normalize(alias) === normalize(track.trackName)) &&
        /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(track.syncedLyrics || track.plainLyrics || ""));
      candidates.sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) || a.id - b.id);
      if (candidates.length) return { track: candidates[0] };
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
  }
  return { error };
}

async function auditSong(song: CorpusSong) {
  const started = performance.now();
  const found = await findSong(song);
  if (!found.track) return { requestedTitle: song.title, status: "unavailable", error: found.error, elapsedMs: Math.round(performance.now() - started) };
  const fetchedTrack = found.track;
  // This audit samples a disclosed provider recording. It does not invent an
  // expected recording duration and claim that a user's version was verified.
  const matched = selectLyricsCandidate({ title: fetchedTrack.trackName, artist: fetchedTrack.artistName, durationSeconds: fetchedTrack.duration, album: fetchedTrack.albumName, language: "ja" }, [fetchedTrack]);
  if (matched.status !== "matched") return { requestedTitle: song.title, status: matched.status, error: matched.reason };
  const track = matched.track;
  const timed = track.syncedLyrics ? parseTimedLyrics(track.syncedLyrics) : [];
  const lines: TimedLyric[] = timed.length ? timed : (track.plainLyrics || "").split(/\r?\n/).map((text) => ({ text, start: 0 }));
  const readings = await romanizeJapaneseLines(lines);
  let unresolvedTokens = 0;
  let tokens = 0;
  let kanaOrHanRemaining = 0;
  for (const line of lines) {
    const reading = await romanizeJapanese(line.text);
    unresolvedTokens += reading.tokens.filter((token) => token.source === "unresolved").length;
    tokens += reading.tokens.length;
    kanaOrHanRemaining += [...reading.romanized].filter((character) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)).length;
  }
  const sourceFieldsPreserved = readings.every((line, index) => line.text === lines[index].text && line.start === lines[index].start &&
    JSON.stringify(line.words) === JSON.stringify("words" in lines[index] ? lines[index].words : undefined));
  const originalText = lines.map((line) => line.text).join("\n");
  return {
    requestedTitle: song.title, status: "audited", provider: "lrclib", providerTrackId: track.id,
    matchedTitle: track.trackName, matchedArtist: track.artistName, album: track.albumName, durationSeconds: track.duration,
    lyricKind: timed.length ? "synced" : "plain", lineCount: lines.length, sourceCharacters: originalText.length,
    japaneseLines: lines.filter((line) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)).length,
    sourceSha256: createHash("sha256").update(originalText).digest("hex"),
    tokens, unresolvedTokens, linesNeedingReview: readings.filter((line) => line.readingReviewNeeded).length,
    kanaOrHanRemaining, sourceFieldsPreserved, elapsedMs: Math.round(performance.now() - started),
  };
}

async function main() {
  await getJapaneseTokenizer();
  const results: Awaited<ReturnType<typeof auditSong>>[] = [];
  // Two provider requests at a time, avoiding a 30-request burst to a free API.
  for (let index = 0; index < JAPANESE_LYRIC_CORPUS.length; index += 2) {
    const batch = await Promise.all(JAPANESE_LYRIC_CORPUS.slice(index, index + 2).map(auditSong));
    results.push(...batch);
    for (const row of batch) console.log(`${row.status}: ${row.requestedTitle}`);
  }
  const report = {
    runAt: new Date().toISOString(), engine: JAPANESE_READING_VERSION, provider: "https://lrclib.net/api",
    requestedSongs: JAPANESE_LYRIC_CORPUS.length, auditedSongs: results.filter((row) => row.status === "audited").length,
    method: "Fetch known title/artist aliases; select a Japanese-language provider recording; verify returned metadata; romanize complete lines; assert source fields and timing stay intact. Persist no lyric text.",
    accuracyLimit: "Automated coverage and morphology checks are not a native-speaker or singer-intended accuracy certification. Unusual proper names, poetic readings and kanji-only alternative pronunciations require licensed readings or human review.",
    results,
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`${report.auditedSongs}/${report.requestedSongs} songs audited; report: ${reportPath}`);
  if (report.auditedSongs !== report.requestedSongs || results.some((row) => row.status === "audited" && !row.sourceFieldsPreserved)) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
