import { createHash } from "node:crypto";
import { fetchLrcLibLyrics, lyricIdentityVariants, selectLyricsCandidate, type LrcLibTrack, type LyricIdentity, type LyricMatch } from "./provider";
import { createLyricTransport, type LyricProviderOptions, type LyricResponse } from "./transport";
import { lyricEdition } from "./identity";
import { parseTimedLyrics } from "./parse";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const failure = (responses: LyricResponse[], emptyReason: string): LyricMatch => {
  const failed = responses.filter((value): value is Extract<LyricResponse, {status: "unavailable"}> => value.status === "unavailable");
  return failed.length ? { status: "unavailable", reason: failed[0].reason, ...(failed.some(value => value.retryAfterMs) ? {retryAfterMs: Math.max(...failed.map(value => value.retryAfterMs || 0))} : {}) } : { status: "missing", reason: emptyReason };
};

/** NetEase returns recording metadata first, so lyric retrieval never picks a similarly named cover. */
export async function fetchNetEaseLyrics(identity: LyricIdentity, options: LyricProviderOptions = {}): Promise<LyricMatch> {
  const transport = createLyricTransport(options, "NetEase"), responses: LyricResponse[] = [];
  const variants = lyricIdentityVariants(identity);
  const queries = [...new Set(variants.titles.slice(0, 3).flatMap(title => variants.artists.slice(0, 8).map(artist => `${title} ${artist}`)))].slice(0, 16);
  for (const query of queries) {
    const response = await transport.read(`https://music.163.com/api/search/get?${new URLSearchParams({s: query, type: "1", limit: "30"})}`);
    responses.push(response);
    if (response.status !== "ok") continue;
    const payload = object(response.data);
    if (payload.code !== 200) { responses.push({status: "unavailable", reason: "NetEase search is temporarily unavailable"}); continue; }
    const songs = object(payload.result).songs;
    if (!Array.isArray(songs)) continue;
    for (const value of songs.slice(0, 30)) {
      const song = object(value), artists = Array.isArray(song.artists) ? song.artists : [], album = object(song.album);
      const track: LrcLibTrack = { id: Number(song.id), trackName: text(song.name), artistName: artists.map(value => text(object(value).name)).filter(Boolean).join(", "), albumName: text(album.name), duration: Number(song.duration) / 1000, plainLyrics: "metadata verification" };
      if (selectLyricsCandidate({...identity, language: undefined}, [track]).status !== "matched") continue;
      const lyrics = await transport.read(`https://music.163.com/api/song/lyric?${new URLSearchParams({id: String(track.id), lv: "-1", kv: "-1", tv: "-1"})}`);
      responses.push(lyrics);
      if (lyrics.status !== "ok") continue;
      const data = object(lyrics.data);
      if (data.code !== 200) { responses.push({status: "unavailable", reason: "NetEase lyrics are temporarily unavailable"}); continue; }
      // Translated tlyric and romanized romalrc fields never replace original lyrics.
      track.plainLyrics = null;
      track.syncedLyrics = text(object(data.lrc).lyric) || null;
      track.instrumental = data.nolyric === true;
      const match = selectLyricsCandidate(identity, [track]);
      if (match.status === "matched") return {...match, provider: "netease"};
    }
  }
  return failure(responses, "NetEase has no verified lyrics for this recording");
}

function lyricTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const parts = /^(\d+):(\d{2})(?:[.:](\d{1,3}))?$/.exec(value);
  return parts ? Number(parts[1]) * 60 + Number(parts[2]) + Number((parts[3] || "").padEnd(3, "0")) / 1000 : undefined;
}

/** Lyrica is useful only when its returned title, artist and duration verify the requested edition. */
export async function fetchLyricaLyrics(identity: LyricIdentity, options: LyricProviderOptions = {}): Promise<LyricMatch> {
  const transport = createLyricTransport(options, "Lyrica"), responses: LyricResponse[] = [];
  const variants = lyricIdentityVariants(identity);
  const pairs=variants.titles.slice(0,3).flatMap(title=>variants.artists.slice(0,8).map(artist=>({title,artist}))).slice(0,12);
  for (const {title,artist} of pairs) {
    const response = await transport.read(`https://wilooper-lyrica.hf.space/lyrics/?${new URLSearchParams({artist, song: title, timestamps: "true", romanize: "false"})}`);
    responses.push(response);
    if (response.status !== "ok") continue;
    const payload = object(response.data), data = object(payload.data);
    if (payload.status !== "success") {
      const message = `${text(payload.message)} ${text(payload.error)}`;
      if (!/not found|no lyrics|missing/i.test(message)) responses.push({status: "unavailable", reason: "Lyrica has not completed this lookup"});
      continue;
    }
    const timed = Array.isArray(data.timed_lyrics) ? data.timed_lyrics : [];
    const synced = timed.slice(0, 4000).flatMap(value => {
      const line = object(value), start = lyricTime(line.start_time), body = text(line.text);
      if (start === undefined) return [];
      const minutes = Math.floor(start / 60), seconds = (start % 60).toFixed(3).padStart(6, "0");
      return [`[${String(minutes).padStart(2, "0")}:${seconds}]${body}`];
    }).join("\n");
    const metadata = [data.title, data.artist, data.album, data.duration, data.source];
    const track: LrcLibTrack = {id: parseInt(createHash("sha256").update(JSON.stringify(metadata)).digest("hex").slice(0, 12), 16), trackName: text(data.title), artistName: text(data.artist), albumName: text(data.album), duration: typeof data.duration === "number" ? data.duration : undefined, plainLyrics: text(data.lyrics) || null, syncedLyrics: text(data.syncedLyrics) || synced || null, instrumental: data.instrumental === true};
    const match = selectLyricsCandidate(identity, [track]);
    if (match.status === "matched") return {...match, provider: "lyrica"};
  }
  return failure(responses, "Lyrica has no verified lyrics for this recording");
}

