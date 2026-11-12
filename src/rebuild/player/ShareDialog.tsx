"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMusic } from "../app/MusicContext";
import { SelectPopover } from "../app/SelectPopover";
import type { MusicTrack } from "../app/types";
import { Artwork, IconButton, PlayerButton, PlayerDialog } from "./Primitives";
import { requestDialogClose } from "../app/dialogLifecycle";
import { getShareSelection } from "./shareSelection";
import { renderShareCard, renderShareVideo, shareCardKey, shareVideoKey, videoExportMime, type ShareCardInput, type RenderedShareCard } from "./shareRender";
import { ShareAudioPreparation, shareAudioSourceKey } from "./sharePreparation";
import { useLyrics } from "./useLyrics";
import { requestJson, userMessage } from "../app/errors";
import { RecoveryNotice } from "../app/RecoveryNotice";
import {useScreenActions,type ScreenActionScope} from "../app/screenActions";
import s from "./player.module.css";

const recentSaves=new WeakMap<File,number>();
function saveFile(file: File) {
  const now=Date.now();if(now-(recentSaves.get(file)||0)<750)return;recentSaves.set(file,now);
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");anchor.href = url;anchor.download = file.name;anchor.rel = "noopener";anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function ShareDialog({ onClose, track: inspectedTrack }: { onClose: () => void; track?: MusicTrack | null }) {
  const music = useMusic();const actions=useScreenActions(music.account?.id);const nativeShareLock=useRef(false);
  const [track] = useState(inspectedTrack || music.track);
  const lyrics = useLyrics(track);
  const initial = getShareSelection(track?.id);
  const [kind, setKind] = useState<"track" | "lyric">(() => initial.length ? "lyric" : "track");
  const [format, setFormat] = useState<"image" | "video" | "link">("image");
  const [selected, setSelected] = useState(initial);
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [layout, setLayout] = useState<"portrait" | "square">("portrait");
  const [image, setImage] = useState<(RenderedShareCard & { url: string }) | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageRetry,setImageRetry]=useState(0);
  const [video, setVideo] = useState<{ key: string; url: string; file: File } | null>(null);
  const [videoSupport, setVideoSupport] = useState<{layout:ShareCardInput["layout"];available:boolean}|null>(null);
  const videoAvailable = videoSupport?.layout===layout?videoSupport.available:null;
  const [videoFlightScope, setVideoFlightScope] = useState<ScreenActionScope|null>(null);
  const [progress, setProgress] = useState(0);
  const [seconds, setSeconds] = useState(8);
  const [videoStartSeconds, setVideoStartSeconds] = useState(() => music.positionMs / 1000);
  const [link, setLink] = useState<{ key: string; url: string } | null>(null);
  const [linkFlightScope, setLinkFlightScope] = useState<ScreenActionScope|null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortVideo = useRef<AbortController | null>(null);
  const progressPercent = useRef(-1);
  const cardInput = useMemo<ShareCardInput | null>(() => track ? { track, lines: kind === "lyric" ? selected : [], colorMode, layout } : null, [track, kind, selected, colorMode, layout]);
  const cardKey = cardInput ? shareCardKey(cardInput) : "";
  const usableAudioTrack = useMemo(() => track && music.track?.reference.provider === track.reference.provider && music.track.reference.id === track.reference.id
    ? { ...track, id: music.track.id, audioUrl: music.track.audioUrl, readyPlayback: music.track.readyPlayback || track.readyPlayback } : track, [track, music.track]);
  const audioSourceKey = usableAudioTrack ? shareAudioSourceKey(usableAudioTrack, music.account?.id) : "";
  const audioPreparation = useMemo(() => new ShareAudioPreparation(), []);
  const clipStartSeconds = kind === "lyric" && selected.length ? selected[0].start : videoStartSeconds;
  const videoKey = cardInput && usableAudioTrack ? shareVideoKey({ ...cardInput, track: usableAudioTrack }, music.account?.id, clipStartSeconds, seconds) : "";
  const linkActions=useScreenActions(music.account?.id,cardKey),videoActions=useScreenActions(music.account?.id,videoKey);
  const linkBusy=linkFlightScope===linkActions,videoBusy=videoFlightScope===videoActions;
  const readyImage = image?.key === cardKey ? image : null;
  const readyVideo = video?.key === videoKey ? video : null;
  const readyLink = link?.key === cardKey ? link : null;
  useEffect(() => { audioPreparation.clear(); return () => audioPreparation.clear(); }, [audioPreparation, audioSourceKey]);
  useEffect(() => {
    if (format !== "video" || !usableAudioTrack?.audioUrl) return;
    const controller = new AbortController();
    void audioPreparation.warm(usableAudioTrack, music.account?.id, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [format, usableAudioTrack, audioSourceKey, audioPreparation, music.account?.id]);
  useEffect(() => {
    if (format !== "video") return;
    let active = true;
    void videoExportMime(layout).then((mime) => { if (active) setVideoSupport({layout,available:Boolean(mime)}); }).catch(() => { if (active) setVideoSupport({layout,available:false}); });
    return () => { active = false;abortVideo.current?.abort(); };
  }, [layout,format]);
  useEffect(() => {
    if (!track || (kind === "lyric" && !selected.length)) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let canvas: HTMLCanvasElement | null = null;
    const input: ShareCardInput = { track, lines: kind === "lyric" ? selected : [], colorMode, layout };
    void renderShareCard(input, controller.signal).then((result) => {
      if (controller.signal.aborted) { result.canvas.width=0;result.canvas.height=0;return; }
      canvas = result.canvas;
      objectUrl = URL.createObjectURL(result.blob);
      setImage({ ...result, url: objectUrl });setImageError(null);
    }).catch((error) => { if (!controller.signal.aborted) setImageError(userMessage(error,"share")); });
    return () => { controller.abort();if (objectUrl) URL.revokeObjectURL(objectUrl);if (canvas) { canvas.width = 0; canvas.height = 0; } };
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
    // Rendering finishes before this click, preserving iPhone share activation.
    if(nativeShareLock.current)return;
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      const controller=actions.begin("native-share");if(!controller)return;nativeShareLock.current=true;
      void navigator.share({ title, text: track ? `${track.title} · ${track.artists.join(", ")}` : "A little music from Sakura", files: [file] }).then(() => {if(actions.current("native-share",controller))setMessage("Shared successfully.");}).catch((error: unknown) => { if (actions.current("native-share",controller)&&!(error instanceof DOMException && error.name === "AbortError")) setMessage("Sharing could not open here. Use Save to keep the ready file."); }).finally(()=>{nativeShareLock.current=false;actions.finish("native-share",controller);});
    } else { saveFile(file);setMessage("The ready file has been saved. You can share it from your photos or files."); }
  }
  async function prepareLink() {
    if (!track || readyLink || (kind === "lyric" && !selected.length)) return;
    const controller=linkActions.begin("link");if(!controller)return;setLinkFlightScope(linkActions);setMessage(null);
    try {
      const payload = await requestJson<{url?:string;slug?:string}>("/api/v2/shares", { method: "POST", signal:controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId: track.id, reference: track.reference, kind, lines: kind === "lyric" ? selected : [], colorMode }) },{context:"share",accountId:music.account?.id});
      if(!linkActions.current("link",controller))return;
      if(!payload.url)throw new Error("Share link unavailable");const address=new URL(payload.url, location.origin);if(address.origin!==location.origin||!address.pathname.startsWith("/s/"))throw new Error("Share link unavailable");const url=address.toString();
      setLink({ key: cardKey, url });setMessage("Your link is ready. Copy it or open Share link.");
    } catch (error) { if(linkActions.current("link",controller))music.reportError(error,"share",()=>void prepareLink()); }
    finally { if(linkActions.finish("link",controller))setLinkFlightScope(null); }
  }
  function shareLink() {
    if (!readyLink||nativeShareLock.current) return;
    if (navigator.share){const controller=actions.begin("native-share");if(!controller)return;nativeShareLock.current=true;void navigator.share({ title: track?.title || "Sakura", text: track?.artists.join(", "), url: readyLink.url }).catch((error: unknown) => { if (actions.current("native-share",controller)&&!(error instanceof DOMException && error.name === "AbortError")) setMessage("Use Copy link to share this address."); }).finally(()=>{nativeShareLock.current=false;actions.finish("native-share",controller);});}
    else void copyLink();
  }
  async function copyLink() {
    if (!readyLink) return;const controller=actions.begin("copy");if(!controller)return;
    try { await navigator.clipboard.writeText(readyLink.url);if(actions.current("copy",controller))setMessage("Link copied."); }
    catch { if(actions.current("copy",controller))setMessage("Select the link below and copy it from your browser."); }
    finally{actions.finish("copy",controller);}
  }
  async function prepareVideo() {
    if (!usableAudioTrack || !readyImage) return;const controller=videoActions.begin("video");if(!controller)return;
    abortVideo.current?.abort();abortVideo.current=controller;setVideoFlightScope(videoActions);progressPercent.current=-1;setProgress(0);setMessage(null);
    try {
      const input: ShareCardInput = { track: usableAudioTrack, lines: kind === "lyric" ? selected : [], colorMode, layout };
      const result = await renderShareVideo(input, { seconds, startSeconds: clipStartSeconds, card: readyImage, audio: audioPreparation, accountId: music.account?.id, signal: controller.signal, onProgress:value=>{const percent=Math.floor(value*100);if(videoActions.current("video",controller)&&percent!==progressPercent.current){progressPercent.current=percent;setProgress(value);}} });
      if (!videoActions.current("video",controller)) return;
      setVideo({ key: videoKey, url: URL.createObjectURL(result.blob), file: result.file });setMessage("Your video and its exact recording are ready to save or share.");
    } catch (error) { if (videoActions.current("video",controller)) music.reportError(error,"share",()=>void prepareVideo()); }
    finally { if(videoActions.finish("video",controller))setVideoFlightScope(null);if(abortVideo.current===controller)abortVideo.current=null; }
  }
  return <PlayerDialog title="Share the music." subtitle="SHARING STUDIO" onClose={() => { abortVideo.current?.abort();onClose(); }} wide appearance="share">
    {!track ? <div className={s.empty}><p>Choose a song to share.</p><PlayerButton secondary onClick={() => requestDialogClose(onClose)}>Back to music</PlayerButton></div> : <><p className={s.shareDescription}>Share a song card or select lyrics for an image, link, or video.</p><div className={s.chips}><button type="button" aria-pressed={kind === "track"} onClick={() => { setKind("track");abortVideo.current?.abort(); }}>Song card</button><button type="button" aria-pressed={kind === "lyric"} onClick={() => { setKind("lyric");abortVideo.current?.abort(); }}>Lyric card</button></div><div className={s.shareGrid}>
      <div className={s.sharePreview}>{format === "video" && readyVideo ? <video src={readyVideo.url} controls playsInline/> : readyImage ? <img src={readyImage.url} alt={`Your ${kind === "lyric" ? "selected lyric" : "song"} card for ${track.title}`}/> : kind === "track" && !imageError ? <Artwork url={track.coverUrl} title={track.title}/> : <p>{imageError || (kind === "lyric" && !selected.length ? "Choose the lyrics to share." : "Preparing your share…")}</p>}</div>
      <div className={s.shareOptions}><div className={s.chips}><button type="button" aria-pressed={format === "image"} onClick={() => setFormat("image")}>Image</button><button type="button" aria-pressed={format === "link"} onClick={() => setFormat("link")}>Link</button><button type="button" aria-pressed={format === "video"} disabled={videoAvailable===false} onClick={() => { setVideoStartSeconds((music.getPlaybackPosition?.()??music.positionMs) / 1000);setFormat("video"); }}>Video</button></div>
        {kind === "lyric" && <div><span className={s.eyebrow}>CHOOSE YOUR WORDS</span>{lyrics.loading ? <p className={s.hint}>Finding this recording’s lyrics…</p> : lyrics.error ? <p className={s.hint}>{lyrics.error}</p> : <div className={s.lyricChoice}>{lyrics.data?.lines.map((line, index) => line.text ? <button type="button" key={`${line.start}-${index}`} aria-pressed={selected.some((chosen) => chosen.start === line.start && chosen.text === line.text)} onClick={() => chooseLyric(index)}>{line.text}</button> : null)}</div>}<small className={s.selectedCount}>{selected.length}/8 neighbouring lines selected</small></div>}
        <div className={s.shareField}><span>Ink on paper</span><div className={s.chips}><button type="button" aria-pressed={colorMode === "light"} onClick={() => { setColorMode("light");abortVideo.current?.abort(); }}>Light paper</button><button type="button" aria-pressed={colorMode === "dark"} onClick={() => { setColorMode("dark");abortVideo.current?.abort(); }}>Night ink</button></div></div><label className={s.shareField}><span>Card size</span><SelectPopover<"portrait" | "square"> label="Card size" value={layout} onChange={value => {setLayout(value);abortVideo.current?.abort();}} options={[{value:"portrait",label:"Portrait · 1080 × 1350"},{value:"square",label:"Square · 1080 × 1080"}]}/></label>
        {format === "image" && <div className={s.shareActions}><PlayerButton icon="share" disabled={!readyImage} onClick={() => readyImage && shareReady(readyImage.file, track.title)}>Share image</PlayerButton><PlayerButton secondary icon="download" disabled={!readyImage} onClick={() => readyImage && saveFile(readyImage.file)}>Save PNG</PlayerButton></div>}
        {format === "link" && <><div className={s.shareActions}>{!readyLink ? <PlayerButton icon="link" disabled={linkBusy || (kind === "lyric" && !selected.length)} onClick={() => void prepareLink()}>{linkBusy ? "Saving your shared moment…" : "Prepare share link"}</PlayerButton> : <><PlayerButton icon="share" onClick={shareLink}>Share link</PlayerButton><PlayerButton secondary icon="link" onClick={() => void copyLink()}>Copy link</PlayerButton></>}</div>{readyLink && <label className={s.shareLink}><input aria-label="Your public share link" value={readyLink.url} readOnly onClick={(event) => event.currentTarget.select()}/><IconButton icon="link" label="Copy share link" onClick={() => void copyLink()}/></label>}<p className={s.shareGestureHint}>A saved link opens this recording and these exact selected lines, even for someone who has not signed in.</p></>}
        {format === "video" && <>{videoAvailable===null&&<p className={s.hint}>Checking video support…</p>}{videoAvailable===false&&<p className={s.hint}>Video export is unavailable in this browser. Your image is ready to share.</p>}<label className={s.shareField}><span>Clip length</span><SelectPopover label="Clip length" value={seconds} disabled={videoBusy} onChange={setSeconds} options={[{value:5,label:"5 seconds"},{value:8,label:"8 seconds"},{value:12,label:"12 seconds"}]}/></label><p className={s.shareGestureHint}>The clip uses this exact recording, beginning at your selected line or the playback position when you choose Video. WebM export depends on your browser’s encoder.</p>{!usableAudioTrack?.audioUrl && <p className={s.hint}>Let the song load before preparing its audio clip.</p>}{videoBusy ? <><progress className={s.videoProgress} value={progress} max={1} aria-label="Video export progress"/><PlayerButton secondary onClick={() => abortVideo.current?.abort()}>Cancel video</PlayerButton></> : <div className={s.shareActions}>{readyVideo ? <><PlayerButton icon="share" onClick={() => shareReady(readyVideo.file, track.title)}>Share video</PlayerButton><PlayerButton secondary icon="download" onClick={() => saveFile(readyVideo.file)}>Save WebM</PlayerButton></> : <PlayerButton icon="video" disabled={videoAvailable!==true || !readyImage || !usableAudioTrack?.audioUrl} onClick={() => void prepareVideo()}>Prepare video</PlayerButton>}</div>}</>}
        {imageError && <RecoveryNotice compact error={imageError} context="share" retry={()=>setImageRetry(v=>v+1)}/>}<p className={s.shareStatus} role="status">{message || (!readyImage && (kind !== "lyric" || selected.length) ? "Preparing your image…" : "")}</p>
      </div>
    </div></>}
  </PlayerDialog>;
}
