"use client";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { usePlaybackProgress } from "../app/MusicContext";
import { useMusicActions, useMusicView } from "../app/musicView";
import { lyricEdition } from "../lyrics/identity";
import { Blossom } from "../app/Brand";
import { LyricsUpload } from "./LyricsUpload";
import { ReadingLanguageChoice } from "./ReadingLanguageChoice";
import { AutoSyncButton } from "./AutoSyncButton";
import { AlbumLink } from "../app/AlbumLink";
import { ArtistLinks } from "../app/ArtistLinks";
import { PlaybackRibbon } from "../app/ListeningControls";
import { requestDialogClose } from "../app/dialogLifecycle";
import { formatPlaybackTime, IconButton, PlayerButton, PlayerDialog } from "./Primitives";
import { RecoveryNotice } from "../app/RecoveryNotice";
import { userIssue } from "../app/errors";
import { lyricInputKey, useLyrics, type PlayerLyricLine } from "./useLyrics";
import { useLyricMoment } from "./useLyricProgress";
import { useLyricFollow } from "./useLyricFollow";
import { setShareSelection } from "./shareSelection";
import { useJapaneseReading } from "./useJapaneseReading";
import s from "./player.module.css";

type LyricsViewProps = { onClose?: () => void; onOpenShare?: (lines: PlayerLyricLine[]) => void };
const EMPTY_SELECTION: number[] = [];

export function LyricsView(props: LyricsViewProps) {
  const music = { ...useMusicView(), ...useMusicActions() };
  // Reset song-specific interaction state without remounting the open dialog.
  // A temporary-to-canonical ID resolution keeps the same lyric identity.
  const content = <LyricsContent key={`${music.currentEntryId || "no-entry"}:${music.track ? lyricInputKey(music.track) : "no-track"}`} {...props}/>;
  return props.onClose ? <PlayerDialog appearance="lyrics" title="A little closer to the words." subtitle="LYRICS" headerDetail={music.track?.title} onClose={props.onClose} wide fullscreen className={s.lyricsDialog}>{content}</PlayerDialog> : content;
}

