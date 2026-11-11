"use client";
import { useState } from "react";
import { useMusic, usePlaybackProgress } from "../app/MusicContext";
import type { MusicTrack } from "../app/types";
import { Artwork, IconButton, PlayerButton, PlayerDialog } from "./Primitives";
import { ReadingLanguageChoice } from "./ReadingLanguageChoice";
import { TrackActions } from "../app/TrackActions";
import { AlbumLink } from "../app/AlbumLink";
import { ArtistLinks } from "../app/ArtistLinks";
import { PlaybackRibbon, VolumeControl } from "../app/ListeningControls";
import { RecoveryNotice } from "../app/RecoveryNotice";
import { lyricInputKey, useLyrics } from "./useLyrics";
import { miniLyricCue } from "./miniLyric";
import { useJapaneseReading } from "./useJapaneseReading";
import { useSongSwipe } from "../app/useSongSwipe";
import { requestDialogClose } from "../app/dialogLifecycle";
import s from "./player.module.css";

function RecordSleeve({ track, identity, direction }: { track: MusicTrack; identity: string; direction: "next" | "previous" | null }) {
  const [sleeve, setSleeve] = useState({ identity, track, previous: null as MusicTrack | null });
  if (sleeve.identity !== identity) setSleeve({ identity, track, previous: sleeve.track });
  return <div className={s.recordSleeve} data-swipe-direction={direction || "next"}>
    {sleeve.previous && <div key={`out:${sleeve.previous.id}:${identity}`} className={s.outgoingRecord} aria-hidden="true"><Artwork url={sleeve.previous.coverUrl} title={sleeve.previous.title}/></div>}
    <div key={identity} className={s.incomingRecord}><Artwork url={track.coverUrl} title={track.title} priority/></div>
  </div>;
}

/** Lettering and ink flourishes are drawn as a score, with live text kept accessible. */
function LyricsLettering() {
  return <svg className={s.lyricsLettering} viewBox="0 0 420 90" aria-hidden="true">
    <path className={s.letteringStem} d="M8 70C70 79 131 68 184 72S282 75 359 67c20-2 32-8 46-17M350 68c-2-12 5-19 15-22-1 11-5 16-15 22m28-6c8 3 17 2 21-4-10-3-16-2-21 4"/>
    <text x="8" y="49" className={s.letteringText}>follow the words</text>
    <path className={s.letteringArrow} d="M368 31q17 11 33 1m-8-5 8 5-5 8"/>
    <path className={s.letteringPetal} d="M23 61q-17-10-17-21 15 1 17 21m2-1q0-12 9-19 5 13-9 19"/>
  </svg>;
}

