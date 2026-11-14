/** Source-backed Tamil stress check. Full captured lyrics remain in .local. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { lyricReadingLanguage, readingEngine } from "../src/rebuild/lyrics/language";
import { romanizeLyricLines } from "../src/rebuild/lyrics/readings";
import { READING_SONG_EXCERPTS, type ReadingSongExcerpt } from "./fixtures/reading-song-excerpts";

interface SourceSong extends Omit<ReadingSongExcerpt, "capture"> {
  references: NonNullable<ReadingSongExcerpt["references"]>;
  nativeLines: string[];
  latinLines: string[];
  capture?: { nativePath?: string; latinPath?: string; capturedAt?: string; nativeSha256?: string; url?: string };
}

const args = process.argv.slice(2);
const phase = args.includes("--baseline") ? "baseline" : "final";
const partial = args.includes("--partial");
const corpusArgument = args.indexOf("--corpus");
const corpusFiles = corpusArgument >= 0 ? [args[corpusArgument + 1]]
  : ["a", "b", "c", "d", "e"].map(batch => `.local/tamil-100/${batch}/corpus.json`);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceText = (text: string) => text.normalize("NFC").replace(/[\s\p{P}\u200c\u200d]/gu, "").toLowerCase();
const nativeLetter = (text: string) => [...text].some(character => /\p{Script=Tamil}/u.test(character) && /\p{L}/u.test(character));

async function transformFullSong(lines: readonly string[]) {
  const transformed: Array<{ text: string; sourceIndex: number; romanized: string }> = [];
  let batch: Array<{ text: string; sourceIndex: number }> = [], characters = 0;
  const flush = async () => {
    if (batch.length) transformed.push(...await romanizeLyricLines(batch, "ta", undefined, "Tamil"));
    batch = []; characters = 0;
  };
  for (const [sourceIndex, text] of lines.entries()) {
    assert.ok(text.length <= 20_000, "A single source line exceeds the reading request limit");
    if (batch.length === 400 || characters + text.length > 20_000) await flush();
    batch.push({ text, sourceIndex }); characters += text.length;
  }
  await flush();
  return transformed;
}

async function main() {
  const corpusCorrections = await readFile("docs/rebuild/tamil-corpus-corrections.json", "utf8").then(raw => JSON.parse(raw) as Array<{ songId: string; originalExpectedExcerpt: string; correctedExpectedExcerpt: string; reason: string }>).catch(() => []);
  const baselineRaw = await readFile(".local/tamil-100/baseline-frozen.json", "utf8").catch(() => undefined);
  const baseline = baselineRaw ? JSON.parse(baselineRaw) as { engine: string; summary: { excerptChecksPassed: number }; cases: Array<{ id: string; excerpt: { expectedSha256: string } }> } : undefined;
  const songs: SourceSong[] = [];
  const skipped: string[] = [];
  for (const file of corpusFiles) {
    try {
      const raw: unknown = JSON.parse(await readFile(file, "utf8"));
      const entries = Array.isArray(raw) ? raw : (raw as { songs?: unknown[] }).songs;
      assert.ok(Array.isArray(entries), `${file}: a source-song array is required`);
      songs.push(...entries as SourceSong[]);
    } catch (error) {
      if (!partial) throw error;
      skipped.push(file);
    }
  }
  if (!partial) assert.equal(songs.length, 100, "The expanded check requires 100 additional songs");
  assert.ok(songs.length, "No completed source corpus is available");
  assert.equal(new Set(songs.map(song => song.id)).size, songs.length, "Each additional song needs a distinct ID");
  assert.equal(new Set(songs.map(song => sourceText(song.title))).size, songs.length, "Song titles must be distinct");
  const existing = READING_SONG_EXCERPTS.filter(song => song.language === "ta");
  const verifiedCaptures = new Set<string>();
  for (const song of songs) {
    if (song.capture?.nativePath && song.capture.nativeSha256) {
      const capturePath = path.resolve(song.capture.nativePath);
      assert.ok(capturePath.startsWith(path.resolve(".local/tamil-100") + path.sep), `${song.id}: capture must remain inside the local research directory`);
      assert.equal(hash(await readFile(capturePath, "utf8")), song.capture.nativeSha256, `${song.id}: captured source hash changed`);
      verifiedCaptures.add(song.id);
    }
    assert.ok(!existing.some(previous => previous.id === song.id || sourceText(previous.title) === sourceText(song.title)), `${song.id}: already checked among the original fifteen`);
    assert.equal(song.language, "ta");
    assert.ok(song.text && song.expected && song.references?.sourceReading, `${song.id}: independently fixed native and Roman excerpts are required`);
    assert.ok(song.references.native.length && song.references.reading.length, `${song.id}: both reference types are required`);
    assert.ok(Array.isArray(song.nativeLines) && song.nativeLines.length && song.nativeLines.every(line => typeof line === "string"), `${song.id}: full native lyrics are required`);
    assert.ok(Array.isArray(song.latinLines) && song.latinLines.length, `${song.id}: independently printed full Roman lyrics are required`);
    assert.ok(nativeLetter(song.text), `${song.id}: this excerpt does not exercise Tamil script`);
  }
  const results = [];
  for (const song of songs) {
    const original = { text: song.text, start: 12, end: 19, words: [{ text: song.text, start: 12.2, end: 18.8 }] };
    const [excerpt] = await romanizeLyricLines([original], "ta", undefined, "Tamil");
    const full = await transformFullSong(song.nativeLines);
    const excerptCorrect = excerpt.romanized.normalize("NFC") === song.expected.normalize("NFC");
    const excerptInSource = sourceText(song.nativeLines.join(" ")).includes(sourceText(song.text));
    const sourcePreserved = full.length === song.nativeLines.length && full.every((line, index) => line.text === song.nativeLines[index] && line.sourceIndex === index);
    const unconvertedNativeLines = full.filter(line => nativeLetter(line.romanized)).length;
    const remainingNativeMarkLines = full.filter(line => [...line.romanized].some(character => /\p{Script=Tamil}/u.test(character) && /\p{M}/u.test(character))).length;
    const timingPreserved = excerpt.text === original.text && excerpt.start === original.start && excerpt.end === original.end && JSON.stringify(excerpt.words) === JSON.stringify(original.words);
    const detected = lyricReadingLanguage(song.text, "Tamil");
    const prior = baseline?.cases.find(previous => previous.id === song.id);
    if (phase === "final" && prior && prior.excerpt.expectedSha256 !== hash(song.expected.normalize("NFC"))) {
      const correction = corpusCorrections.find(correction => correction.songId === song.id);
      assert.ok(correction, `${song.id}: an independently justified expectation correction is required`);
      assert.equal(hash(correction.originalExpectedExcerpt.normalize("NFC")), prior.excerpt.expectedSha256);
      assert.equal(correction.correctedExpectedExcerpt.normalize("NFC"), song.expected.normalize("NFC"));
    }
    const passed = excerptCorrect && excerptInSource && sourcePreserved && timingPreserved && !unconvertedNativeLines && detected === "ta";
    const result = {
      id: song.id, title: song.title, artist: song.artist, references: song.references,
      captureEvidence: { capturedAt: song.capture?.capturedAt, bodySha256: song.capture?.nativeSha256, hashVerified: verifiedCaptures.has(song.id) },
      excerpt: { text: song.text, expected: song.expected, actual: excerpt.romanized, correct: excerptCorrect, sourceExcerptFound: excerptInSource, originalAndTimingPreserved: timingPreserved, detectedLanguage: detected, expectedSha256: hash(song.expected.normalize("NFC")) },
      fullSong: { source: "independently captured native lyric page", lines: full.length, nativeSourceSha256: hash(JSON.stringify(song.nativeLines)), romanSourceSha256: hash(JSON.stringify(song.latinLines)), sourceTextAndOrderPreserved: sourcePreserved, unconvertedNativeLines, remainingNativeMarkLines, timing: "The source page is untimed; only the short regression excerpt uses synthetic sentinel timing fields." },
      passed,
    };
    results.push(result);
    console.log(JSON.stringify({ id: song.id, correct: excerptCorrect, sourceExcerptFound: excerptInSource, lines: full.length, passed }));
  }
  const failures = results.filter(result => !result.passed);
  const report = {
    checkedAt: new Date().toISOString(), phase, engine: readingEngine("ta"),
    scope: "100 additional real Tamil songs, independently fixed native/Roman excerpts and complete captured native lyric pages. Full lyrics remain ignored locally.",
    summary: { additionalSongs: results.length, existingTamilSongs: existing.length, totalTamilSongs: existing.length + results.length, excerptChecksPassed: results.filter(result => result.excerpt.correct).length, fullNativeLines: results.reduce((sum, result) => sum + result.fullSong.lines, 0), linesWithPreservedMalformedNativeMarks: results.reduce((sum, result) => sum + result.fullSong.remainingNativeMarkLines, 0), passed: results.length - failures.length, failures: failures.map(result => result.id), incompleteCorpusFiles: skipped },
    cases: results,
    baseline: baseline && baselineRaw ? { engine: baseline.engine, excerptChecksPassed: baseline.summary.excerptChecksPassed, snapshotSha256: hash(baselineRaw) } : undefined,
    independentlyVerifiedCorpusCorrections: corpusCorrections,
    limitations: ["Full-source processing checks text/order preservation and remaining script, not manual pronunciation of every sung word.", "Printed Roman lyrics use informal vowel/consonant notation; expected excerpts retain native written distinctions under the documented conventional guide.", "Untimed source pages do not establish provider synchronization or singer-specific pronunciation.", "Source spelling errors remain original; references and source hashes distinguish corpus corrections from engine changes."],
  };
  await mkdir(".local/tamil-100", { recursive: true });
  await writeFile(`.local/tamil-100/${phase}-report.json`, JSON.stringify(report, null, 2));
  if (phase === "final" && !partial && !failures.length) {
    const fixtures = songs.map(({ id, language, title, artist, artists, text, expected, mode, references }) => ({ id, language, title, artist, artists, text, expected, mode, references }));
    await writeFile("scripts/fixtures/tamil-song-stress-excerpts.json", JSON.stringify(fixtures, null, 2) + "\n");
    const publicReport = { ...report, cases: results.map(({ references, excerpt, ...result }) => {
      const { text, expected, actual, ...evidence } = excerpt;
      return { ...result, references: { native: references.native, reading: references.reading, convention: references.convention }, excerpt: { ...evidence, fixtureId: result.id, nativeExcerptSha256: hash(text), expectedSha256: hash(expected.normalize("NFC")), actualSha256: hash(actual.normalize("NFC")) } };
    }) };
    await writeFile("docs/rebuild/tamil-stress-report.json", JSON.stringify(publicReport, null, 2) + "\n");
  }
  console.log(JSON.stringify({ report: path.resolve(`.local/tamil-100/${phase}-report.json`), summary: report.summary }));
  if (failures.length) process.exitCode = 1;
}

void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