function LyricsContent({ onClose, onOpenShare }: LyricsViewProps) {
  const view = useMusicView(), actions = useMusicActions(), music = useMemo(() => ({ ...view, ...actions }), [view, actions]);
  const lyrics = useLyrics(music.track);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<{ source: string; indices: number[] }>({ source: "", indices: [] });
  const readingGuide = useJapaneseReading(lyrics);
  const reading = readingGuide.enabled;
  const [message, setMessage] = useState<string | null>(null);
  const lineRefs = useRef<Array<HTMLElement | null>>([]);
  const viewRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const data = lyrics.data;
  const lineSource = useMemo(() => JSON.stringify(data?.lines.map(line => [line.start, line.text]) || []), [data?.lines]);
  const selected = selection.source === lineSource ? selection.indices : EMPTY_SELECTION;
  const moment = useLyricMoment(data?.lines, data?.timing === "synced");
  const active = moment.kind === "line" ? moment.index : -1;
  const { follow, pause, resume } = useLyricFollow({ targetIndex: moment.index, selecting, reducedMotion: music.settings.reducedMotion, viewRef, lineRefs, controlsRef, layoutVersion: `${lineSource}:${reading}` });
  const hasWords = Boolean(data && !data.instrumental && data.lines.some(line => line.text.trim()));
  const missingWords = Boolean(music.track && !lyrics.loading && !hasWords && !data?.instrumental && !lyricEdition(music.track.title, music.track.versionLabel).includes("instrumental"));
  const confirmedMissing = Boolean(lyrics.error && userIssue(lyrics.error,"lyrics").kind === "missing");
  const setLineRef = useCallback((index: number, element: HTMLElement | null) => { lineRefs.current[index] = element; }, []);

  function followWords() { setSelecting(false); resume(); }
  function toggleSelection() {
    setSelecting(!selecting);
    setMessage(null);
    if (selecting) resume(); else pause();
  }
  function closeView() { if (onClose) requestDialogClose(onClose, viewRef.current?.closest<HTMLDialogElement>("dialog")); }

  const chooseLine = useCallback((index: number) => {
    if (!music.track || !data) return;
    if (!selecting && data.timing === "synced") { music.seek(data.lines[index].start * 1000); resume(); return; }
    if (!selecting) { setSelecting(true); pause(); }
    const range = selected.includes(index)
      ? index === selected[0] ? [] : selected.filter(value => value < index)
      : selected.length ? Array.from({ length: Math.abs(index - selected[0]) + 1 }, (_, position) => Math.min(index, selected[0]) + position) : [index];
    const indices = range.filter(value => data.lines[value].text.trim());
    if (indices.length > 8) { setMessage("Choose up to eight neighbouring lines for your lyric card."); return; }
    setSelection({ source: lineSource, indices });
    setMessage(null);
  }, [music, data, selecting, selected, lineSource, pause, resume]);

  function share() {
    if (!data || !music.track || !selected.length) { pause(); setSelecting(true); setMessage("Choose the lines you want to share."); return; }
    const subject = music.track;
    const lines = selected.slice().sort((a, b) => a - b).map(index => data.lines[index]).filter(line => line.text.trim());
    setShareSelection(subject.id, lines);
    const open = () => { if (onOpenShare) onOpenShare(lines); else music.openModal("share", subject); };
    if (onClose) requestDialogClose(open, viewRef.current?.closest<HTMLDialogElement>("dialog")); else open();
  }

  return <div className={s.lyricsView} ref={viewRef} data-lyrics-follow={follow && !selecting}>
    {music.track && <div className={s.lyricsTrack}><h3>{music.track.title}</h3><p onClick={closeView}><ArtistLinks track={music.track}/> · {music.track.versionLabel} · <AlbumLink track={music.track} onNavigate={closeView}/></p></div>}
    {hasWords && <div className={s.chips}>
      {data?.timing === "synced" && <button type="button" aria-pressed={follow && !selecting} onClick={followWords}>{follow && !selecting ? "Following along" : "Follow the words"}</button>}
      <button type="button" aria-pressed={selecting} onClick={toggleSelection}>{selecting ? "Done selecting" : "Select lines"}</button>
      {readingGuide.language && <button type="button" aria-label={readingGuide.label} aria-pressed={reading} aria-busy={readingGuide.busy} title="Show pronunciation alongside the original lyrics." onClick={readingGuide.toggle}>{readingGuide.busy ? "Preparing readings…" : readingGuide.label}</button>}
      <button type="button" onClick={share}>Share {selected.length ? `${selected.length} lines` : "lyrics"}</button>
      {music.track && data?.timing === "plain" && <LyricsUpload track={music.track} initialLyrics={data} sync onPublished={lyrics.applyPublishedLyrics}/>}
      {data?.timing === "plain" && <button type="button" disabled={lyrics.loading} onClick={lyrics.retry}>Check for updates</button>}
      {music.track && data?.timing === "plain" && <AutoSyncButton key={`${music.account?.id}:${lyricInputKey(music.track)}`} track={music.track} lyrics={data} onSynced={lyrics.applyAutoSync}/>}
    </div>}
    {readingGuide.language && hasWords && <ReadingLanguageChoice guide={readingGuide}/>}
    {message && <p className={s.hint} role="status">{message}</p>}
    {readingGuide.error && <p className={s.readingRecovery} role="status">Your reading choice is saved. {readingGuide.error} <button type="button" onClick={readingGuide.retry}>Try the reading again</button></p>}
    {lyrics.loading && <div className={s.empty}><span className={s.spinner}/><p>Finding the words for this recording…</p></div>}
    {lyrics.error && !confirmedMissing && <RecoveryNotice error={lyrics.error} context="lyrics" retry={lyrics.retry}/>}
    {missingWords && music.track && <section className={s.lyricsMissing} aria-label="Missing lyrics" data-lyrics-missing>
      <div className={s.lyricsMissingBloom} aria-hidden="true"><Blossom/></div>
      <h4>A song waiting for its words.</h4>
      <p>Know this song by heart?<br/>Leave its words for the next listener.</p>
      <LyricsUpload key={lyricInputKey(music.track)} track={music.track} onPublished={lyrics.applyPublishedLyrics}/>
      {confirmedMissing && <button type="button" className={s.lyricsMissingRetry} onClick={lyrics.retry}>Check for lyrics again</button>}
    </section>}
    {!music.track && <div className={s.empty}><p>Choose a song to discover its lyrics.</p></div>}
    {data?.instrumental && <div className={s.empty}><h3>Let the instruments speak.</h3><p>This recording is instrumental.</p></div>}
    {data && !data.instrumental && !hasWords && !missingWords && <div className={s.empty}><p>The words are not available for this recording yet.</p></div>}
    {hasWords && data && <>
      <p className={s.hint}>{data.timing === "synced" ? selecting ? "Choose neighbouring lines for an exact lyric card." : "Tap a line or press Enter to listen from that moment. Space plays or pauses. Scroll to explore; bring the current words back into view to follow again." : "These lyrics are not time synced. Select lines to share them."}</p>
      {moment.kind === "intro" && <p className={s.lyricsAwaiting} role="status">A little music before the words.</p>}
      <div className={s.lyricLines}>
        {data.lines.map((line, index) => <LyricRow key={`${line.start}-${index}`} line={line} index={index} active={index === active} interlude={moment.kind === "interlude" && index === moment.index} selected={selected.includes(index)} selecting={selecting} synced={data.timing === "synced"} reading={reading} setLineRef={setLineRef} pause={pause} chooseLine={chooseLine}/>)}
      </div>
      <p className={s.hint}>Lyrics: {data.provider}. {data.autoSyncEvidence ? "Timing matched to this audio by auto sync." : ""}</p>
      {music.track && <LyricsUpload track={music.track} initialLyrics={data} onPublished={lyrics.applyPublishedLyrics}/>}
    </>}
    <div className={s.lyricsControls} ref={controlsRef} data-lyrics-controls>
      <LyricsTimeline selecting={selecting} resume={resume}/>
      <div className={s.lyricsTransport}>
        <IconButton icon="previous" label="Previous song" disabled={!music.track} onClick={music.previous}/>
        <IconButton icon={music.status === "playing" ? "pause" : "play"} label={music.status === "playing" ? "Pause" : "Play"} disabled={!music.track} onClick={music.togglePlay}/>
        <IconButton icon="next" label="Next song" disabled={!music.track} onClick={music.next}/>
        {hasWords && <><IconButton icon="lyrics" label={selecting ? "Finish lyric selection" : "Select lyric lines"} active={selecting} onClick={toggleSelection}/><IconButton icon="share" label="Make a lyric card" onClick={share}/></>}
        {!follow && !selecting && data?.timing === "synced" && <PlayerButton secondary onClick={followWords}>Follow the words</PlayerButton>}
      </div>
    </div>
  </div>;
}

