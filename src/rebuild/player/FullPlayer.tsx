"use client";
import { useMusic } from "../app/MusicContext";
import { activeLyricIndex } from "../lyrics/parse";
import { Artwork, IconButton, PlayerButton, PlayerDialog } from "./Primitives";
import { ArtistLinks } from "../app/ArtistLinks";
import { Icon } from "../app/Icon";
import { PlaybackRibbon, VolumeControl } from "../app/ListeningControls";
import { RecoveryNotice } from "../app/RecoveryNotice";
import { useLyrics } from "./useLyrics";
import { requestDialogClose } from "../app/dialogLifecycle";
import s from "./player.module.css";

export function FullPlayer({ onClose, onOpenLyrics, onOpenQueue, onOpenShare }: { onClose: () => void; onOpenLyrics?: () => void; onOpenQueue?: () => void; onOpenShare?: () => void }) {
  const music = useMusic();
  const lyrics = useLyrics(music.track);
  const close = () => requestDialogClose(onClose);
  const track = music.track;
  const active = lyrics.data?.timing === "synced" ? activeLyricIndex(lyrics.data.lines, music.positionMs / 1000) : -1;
  const duration = music.durationMs || track?.durationMs || 0;
  const busy = music.status === "resolving" || music.status === "buffering";
  const download = track ? music.downloads[music.effectiveId(track)] : undefined;
  const saved = download?.requested !== false && download?.status === "ready";
  const saving = download?.requested !== false && ["queued", "resolving", "downloading"].includes(download?.status || "");
  return <PlayerDialog title="A moment, just for you." subtitle="NOW PLAYING" onClose={onClose} wide fullscreen className={s.playerDialog} appearance="player">
    {!track ? <div className={s.empty}><h3>Make room for a good song.</h3><p>Choose a song to start listening.</p><PlayerButton onClick={close}>Find your music</PlayerButton></div> : <div className={s.fullPlayer}>
      <div className={s.playerArt}><Artwork url={track.coverUrl} title={track.title} priority/><span className={s.artNote}>put the world on pause.</span></div>
      <div className={s.playerDetails}><div className={s.playerTitle}><div><h1>{track.title}</h1><p onClick={close}><ArtistLinks track={track}/></p></div><IconButton icon="heart" label={music.liked.has(track.id) ? "Remove from liked songs" : "Like this song"} active={music.liked.has(track.id)} onClick={() => music.toggleLike(track)}/></div><p className={s.version}>{track.versionLabel}{track.albumTitle ? ` · ${track.albumTitle}` : ""}</p>
        <PlaybackRibbon positionMs={music.positionMs} durationMs={duration} onSeek={music.seek} disabled={music.status === "resolving"}/>
        <div className={s.transport}><IconButton icon="shuffle" label={music.shuffle ? "Turn shuffle off" : "Turn shuffle on"} active={music.shuffle} onClick={() => music.setShuffle(!music.shuffle)}/><IconButton icon="previous" label="Previous song" onClick={music.previous}/><button type="button" className={s.largePlay} aria-label={music.status === "playing" ? "Pause" : busy ? "Pause loading" : "Play"} onClick={music.togglePlay}>{busy ? <span className={s.spinner}/> : <span><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true">{music.status === "playing" ? <path d="M6 4h4v16H6zm8 0h4v16h-4z"/> : <path d="m7 4 14 8-14 8z"/>}</svg></span>}</button><IconButton icon="next" label="Next song" onClick={music.next}/><IconButton icon="repeat" label={`Repeat: ${music.repeat}. Change repeat mode`} active={music.repeat !== "off"} onClick={() => music.setRepeat(music.repeat === "off" ? "all" : music.repeat === "all" ? "one" : "off")}/>{music.repeat === "one" && <span className={s.repeatOne}>1</span>}</div>
        <p className={s.playbackStatus} role="status">{music.status === "resolving" ? "Finding your exact recording…" : music.status === "buffering" ? "A little more sound is on its way…" : music.status === "error" ? "This recording could not play. Choose Play to try again." : ""}</p>
        {music.status === "error" && music.error && <RecoveryNotice error={music.error} context="playback" retry={music.togglePlay} compact/>}
        <div className={s.playerActions}><PlayerButton secondary icon="lyrics" onClick={onOpenLyrics || (() => music.openModal("lyrics"))}>Lyrics</PlayerButton><PlayerButton secondary icon="queue" onClick={onOpenQueue || (() => music.openModal("queue"))}>Up next</PlayerButton><IconButton icon="share" label="Share this song" onClick={onOpenShare || (() => music.openModal("share"))}/><IconButton icon={saved ? "check" : "download"} label={saved ? "Saved for offline listening" : saving ? "Saving for offline listening" : "Download this recording"} active={saved} disabled={saved || saving} onClick={() => music.requestDownload(track)}/></div>
        <VolumeControl value={music.volume} onChange={music.setVolume}/>
        {lyrics.data?.lines.length ? <button className={s.lyricPeek} onClick={onOpenLyrics || (() => music.openModal("lyrics"))}><span className={s.eyebrow}>A LITTLE CLOSER TO THE WORDS</span><span>{lyrics.data.lines[active >= 0 ? active : 0]?.text || "Read the lyrics"}</span><small>Open lyrics <Icon name="external" size={13}/></small></button> : null}
      </div>
    </div>}
  </PlayerDialog>;
}
