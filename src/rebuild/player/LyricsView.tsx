"use client";
import { useEffect, useRef, useState } from "react";
import { useMusic } from "../app/MusicContext";
import { ArtistLinks } from "../app/ArtistLinks";
import { activeLyricIndex } from "../lyrics/parse";
import { formatPlaybackTime, IconButton, PlayerButton, PlayerDialog } from "./Primitives";
import { RecoveryNotice } from "../app/RecoveryNotice";
import { useLyrics, type PlayerLyricLine } from "./useLyrics";
import { setShareSelection } from "./shareSelection";
import s from "./player.module.css";

export function LyricsView({ onClose, onOpenShare }: { onClose?: () => void; onOpenShare?: (lines: PlayerLyricLine[]) => void }) {
  const music = useMusic();
  const lyrics = useLyrics(music.track);
  const [follow, setFollow] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<{ trackId: string; indices: number[] }>({ trackId: "", indices: [] });
  const [reading, setReading] = useState(false);
  const [readingBusy, setReadingBusy] = useState(false);const readingLock=useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const viewRef = useRef<HTMLDivElement>(null);
  const data = lyrics.data;
  const selected = selection.trackId === music.track?.id ? selection.indices : [];
  const active = data?.timing === "synced" ? activeLyricIndex(data.lines, music.positionMs / 1000) : -1;
  useEffect(() => {
    if (!follow || selecting || active < 0) return;
    const line = lineRefs.current[active];
    const scroll = viewRef.current?.closest<HTMLElement>("[data-player-scroll]");
    if (!line || !scroll) return;
    const lineRect = line.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    scroll.scrollTo({ top: Math.max(0, scroll.scrollTop + lineRect.top - scrollRect.top - scroll.clientHeight * .4 + lineRect.height / 2), behavior: music.settings.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [active, follow, selecting, music.settings.reducedMotion]);
  async function toggleReading() {if(readingLock.current)return;
    if (reading) { setReading(false); return; }
    readingLock.current=true;setReadingBusy(true);
    setMessage(null);
    try { await lyrics.getJapaneseReadings(); setReading(true); music.dismissNotice(); }
    catch (error) { music.reportError(error, "lyrics", () => void toggleReading()); setMessage("The reading guide is taking a little pause. You can try again."); }
    finally { readingLock.current=false;setReadingBusy(false); }
  }
  function chooseLine(index: number) {
    if (!music.track || !data) return;
    if (!selecting && data.timing === "synced") { music.seek(data.lines[index].start * 1000); setFollow(true); return; }
    if (!selecting) { setSelecting(true); setFollow(false); }
    const range = selected.includes(index) ? index === selected[0] ? [] : selected.filter((value) => value < index) : selected.length ? Array.from({ length: Math.abs(index - selected[0]) + 1 }, (_, position) => Math.min(index, selected[0]) + position) : [index];
    const indices = range.filter(value => data.lines[value].text.trim());
    if (indices.length > 8) { setMessage("Choose up to eight neighbouring lines for your lyric card."); return; }
    setSelection({ trackId: music.track.id, indices });
    setMessage(null);
  }
  function share() {
    if (!data || !music.track || !selected.length) { setFollow(false); setSelecting(true); setMessage("Choose the lines you want to share."); return; }
    const lines = selected.slice().sort((a, b) => a - b).map((index) => data.lines[index]).filter((line) => line.text.trim());
    setShareSelection(music.track.id, lines);
    if (onOpenShare) onOpenShare(lines);
    else music.openModal("share");
  }
  const content = <div className={s.lyricsView} ref={viewRef} onWheel={() => { if (follow) setFollow(false); }} onTouchMove={() => { if (follow) setFollow(false); }}>
    {music.track && <div className={s.lyricsTrack}><h3>{music.track.title}</h3><p onClick={onClose}><ArtistLinks track={music.track}/> · {music.track.versionLabel}</p></div>}
    <div className={s.chips}>{data?.timing === "synced" && <button type="button" aria-pressed={follow && !selecting} onClick={() => { setSelecting(false); setFollow(true); }}>{follow && !selecting ? "Following along" : "Follow the words"}</button>}<button type="button" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setFollow(selecting); }}>{selecting ? "Done selecting" : "Select lines"}</button>{data?.hasJapanese && <button type="button" aria-pressed={reading} disabled={readingBusy} onClick={() => void toggleReading()}>{readingBusy ? "Preparing readings…" : "Japanese reading guide"}</button>}<button type="button" onClick={share}>Share {selected.length ? `${selected.length} lines` : "lyrics"}</button></div>
    {message && <p className={s.hint} role="status">{message}</p>}
    {lyrics.loading && <div className={s.empty}><span className={s.spinner}/><p>Finding the words for this recording…</p></div>}
    {lyrics.error && <RecoveryNotice error={lyrics.error} context="lyrics" retry={lyrics.retry}/>}
    {!music.track && <div className={s.empty}><p>Choose a song to discover its lyrics.</p></div>}
    {data?.instrumental && <div className={s.empty}><h3>Let the instruments speak.</h3><p>This recording is instrumental.</p></div>}
    {data && !data.instrumental && <><p className={s.hint}>{data.timing === "synced" ? !selecting ? "Tap a line to listen from that moment. Scroll to explore; Follow the words brings you back." : "Choose neighbouring lines for an exact lyric card." : "These lyrics are not time synced. Select lines to share them."}</p><div className={s.lyricLines} onWheel={() => { if (follow) setFollow(false); }} onTouchMove={() => { if (follow) setFollow(false); }}>{data.lines.map((line, index) => !line.text ? <div className={s.lyricGap} key={`${line.start}-${index}`} aria-hidden="true"/> : <button type="button" key={`${line.start}-${index}`} ref={(element) => { lineRefs.current[index] = element; }} className={`${s.lyricLine} ${index === active ? s.currentLyric : ""} ${selected.includes(index) ? s.selectedLyric : ""}`} aria-pressed={selecting ? selected.includes(index) : undefined} aria-current={index === active ? "true" : undefined} onClick={() => chooseLine(index)}><span>{line.words?.length && index === active ? line.words.map((word, wordIndex) => <span key={wordIndex} className={music.positionMs / 1000 >= word.start && (word.end === undefined || music.positionMs / 1000 < word.end) ? s.currentWord : ""}>{word.text}</span>) : line.text}</span>{reading && line.romanized && <small>{line.romanized}{line.readingReviewNeeded && <span className={s.reviewMark} title="This line contains a reading that needs review"> · reading needs review</span>}</small>}</button>)}</div><p className={s.hint}>Lyrics: {data.provider}. {reading ? "Japanese readings use a word dictionary. Names and poetic pronunciations can vary." : ""}</p></>}
    <div className={s.lyricsControls}><div className={s.lyricsProgress}><span>{formatPlaybackTime(music.positionMs)}</span><progress aria-label="Song progress" value={music.positionMs} max={Math.max(1, music.durationMs || music.track?.durationMs || 1)}/><span>{formatPlaybackTime(music.durationMs || music.track?.durationMs || 0)}</span></div><div className={s.lyricsTransport}><IconButton icon="previous" label="Previous song" onClick={music.previous}/><IconButton icon={music.status === "playing" ? "pause" : "play"} label={music.status === "playing" ? "Pause" : "Play"} onClick={music.togglePlay}/><IconButton icon="next" label="Next song" onClick={music.next}/>{data&&!data.instrumental&&<><IconButton icon="lyrics" label={selecting ? "Finish lyric selection" : "Select lyric lines"} active={selecting} onClick={() => { setSelecting(!selecting); setFollow(selecting); }}/><IconButton icon="share" label="Make a lyric card" onClick={share}/></>}{!follow && !selecting && data?.timing === "synced" && <PlayerButton secondary onClick={() => { setSelecting(false); setFollow(true); }}>Follow the words</PlayerButton>}</div></div>
  </div>;
  return onClose ? <PlayerDialog title="A little closer to the words." subtitle="LYRICS" onClose={onClose} wide fullscreen className={s.lyricsDialog}>{content}</PlayerDialog> : content;
}
