/**
 * End-to-end check: does downloading a specific song actually return that song?
 *
 * Written for the "it says downloaded but it won't play" class of bug, where the
 * download path silently returns a *different* track. YOASOBI's アイドル is a good
 * probe for two reasons:
 *
 *   1. Its canonical title is Japanese. Searching "YOASOBI Idol" — which is what
 *      a person types — has to survive a title that shares no characters with the
 *      query.
 *   2. "Idol" is a wildly common title, and the provider itself returns decoys:
 *      "Idol Yoasobi Instrumental" by Bluee, "アイドル Yoasobi" by Get A Better
 *      Beat. A matcher that only checks the title will take one of those.
 *
 * This drives the real `searchAndSelect` on the real bot and then reads the
 * bytes back, so it exercises the actual code path rather than a lookalike.
 * Nothing is written to the database.
 *
 * Run: node --experimental-strip-types scripts/verify-yoasobi-download.ts
 */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, "..", ".env"), quiet: true });

import { getTelegramClient } from "../src/lib/telegram.ts";

const DEEZER_TRACK_ID = 2210493097;

/** Read the ID3v2 TIT2/TPE1 frames straight out of the returned bytes. */
function readId3(buf: Buffer): { title?: string; artist?: string } {
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return {};

  // Syncsafe integer: 7 bits per byte.
  const size =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const end = Math.min(10 + size, buf.length);

  const out: { title?: string; artist?: string } = {};
  let p = 10;

  while (p + 10 <= end) {
    const id = buf.toString("latin1", p, p + 4);
    const fsize = buf.readUInt32BE(p + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || fsize <= 0 || p + 10 + fsize > end) break;

    if (id === "TIT2" || id === "TPE1") {
      const body = buf.subarray(p + 10, p + 10 + fsize);
      const enc = body[0];
      let text: string;
      // 1 = UTF-16 with BOM, 3 = UTF-8, 0 = latin1. Japanese tags use 1 or 3.
      if (enc === 1) text = body.subarray(1).toString("utf16le").replace(/^﻿/, "");
      else if (enc === 3) text = body.subarray(1).toString("utf8");
      else text = body.subarray(1).toString("latin1");
      text = text.replace(/\0+$/, "").trim();
      if (id === "TIT2") out.title = text;
      else out.artist = text;
    }
    p += 10 + fsize;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9　-鿿＀-￯]/g, "");

(async () => {
  // ── 1. What is this song actually called? ────────────────────────────────
  const dz = await fetch(`https://api.deezer.com/track/${DEEZER_TRACK_ID}`).then((r) => r.json());
  const canonical = { title: dz.title as string, artist: dz.artist.name as string, duration: dz.duration as number };

  console.log(`\n  Canonical (provider):`);
  console.log(`    title    ${canonical.title}`);
  console.log(`    artist   ${canonical.artist}`);
  console.log(`    duration ${canonical.duration}s`);
  console.log(`\n  Note: a user types "YOASOBI Idol" — the real title shares no characters with that.`);

  // ── 2. Ask the bot, the way the app does ─────────────────────────────────
  const client = getTelegramClient();
  await client.acquire();

  try {
    const query = `https://www.deezer.com/track/${DEEZER_TRACK_ID}`;
    console.log(`\n  searchAndSelect(${query})`);
    console.log(`    expectedTitle  "${canonical.title}"`);
    console.log(`    expectedArtist "${canonical.artist}"`);

    const started = Date.now();
    const result = await client.searchAndSelect(
      query,
      canonical.duration,
      15000,
      90000,
      canonical.title,
      canonical.artist,
    );
    console.log(`\n  Bot returned in ${((Date.now() - started) / 1000).toFixed(1)}s:`);
    console.log(`    messageId ${result.messageId}`);
    console.log(`    title     ${result.title}`);
    console.log(`    artist    ${result.artist}`);
    console.log(`    duration  ${result.duration}s`);

    // ── 3. Read the actual bytes and check the tags agree ──────────────────
    const { stream, size } = await client.getAudioStream(result.messageId, 0, 256 * 1024);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const head = Buffer.concat(chunks);
    const tags = readId3(head);

    console.log(`\n  File on the wire:`);
    console.log(`    size      ${(size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`    ID3 title  ${tags.title ?? "(none)"}`);
    console.log(`    ID3 artist ${tags.artist ?? "(none)"}`);

    // ── 4. Verdict ────────────────────────────────────────────────────────
    const titleSeen = tags.title ?? result.title ?? "";
    const artistSeen = tags.artist ?? result.artist ?? "";

    const titleMatch =
      norm(titleSeen).includes(norm(canonical.title)) ||
      norm(canonical.title).includes(norm(titleSeen));
    const artistMatch =
      norm(artistSeen).includes(norm(canonical.artist)) ||
      norm(canonical.artist).includes(norm(artistSeen));
    // A 30-second preview instead of the full song is its own failure mode.
    const durationMatch = Math.abs((result.duration || 0) - canonical.duration) <= 5;
    const bigEnough = size > 1_000_000;

    console.log(`\n  Checks:`);
    console.log(`    title matches canonical    ${titleMatch ? "PASS" : "FAIL"}`);
    console.log(`    artist matches canonical   ${artistMatch ? "PASS" : "FAIL"}`);
    console.log(`    duration within 5s         ${durationMatch ? "PASS" : `FAIL (${result.duration}s vs ${canonical.duration}s)`}`);
    console.log(`    full file, not a preview   ${bigEnough ? "PASS" : `FAIL (${size} bytes)`}`);

    const ok = titleMatch && artistMatch && durationMatch && bigEnough;
    console.log(`\n  ${ok ? "CORRECT — the file is the song that was asked for." : "WRONG FILE — the download path returned something else."}\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await client.release();
    // The client holds an idle socket open on purpose; nothing else to wait for.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  }
})();