/** OVH identifies text by its exact artist/title URL and supplies no timing or edition metadata. */
export async function fetchLyricsOvh(identity: LyricIdentity, options: LyricProviderOptions = {}): Promise<LyricMatch> {
  // This source cannot verify editions or instrumental identity. Never invent
  // duration metadata to pass the normal verification gates.
  if (lyricEdition(identity.title,identity.versionLabel).length) return {status:"missing",reason:"Plain fallback cannot verify this recording edition"};
  const transport = createLyricTransport(options, "lyrics.ovh"), responses: LyricResponse[] = [];
  const variants = lyricIdentityVariants(identity);
  for (const title of variants.titles.slice(0, 3)) {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(identity.artist)}/${encodeURIComponent(title)}`;
    const response = await transport.read(url);
    responses.push(response);
    if (response.status !== "ok") continue;
    const lyrics = text(object(response.data).lyrics).replace(/\r\n?/g, "\n").trim();
    if (!lyrics || lyrics.length > 80_000 || lyrics.split("\n").length > 4000) continue;
    if (identity.language === "ja" && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(lyrics)) continue;
    return {status:"matched",provider:"lyrics.ovh",track:{
      id:parseInt(createHash("sha256").update(url).digest("hex").slice(0,12),16),
      trackName:identity.title,artistName:identity.artist,plainLyrics:lyrics,syncedLyrics:null,
    }};
  }
  return failure(responses, "lyrics.ovh has no original plain lyrics for this artist and title");
}

type LyricLoader = (identity: LyricIdentity, options: LyricProviderOptions) => Promise<LyricMatch>;
/** Synced matches win immediately. Keep a plain match while other bounded
 * providers finish, so a fast plain response cannot cancel available timing. */
export async function fetchVerifiedLyrics(identity: LyricIdentity, options: LyricProviderOptions & {providers?: readonly LyricLoader[]; plainFallback?: LyricLoader | null} = {}): Promise<LyricMatch> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const providers = options.providers || [fetchLrcLibLyrics, fetchNetEaseLyrics, fetchLyricaLyrics];
  if (!providers.length) return {status: "unavailable", reason: "No lyric providers are configured"};
  const primary = await new Promise<LyricMatch>((resolve, reject) => {
    let remaining = providers.length, finished = false;
    const outcomes: LyricMatch[] = [];
    let plain: Extract<LyricMatch,{status:"matched"}>|undefined;
    let plainDeadline: ReturnType<typeof setTimeout>|undefined;
    const abort = () => { if (finished) return; finished = true; clearTimeout(plainDeadline); reject(signal.reason); };
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) { abort(); return; }
    const finish = (value: LyricMatch) => { if (finished) return; finished = true; clearTimeout(plainDeadline); signal.removeEventListener("abort", abort); resolve(value); controller.abort(); };
    providers.forEach(provider => {
      Promise.resolve().then(() => provider(identity, {...options, signal})).catch((): LyricMatch => ({status: "unavailable", reason: "A lyrics provider could not be reached"})).then(value => {
        if (finished) return;
        if (value.status === "matched") {
          if(value.track.instrumental||value.track.syncedLyrics&&parseTimedLyrics(value.track.syncedLyrics).some(line=>line.text.trim())){finish(value);return;}
          if(!plain){plain=value;plainDeadline=setTimeout(()=>finish(value),options.timeoutMs??12_000);}
        }
        outcomes.push(value);
        if (--remaining) return;
        if(plain){finish(plain);return;}
        const unavailable = outcomes.filter((result): result is Extract<LyricMatch, {status: "missing" | "ambiguous" | "unavailable"}> => result.status === "unavailable");
        if (unavailable.length) finish({status: "unavailable", reason: unavailable[0].reason, ...(unavailable.some(result => result.retryAfterMs) ? {retryAfterMs: Math.min(...unavailable.filter(result => result.retryAfterMs).map(result => result.retryAfterMs!))} : {})});
        else finish(outcomes.find(result => result.status === "ambiguous") || {status: "missing", reason: "All lyric providers completed without a verified recording match"});
      });
    });
  });
  if (primary.status === "matched") return primary;
  // Injected provider sets stay isolated; production always attempts OVH last.
  const fallback = options.plainFallback === undefined ? (options.providers ? null : fetchLyricsOvh) : options.plainFallback;
  if (!fallback) return primary;
  options.signal?.throwIfAborted();
  let plain: LyricMatch;
  try { plain = await fallback(identity, options); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    plain = {status:"unavailable",reason:"lyrics.ovh could not be reached"};
  }
  if (plain.status === "matched") return plain;
  const unavailable = [primary, plain].filter((value): value is Extract<LyricMatch, {status: "missing" | "ambiguous" | "unavailable"}> => value.status === "unavailable");
  if (unavailable.length) {
    const delays = unavailable.flatMap(value => value.retryAfterMs ? [value.retryAfterMs] : []);
    return {status:"unavailable",reason:unavailable[0].reason,...(delays.length ? {retryAfterMs:Math.min(...delays)} : {})};
  }
  return primary.status === "ambiguous" ? primary : plain;
}