const LyricRow = memo(function LyricRow({ line, index, active, interlude, selected, selecting, synced, reading, setLineRef, pause, chooseLine }: {
  line: PlayerLyricLine; index: number; active: boolean; interlude: boolean; selected: boolean; selecting: boolean; synced: boolean; reading: boolean;
  setLineRef: (index: number, element: HTMLElement | null) => void; pause: () => void; chooseLine: (index: number) => void;
}) {
  const ref = useCallback((element: HTMLElement | null) => setLineRef(index, element), [index, setLineRef]);
  if (!line.text.trim()) return <div className={`${s.lyricInterlude} ${interlude ? s.currentInterlude : ""}`} ref={ref} data-lyric-index={index}><span className={s.lyricInterludeDots} aria-hidden="true"><span/><span/><span/></span>{interlude && <small role="status">Instrumental</small>}</div>;
  return <button type="button" ref={ref} data-lyric-index={index} data-playback-shortcuts="listening" className={`${s.lyricLine} ${active ? s.currentLyric : ""} ${selected ? s.selectedLyric : ""}`} aria-pressed={selecting ? selected : undefined} aria-current={active ? "true" : undefined} title={!selecting && synced ? `Listen from ${formatPlaybackTime(line.start * 1000)}` : undefined} onPointerDown={pause} onClick={() => chooseLine(index)}>
    <span>{line.words?.length && active ? <ActiveLyricWords line={line}/> : line.text}</span>
    {reading && line.romanized && line.romanized.trim() !== line.text.trim() && <small>{line.romanized}</small>}
  </button>;
});

function ActiveLyricWords({ line }: { line: PlayerLyricLine }) {
  const progress = usePlaybackProgress();
  return <>{line.words!.map((word, index) => <span key={index} className={progress.positionMs / 1000 >= word.start && (word.end === undefined || progress.positionMs / 1000 < word.end) ? s.currentWord : ""}>{word.text}</span>)}</>;
}

function LyricsTimeline({ selecting, resume }: { selecting: boolean; resume: () => void }) {
  const music = { ...useMusicView(), ...useMusicActions() }, progress = usePlaybackProgress();
  return <div className={s.lyricsProgress}><PlaybackRibbon compact positionMs={progress.positionMs} durationMs={progress.durationMs || music.track?.durationMs || 0} label="Playback position in lyrics" disabled={!music.track || music.status === "resolving"} onSeek={position => { music.seek(position); if (!selecting) resume(); }}/></div>;
}