export function FullPlayer({ onClose, onOpenLyrics, onOpenQueue, onOpenShare }: { onClose: () => void; onOpenLyrics?: () => void; onOpenQueue?: () => void; onOpenShare?: () => void }) {
  const music = useMusic(), progress = usePlaybackProgress();
  const [tasteTrack,setTasteTrack] = useState<MusicTrack|null>(null);
  const lyrics = useLyrics(music.track);
  const readingGuide = useJapaneseReading(lyrics);
  const swipe = useSongSwipe({ onNext: music.next, onPrevious: music.previous, disabled: !music.track, reducedMotion: music.settings.reducedMotion });
  const close = () => requestDialogClose(onClose);
  const track = music.track;
  const cue = lyrics.data?.timing === "synced" && music.status !== "resolving" && music.status !== "error" ? miniLyricCue(lyrics.data.lines, progress.positionMs) : null;
  const previewLine = lyrics.data?.timing === "plain" ? lyrics.data.lines.find(line => line.text.trim()) : null;
  const previewText = cue?.text || previewLine?.text || "A little music between the words.";
  const previewReading = cue?.romanized || (previewLine?.romanized?.trim() !== previewLine?.text.trim() ? previewLine?.romanized : undefined);
  const previewKey = `${track ? lyricInputKey(track) : ""}:${cue?.start ?? "plain"}`;
  const duration = progress.durationMs || track?.durationMs || 0;
  const busy = music.status === "resolving" || music.status === "buffering";
  const trackId = track ? music.effectiveId(track) : undefined;
  const liked = trackId ? music.liked.has(trackId) : false;
  const download = trackId ? music.downloads[trackId] : undefined;
  const saved = download?.requested !== false && download?.status === "ready";
  const saving = download?.requested !== false && ["queued", "resolving", "downloading"].includes(download?.status || "");
  return <PlayerDialog title="Room for your music." subtitle="NOW PLAYING" onClose={onClose} wide fullscreen className={s.playerDialog} appearance="player">
    {!track ? <div className={s.empty}><h3>Ready when you are.</h3><p>Choose a song to start listening.</p><PlayerButton onClick={close}>Find your music</PlayerButton></div> : <div className={s.fullPlayer}>
      <div className={s.playerArt}><div className={s.sleeveGesture} {...swipe.bind} style={swipe.style} tabIndex={0} role="group" aria-label={`Artwork for ${track.title}. Swipe or drag left for the next song, right for the previous song.`} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); if (event.key === "ArrowLeft") music.previous(); else music.next(); } }}><RecordSleeve track={track} identity={music.currentEntryId || lyricInputKey(track)} direction={swipe.direction}/></div><span className={s.artNote}>put the world on pause.</span><small className={s.recordGestureHint}><span className={s.touchRecordHint}>swipe to turn the record</span><span className={s.mouseRecordHint}>drag to turn the record <kbd>Shift</kbd><kbd>←</kbd><kbd>→</kbd></span></small></div>
      <div className={s.playerDetails}><div className={s.playerTitle}><div><h1>{track.title}</h1><p onClick={close}><ArtistLinks track={track}/></p></div><IconButton icon="heart" label={liked ? "Remove from liked songs" : "Like this song"} active={liked} onClick={() => music.toggleLike(track)}/></div><p className={s.version}>{track.versionLabel}{track.albumTitle && <> · <AlbumLink track={track} onNavigate={close}/></>}</p>
        <PlaybackRibbon positionMs={progress.positionMs} durationMs={duration} onSeek={music.seek} disabled={music.status === "resolving"}/>
        <div className={s.transport}><IconButton icon="shuffle" label={music.shuffle ? "Turn shuffle off" : "Turn shuffle on"} shortcut="S" active={music.shuffle} onClick={() => music.setShuffle(!music.shuffle)}/><IconButton icon="previous" label="Previous song" shortcut="Shift+←" onClick={music.previous}/><button type="button" className={s.largePlay} aria-label={music.status === "playing" ? "Pause" : busy ? "Pause loading" : "Play"} title={`${music.status === "playing" ? "Pause" : "Play"} (Space)`} data-shortcut="Space" data-playback-shortcuts="listening" onClick={music.togglePlay}>{busy ? <span className={s.spinner}/> : <span><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true">{music.status === "playing" ? <path d="M6 4h4v16H6zm8 0h4v16h-4z"/> : <path d="m7 4 14 8-14 8z"/>}</svg></span>}</button><IconButton icon="next" label="Next song" shortcut="Shift+→" onClick={music.next}/><IconButton icon="repeat" label={`Repeat: ${music.repeat}. Change repeat mode`} shortcut="R" active={music.repeat !== "off"} onClick={() => music.setRepeat(music.repeat === "off" ? "all" : music.repeat === "all" ? "one" : "off")}/>{music.repeat === "one" && <span className={s.repeatOne}>1</span>}</div>
        <p className={s.playbackStatus} role="status">{music.status === "resolving" ? "Finding your exact recording…" : music.status === "buffering" ? "Buffering audio…" : music.status === "error" ? "This recording could not play. Choose Play to try again." : ""}</p>
        {music.status === "error" && music.error && <RecoveryNotice error={music.error} context="playback" retry={music.togglePlay} compact/>}
        <div className={s.playerActions}><PlayerButton secondary icon="lyrics" title="Open lyrics (L)" data-shortcut="L" onClick={onOpenLyrics || (() => music.openModal("lyrics"))}>Lyrics</PlayerButton><PlayerButton secondary icon="queue" title="Up next (Q)" data-shortcut="Q" onClick={onOpenQueue || (() => music.openModal("queue"))}>Up next</PlayerButton><IconButton icon="discover" label="Recommendation controls" aria-haspopup="menu" aria-expanded={Boolean(tasteTrack)} onClick={()=>setTasteTrack(track)}/><IconButton icon="share" label="Share this song" onClick={onOpenShare || (() => music.openModal("share"))}/><IconButton icon={saved ? "check" : "download"} label={saved ? "Saved for offline listening" : saving ? "Saving for offline listening" : "Download this recording"} active={saved} disabled={saved || saving} onClick={() => music.requestDownload(track)}/></div>
        <VolumeControl value={music.volume} onChange={music.setVolume}/>
        {lyrics.data?.lines.some(line => line.text.trim()) ? <div className={s.lyricPreview}><button type="button" className={s.lyricPeek} aria-label="Open lyrics" title="Follow the words (L)" data-shortcut="L" onClick={onOpenLyrics || (() => music.openModal("lyrics"))}><span className={s.eyebrow}>A LITTLE CLOSER TO THE WORDS</span><span key={previewKey} className={s.peekWords} dir="auto">{previewText}{readingGuide.enabled && previewReading && <small className={s.peekReading} data-player-reading dir="auto">{previewReading}</small>}</span><LyricsLettering/><span className={s.lyricFootnote}>a song, in its own handwriting.<kbd>L</kbd></span></button>{readingGuide.language && <div className={s.peekReadingControl}><button type="button" aria-label={readingGuide.label} aria-pressed={readingGuide.enabled} aria-busy={readingGuide.busy} onClick={readingGuide.toggle}><span aria-hidden="true">あ</span>{readingGuide.busy ? "Preparing readings…" : readingGuide.label}<i aria-hidden="true"/></button><ReadingLanguageChoice guide={readingGuide}/>{readingGuide.error && <button type="button" className={s.peekReadingRetry} onClick={readingGuide.retry}>Try reading again</button>}</div>}</div> : null}
      </div>
    </div>}
    {tasteTrack && track && <TrackActions key={music.effectiveId(track)} track={track} initialTasteMenu onClose={()=>setTasteTrack(null)}/>}
  </PlayerDialog>;
}
