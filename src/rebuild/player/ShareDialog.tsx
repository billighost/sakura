"use client";
import { useEffect, useRef, useState } from "react";
import { useMusic } from "../app/MusicContext";
import type { MusicTrack } from "../app/types";
import { Artwork, IconButton, PlayerButton, PlayerDialog } from "./Primitives";
import { getShareSelection } from "./shareSelection";
import { renderShareCard, renderShareVideo, videoExportMime, type ShareCardInput } from "./shareRender";
import { useLyrics } from "./useLyrics";
import { requestJson, userMessage } from "../app/errors";
import { RecoveryNotice } from "../app/RecoveryNotice";
import s from "./player.module.css";

function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");anchor.href = url;anchor.download = file.name;anchor.rel = "noopener";anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function ShareDialog({ onClose, track: inspectedTrack }: { onClose: () => void; track?: MusicTrack | null }) {
  const music = useMusic();
  const [track] = useState(inspectedTrack || music.track);
  const lyrics = useLyrics(track);
  const initial = getShareSelection(track?.id);
  const [kind, setKind] = useState<"track" | "lyric">(() => initial.length ? "lyric" : "track");
  const [format, setFormat] = useState<"image" | "video" | "link">("image");
  const [selected, setSelected] = useState(initial);
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [layout, setLayout] = useState<"portrait" | "square">("portrait");
  const [image, setImage] = useState<{ key: string; url: string; file: File } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageRetry,setImageRetry]=useState(0);
  const [video, setVideo] = useState<{ key: string; url: string; file: File } | null>(null);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [seconds, setSeconds] = useState(8);
  const [link, setLink] = useState<{ key: string; url: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);const linkLock=useRef(false);const videoLock=useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const abortVideo = useRef<AbortController | null>(null);
  const cardKey = JSON.stringify([track?.id, kind, selected.map((line) => [line.text, line.start]), colorMode, layout]);
  const videoKey = `${cardKey}:${seconds}`;
  const readyImage = image?.key === cardKey ? image : null;
  const readyVideo = video?.key === videoKey ? video : null;
  const readyLink = link?.key === cardKey ? link : null;
  const usableAudioTrack = track && music.track?.reference.provider === track.reference.provider && music.track.reference.id === track.reference.id ? { ...track, audioUrl: music.track.audioUrl } : track;
  useEffect(() => {
    let active = true;
    void videoExportMime(layout).then((mime) => { if (active) setVideoAvailable(Boolean(mime)); }).catch(() => { if (active) setVideoAvailable(false); });
    return () => { active = false;abortVideo.current?.abort(); };
  }, [layout]);
  useEffect(() => {
    if (!track || (kind === "lyric" && !selected.length)) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const input: ShareCardInput = { track, lines: kind === "lyric" ? selected : [], colorMode, layout };
    void renderShareCard(input, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(result.blob);
      setImage({ key: cardKey, url: objectUrl, file: result.file });setImageError(null);
    }).catch((error) => { if (!controller.signal.aborted) setImageError(userMessage(error,"share")); });
    return () => { controller.abort();if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [cardKey, track, selected, kind, colorMode, layout,imageRetry]);
  useEffect(() => { return () => { if (video?.url) URL.revokeObjectURL(video.url); }; }, [video?.url]);
  function chooseLyric(index: number) {
    const lines = lyrics.data?.lines;
    if (!lines) return;
    const chosenIndices = selected.map((line) => lines.findIndex((source) => source.text === line.text && source.start === line.start)).filter((value) => value >= 0);
    const anchor = chosenIndices[0];
    const first = anchor === undefined ? index : Math.min(anchor, index);
    const last = anchor === undefined ? index : Math.max(anchor, index);
    if (last - first + 1 > 8) { setMessage("Choose up to eight neighbouring lines.");return; }
    setSelected(index === anchor ? [] : lines.slice(first, last + 1).filter((line) => line.text.trim()));
    setKind("lyric");setMessage(null);abortVideo.current?.abort();
  }
  function shareReady(file: File, title: string) {
    // Keep navigator.share in the click handler. All rendering has already
    // finished; awaiting an encoder here would lose activation on iPhone.
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      void navigator.share({ title, text: track ? `${track.title} · ${track.artists.join(", ")}` : "A little music from Sakura", files: [file] }).then(() => setMessage("Your little moment was shared.")).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("Sharing could not open here. Use Save to keep the ready file."); });
    } else { saveFile(file);setMessage("The ready file has been saved. You can share it from your photos or files."); }
  }
  async function prepareLink() {
    if (!track || linkLock.current || readyLink || (kind === "lyric" && !selected.length)) return;linkLock.current=true;
    setLinkBusy(true);setMessage(null);
    try {
      const payload = await requestJson<{url?:string;slug?:string}>("/api/v2/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId: track.id, reference: track.reference, kind, lines: kind === "lyric" ? selected : [], colorMode }) },{context:"share",accountId:music.account?.id});
      if(!payload.url)throw new Error("Share link unavailable");const address=new URL(payload.url, location.origin);if(address.origin!==location.origin||!address.pathname.startsWith("/s/"))throw new Error("Share link unavailable");const url=address.toString();
      setLink({ key: cardKey, url });setMessage("Your link is ready. Copy it or open Share link.");
    } catch (error) { music.reportError(error,"share",()=>void prepareLink()); }
    finally { linkLock.current=false;setLinkBusy(false); }
  }
  function shareLink() {
    if (!readyLink) return;
    if (navigator.share) void navigator.share({ title: track?.title || "Sakura", text: track?.artists.join(", "), url: readyLink.url }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("Use Copy link to share this address."); });
    else void copyLink();
  }
  async function copyLink() {
    if (!readyLink) return;
    try { await navigator.clipboard.writeText(readyLink.url);setMessage("Link copied."); }
    catch { setMessage("Select the link below and copy it from your browser."); }
  }
  async function prepareVideo() {
    if (!usableAudioTrack || !readyImage || videoLock.current) return;videoLock.current=true;
    abortVideo.current?.abort();
    const controller = new AbortController();abortVideo.current = controller;
    setVideoBusy(true);setProgress(0);setMessage(null);
    try {
      const input: ShareCardInput = { track: usableAudioTrack, lines: kind === "lyric" ? selected : [], colorMode, layout };
      const result = await renderShareVideo(input, { seconds, startSeconds: kind === "lyric" && selected.length ? selected[0].start : music.positionMs / 1000, signal: controller.signal, onProgress: setProgress });
      if (controller.signal.aborted) return;
      setVideo({ key: videoKey, url: URL.createObjectURL(result.blob), file: result.file });setMessage("Your video and its exact recording are ready to save or share.");
    } catch (error) { if (!controller.signal.aborted) music.reportError(error,"share",()=>void prepareVideo()); }
    finally { videoLock.current=false;if (abortVideo.current === controller) setVideoBusy(false); }
  }
  return <PlayerDialog title="Pass the feeling along." subtitle="SHARING STUDIO" onClose={() => { abortVideo.current?.abort();onClose(); }} wide>
    {!track ? <div className={s.empty}><p>Choose a song to make a shared moment.</p><PlayerButton secondary onClick={onClose}>Back to music</PlayerButton></div> : <><p className={s.shareDescription}>Your song, or the exact words that stayed with you. Make a little piece of it your own.</p><div className={s.chips}><button type="button" aria-pressed={kind === "track"} onClick={() => { setKind("track");abortVideo.current?.abort(); }}>Song card</button><button type="button" aria-pressed={kind === "lyric"} onClick={() => { setKind("lyric");abortVideo.current?.abort(); }}>Lyric card</button></div><div className={s.shareGrid}>
      <div className={s.sharePreview}>{format === "video" && readyVideo ? <video src={readyVideo.url} controls playsInline/> : readyImage ? <img src={readyImage.url} alt={`Your ${kind === "lyric" ? "selected lyric" : "song"} card for ${track.title}`}/> : kind === "track" && !imageError ? <Artwork url={track.coverUrl} title={track.title}/> : <p>{imageError || (kind === "lyric" && !selected.length ? "Choose the words that stayed with you." : "Making your little moment…")}</p>}</div>
      <div className={s.shareOptions}><div className={s.chips}><button type="button" aria-pressed={format === "image"} onClick={() => setFormat("image")}>Image</button><button type="button" aria-pressed={format === "link"} onClick={() => setFormat("link")}>Link</button><button type="button" aria-pressed={format === "video"} disabled={!videoAvailable} onClick={() => setFormat("video")}>Video</button></div>
        {kind === "lyric" && <div><span className={s.eyebrow}>CHOOSE YOUR WORDS</span>{lyrics.loading ? <p className={s.hint}>Finding this recording’s lyrics…</p> : lyrics.error ? <p className={s.hint}>{lyrics.error}</p> : <div className={s.lyricChoice}>{lyrics.data?.lines.map((line, index) => line.text ? <button type="button" key={`${line.start}-${index}`} aria-pressed={selected.some((chosen) => chosen.start === line.start && chosen.text === line.text)} onClick={() => chooseLyric(index)}>{line.text}</button> : null)}</div>}<small className={s.selectedCount}>{selected.length}/8 neighbouring lines selected</small></div>}
        <div className={s.shareField}><span>Ink on paper</span><div className={s.chips}><button type="button" aria-pressed={colorMode === "light"} onClick={() => { setColorMode("light");abortVideo.current?.abort(); }}>Light paper</button><button type="button" aria-pressed={colorMode === "dark"} onClick={() => { setColorMode("dark");abortVideo.current?.abort(); }}>Night ink</button></div></div><label className={s.shareField}><span>Card size</span><select value={layout} onChange={(event) => { setLayout(event.target.value as "portrait" | "square");abortVideo.current?.abort(); }}><option value="portrait">Portrait · 1080 × 1350</option><option value="square">Square · 1080 × 1080</option></select></label>
        {format === "image" && <div className={s.shareActions}><PlayerButton icon="share" disabled={!readyImage} onClick={() => readyImage && shareReady(readyImage.file, track.title)}>Share image</PlayerButton><PlayerButton secondary icon="download" disabled={!readyImage} onClick={() => readyImage && saveFile(readyImage.file)}>Save PNG</PlayerButton></div>}
        {format === "link" && <><div className={s.shareActions}>{!readyLink ? <PlayerButton icon="link" disabled={linkBusy || (kind === "lyric" && !selected.length)} onClick={() => void prepareLink()}>{linkBusy ? "Saving your shared moment…" : "Prepare share link"}</PlayerButton> : <><PlayerButton icon="share" onClick={shareLink}>Share link</PlayerButton><PlayerButton secondary icon="link" onClick={() => void copyLink()}>Copy link</PlayerButton></>}</div>{readyLink && <label className={s.shareLink}><input aria-label="Your public share link" value={readyLink.url} readOnly onClick={(event) => event.currentTarget.select()}/><IconButton icon="link" label="Copy share link" onClick={() => void copyLink()}/></label>}<p className={s.shareGestureHint}>A saved link opens this recording and these exact selected lines, even for someone who has not signed in.</p></>}
        {format === "video" && <><label className={s.shareField}><span>Clip length</span><select value={seconds} disabled={videoBusy} onChange={(event) => setSeconds(Number(event.target.value))}><option value={5}>5 seconds</option><option value={8}>8 seconds</option><option value={12}>12 seconds</option></select></label><p className={s.shareGestureHint}>The clip uses this exact recording, beginning at your selected line or the current playback position. WebM export depends on your browser’s encoder.</p>{!usableAudioTrack?.audioUrl && <p className={s.hint}>Let the song load before preparing its audio clip.</p>}{videoBusy ? <><progress className={s.videoProgress} value={progress} max={1} aria-label="Video export progress"/><PlayerButton secondary onClick={() => abortVideo.current?.abort()}>Cancel video</PlayerButton></> : <div className={s.shareActions}>{readyVideo ? <><PlayerButton icon="share" onClick={() => shareReady(readyVideo.file, track.title)}>Share video</PlayerButton><PlayerButton secondary icon="download" onClick={() => saveFile(readyVideo.file)}>Save WebM</PlayerButton></> : <PlayerButton icon="video" disabled={!readyImage || !usableAudioTrack?.audioUrl} onClick={() => void prepareVideo()}>Prepare video</PlayerButton>}</div>}</>}
        {imageError && <RecoveryNotice compact error={imageError} context="share" retry={()=>setImageRetry(v=>v+1)}/>}<p className={s.shareStatus} role="status">{message || (!readyImage && (kind !== "lyric" || selected.length) ? "Preparing your image…" : "")}</p>
      </div>
    </div></>}
  </PlayerDialog>;
}
