"use client";
import Link from "next/link";
import { useId, useRef, useState, type CSSProperties } from "react";
import { useMusic } from "./MusicContext";
import { useResource } from "./resources";
import { Artwork, Button, Empty, LoadingRows, LoadError, TrackList } from "./Elements";
import { RecoveryNotice } from "./RecoveryNotice";
import { GardenSlider } from "./ListeningControls";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import { musicTrack, type MusicTrack } from "./types";
import { PersonalizationDataControls } from "./PersonalizationDataControls";
import { BloomShelf } from "../bloom/BloomPage";
import s from "./listening-profile.module.css";
import starting from "./initial-taste-profile.module.css";

interface Genre { name: string; audibleMs: number; share?: number }
interface Day { date: string; audibleMs: number }
interface Hour { hour: number; audibleMs: number; genres: Genre[] }
interface Insights {
  days: Day[]; hours: Hour[]; genres: Genre[]; completionRate: number; skipRate: number; activeDays: number; finishedEvents?: number;
  confidence: { level: "starting" | "growing" | "established"; label: string; evidence: string };
  topSongs: Record<string, unknown>[]; timeZone: string;
  retention?: { description?: string; historyEvents?: number; rateDescription?: string; genreDescription?: string };
  genreDescription?: string;
  untaggedAudibleMs?: number;
}
interface ProfileData {
  profile: { username: string; bio?: string | null; avatarUrl?: string | null; createdAt?: string };
  stats: { audibleMs?: number; playCount?: number; uniqueRecordings?: number; completedCount?: number; skippedCount?: number; liked?: number; playlists?: number };
  topArtists: { id: string; name: string; imageUrl?: string | null; audibleMs: number }[];
  insights?: Insights;
  onboarding?: { seedGenres?: string[]; seedArtists?: string[]; initialTasteGenres?:string[] };
}
function listeningTime(value: number) {
  const minutes = Math.floor(Math.max(0, Number(value) || 0) / 60000);
  if (minutes < 1) return value > 0 ? "less than a minute" : "0 minutes";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
function dayLabel(day: string) {
  const date = new Date(day + "T12:00:00Z");
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : day;
}
function hourLabel(hour: number) { return hour === 0 ? "midnight" : hour === 12 ? "noon" : `${hour % 12}${hour < 12 ? "am" : "pm"}`; }
function normalizedTracks(values: Record<string, unknown>[]) {
  const tracks: MusicTrack[] = [];
  for (const value of values) try { tracks.push(musicTrack(value)); } catch {}
  return tracks;
}

function ListeningDays({ days }: { days: Day[] }) {
  const [selected, setSelected] = useState<number | null>(null), gradientId = useId();
  const index = Math.min(days.length - 1, selected ?? Math.max(0, days.length - 1)), day = days[index];
  const maximum = Math.max(1, ...days.map(item => item.audibleMs));
  const x = (i: number) => 12 + i / Math.max(1, days.length - 1) * 576;
  const y = (ms: number) => 147 - ms / maximum * 108;
  const path = days.map((item, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(item.audibleMs).toFixed(2)}`).join(" ");
  return <section className={`${s.chartCard} ${s.dayCard}`} aria-label="Listening over the last 30 days">
    <div className={s.cardHeading}><div><span className={s.eyebrow}>THE LAST 30 DAYS</span><h2>Your listening,<br/><em>day by day.</em></h2></div><Icon name="sun" size={24}/></div>
    <div className={s.chartValue}><strong>{day ? listeningTime(day.audibleMs) : "0 minutes"}</strong><span>{day ? dayLabel(day.date) : "Your listening starts here"}</span></div>
    <div className={s.dailyDrawing}>
      <svg viewBox="0 0 600 170" preserveAspectRatio="none" role="img" aria-label={`Listening chart for ${days.length} days. Highest day: ${listeningTime(maximum > 1 ? maximum : 0)}.`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ink-petal)" stopOpacity=".42"/><stop offset="100%" stopColor="var(--ink-petal)" stopOpacity=".025"/></linearGradient></defs>
        {[43, 95, 147].map(value => <path key={value} d={`M12 ${value}H588`} className={s.chartGrid}/>)}
        {days.length > 0 && <><path d={`${path}L588 147L12 147Z`} fill={`url(#${gradientId})`}/><path d={path} className={s.chartLine}/><path d={`M${x(index)} 22V150`} className={s.chartCursor}/><circle cx={x(index)} cy={y(day?.audibleMs || 0)} r="5" className={s.chartDot}/></>}
      </svg>
    </div>
    {days.length > 0 && <><div className={s.chartDates}><span>{dayLabel(days[0].date)}</span><span>{dayLabel(days[days.length - 1].date)}</span></div><GardenSlider label="Choose a day in your listening chart" min={0} max={Math.max(1, days.length - 1)} step={1} value={index} valueText={day ? `${dayLabel(day.date)}, ${listeningTime(day.audibleMs)} listened` : "No listening recorded"} onChange={setSelected}/></>}
    <p className={s.smallNote}>Choose a day to see its listening time. Playback while paused, seeking, or muted is not counted.</p>
  </section>;
}

function ListeningHours({ hours, timeZone }: { hours: Hour[]; timeZone: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const bars = useRef<HTMLDivElement>(null);
  const complete = Array.from({ length: 24 }, (_, hour) => hours.find(item => item.hour === hour) || { hour, audibleMs: 0, genres: [] });
  const peak = complete.reduce((best, item) => item.audibleMs > best.audibleMs ? item : best, complete[0]);
  const selectedHour = complete[selected ?? peak.hour], maximum = Math.max(1, peak.audibleMs);
  return <section className={`${s.chartCard} ${s.hourCard}`} aria-label="Listening by hour of the day">
    <div className={s.cardHeading}><div><span className={s.eyebrow}>YOUR LISTENING RHYTHM</span><h2>Your listening,<br/><em>through the day.</em></h2></div><Icon name="moon" size={23}/></div>
    <div ref={bars} className={s.hourBars} role="group" aria-label="Select an hour to see its listening details" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? 23 : (selectedHour.hour + (event.key === "ArrowRight" ? 1 : -1) + 24) % 24;
      setSelected(next); bars.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    }}>{complete.map(item => <button key={item.hour} type="button" tabIndex={selectedHour.hour === item.hour ? 0 : -1} aria-pressed={selectedHour.hour === item.hour} aria-label={`${hourLabel(item.hour)}, ${listeningTime(item.audibleMs)} listened`} title={`${hourLabel(item.hour)} · ${listeningTime(item.audibleMs)}`} onClick={() => setSelected(item.hour)}><span style={{ "--bar-height": `${Math.max(3, item.audibleMs / maximum * 100)}%` } as CSSProperties}/></button>)}</div>
    <div className={s.chartDates}><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
    <div className={s.hourDetail}><label className={s.hourPicker}><span className={s.srOnly}>Choose a listening hour</span><select value={selectedHour.hour} onChange={event => setSelected(Number(event.target.value))}>{complete.map(item => <option key={item.hour} value={item.hour}>{hourLabel(item.hour)}</option>)}</select></label><span aria-live="polite">{listeningTime(selectedHour.audibleMs)} of listening</span>{selectedHour.genres.length ? <div className={s.hourGenres}>{selectedHour.genres.slice(0, 3).map(genre => <span key={genre.name}><b dir="auto">{genre.name}</b><small>{listeningTime(genre.audibleMs)}</small></span>)}</div> : <small>No genre information for this listening hour.</small>}</div>
    <p className={s.smallNote}>Saved listening history, shown in {timeZone}. Choose an hour above or use the arrow keys in the chart.</p>
  </section>;
}

function GenreGarden({ genres, seeds, description, untaggedAudibleMs }: { genres: Genre[]; seeds: string[]; description?: string; untaggedAudibleMs?: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const maximum = Math.max(1, ...genres.map(genre => genre.audibleMs)), total = genres.reduce((sum, genre) => sum + genre.audibleMs, 0);
  const chosen = genres.find(genre => genre.name === selected) || genres[0];
  return <section className={`${s.chartCard} ${s.genreCard}`} aria-label="Genres you listened to">
    <div className={s.cardHeading}><div><span className={s.eyebrow}>YOUR LISTENING BY GENRE</span><h2>The genres<br/><em>you listen to.</em></h2></div><Blossom/></div>
    {genres.length > 0 ? <><div className={s.genreRows}>{genres.slice(0, 8).map((genre, index) => <button type="button" key={genre.name} aria-pressed={chosen?.name === genre.name} onClick={() => setSelected(genre.name)}><span><b dir="auto">{genre.name}</b><small>{Math.round((genre.share ?? genre.audibleMs / Math.max(1, total)) * 100)}%</small></span><i><i style={{ width: `${genre.audibleMs / maximum * 100}%`, "--genre-index": index } as CSSProperties}><Blossom/></i></i></button>)}</div><p className={s.genreDetail} aria-live="polite">{chosen && <><strong>{chosen.name}</strong> · {listeningTime(chosen.audibleMs)} of listening</>}</p></> : <div className={s.genreEmpty}><Blossom/><p>Genre patterns appear as you listen to songs with genre information.</p>{seeds.length > 0 && <div className={s.seedTags}>{seeds.map(seed => <span key={seed}>{seed}</span>)}</div>}</div>}
    <p className={s.smallNote}>{description || "Listening time is shared evenly across each song’s published genres. Songs without genre information are counted separately."}{untaggedAudibleMs ? ` ${listeningTime(untaggedAudibleMs)} of listening had no genre tags.` : ""}{!genres.length && seeds.length > 0 ? " The genres above are choices you made." : ""}</p>
  </section>;
}

export function ListeningProfile() {
  const music = useMusic(), resource = useResource<ProfileData>(music.account?.id || null, "/api/v2/profile");
  const data = resource.data, stats = data?.stats || {}, insights = data?.insights;
  const tracks = normalizedTracks(insights?.topSongs || []), artists = data?.topArtists || [];
  return <div className={s.profile}>
    <header className={s.profilePrelude}><span className={s.eyebrow}>YOUR MUSIC, OVER TIME</span><Link href="/settings#your-feed">Shape your feed <Icon name="settings" size={16}/></Link></header>
    <div className={s.profileHero}>
      <div className={s.profileIdentity}><span className={s.eyebrow}>YOUR LISTENING JOURNAL</span><h1>Your music,<br/><em>over time.</em></h1><p>Songs, artists, and time spent listening.<br/>A record of your listening in Sakura.</p><div className={s.listenerName}><Blossom/><b>{data?.profile.username || music.account?.username || "Your listening journal"}</b>{data?.profile.createdAt && <span>here since {new Date(data.profile.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>}</div>{data?.profile.bio && <p className={s.profileBio} dir="auto">{data.profile.bio}</p>}</div>
      <div className={s.soundPrint} data-profile-bloom aria-hidden="true"><svg viewBox="0 0 320 320"><g fill="none" stroke="currentColor">{[138, 122, 106, 90, 74, 58].map((radius, i) => <circle key={radius} cx="160" cy="160" r={radius} strokeWidth={i % 2 ? ".7" : "1.2"} strokeDasharray={i % 2 ? "3 8" : undefined} opacity={.18 + i * .045}/>)}<path pathLength="1" d="M41 245C117 255 178 160 227 84M132 208c-26-5-36-22-43-41 23 4 44 12 51 33M180 158c-8-28 2-46 18-61 4 22 5 41-13 53M221 97c17-18 38-19 54-13-13 16-26 24-43 22" strokeWidth="1.3"/></g></svg><Blossom className={s.centerBlossom}/><span>music, with room to breathe.</span><i className={s.orbitPetal}/><i className={s.orbitPetal}/></div>
    </div>
    {resource.loading && !data ? <LoadingRows/> : resource.error && !data ? <LoadError message={resource.error} retry={resource.retry}/> : <>
      {resource.error && data && <RecoveryNotice compact error={resource.error} retry={resource.retry}/>}
      <p className={s.totalsLabel}>Your saved listening totals</p><div className={s.statsGrid}>{[
        { value: ((Number(stats.audibleMs) || 0) / 3600000).toFixed(1), label: "hours of listening", note: "Time you actually heard" },
        { value: Number(stats.playCount) || 0, label: "song plays", note: "Including partial listens" },
        { value: Number(stats.uniqueRecordings) || 0, label: "songs heard", note: "Each song version counts once" },
        { value: insights?.activeDays || 0, label: "days with music", note: "In your saved history" },
      ].map(stat => <div key={stat.label}><b>{stat.value}</b><span>{stat.label}</span><small>{stat.note}</small></div>)}</div>
      <div className={s.tasteNote}><span className={s.confidenceBloom}><Blossom/></span><div><span className={s.eyebrow}>YOUR RECOMMENDATION HISTORY</span><h2>{insights?.confidence.label || "Your recommendations start here."}</h2><p>{insights?.confidence.evidence || "Your chosen artists, genres, and listening history help select recommendations."}</p></div><Link href="/settings#your-feed">Adjust preferences <Icon name="arrow" size={16}/></Link></div>
      {!Number(stats.audibleMs) && <div className={s.startNote}><Blossom/><p>No listening has been recorded yet. Your charts show listening saved in Sakura.</p><Link href="/home">Browse music <Icon name="arrow" size={15}/></Link></div>}
      {insights?.confidence.level!=="established"&&Boolean(data?.onboarding?.seedArtists?.length)&&<details className={starting.startingPoints}><summary>Your chosen starting points</summary><p>Your chosen artists guide recommendations: {data!.onboarding!.seedArtists!.join(", ")}.</p>{Boolean(data?.onboarding?.initialTasteGenres?.length)&&<p>Genres from their music: {data!.onboarding!.initialTasteGenres!.slice(0,6).join(", ")}.</p>}<p>Your charts and Bloom show recorded listening separately.</p><Link href="/onboarding">Change your artists <Icon name="arrow" size={15}/></Link></details>}
      <div className={s.insightGrid}><ListeningDays days={insights?.days || []}/><ListeningHours hours={insights?.hours || []} timeZone={insights?.timeZone || music.settings.timeZone || "Africa/Lagos"}/><GenreGarden genres={insights?.genres || []} seeds={data?.onboarding?.seedGenres || []} description={insights?.genreDescription || insights?.retention?.genreDescription} untaggedAudibleMs={insights?.untaggedAudibleMs}/><section className={`${s.chartCard} ${s.listeningHabits}`} aria-label="Listening habits"><div className={s.cardHeading}><div><span className={s.eyebrow}>LISTENS THAT ENDED</span><h2>From the first note<br/><em>to the end.</em></h2></div><Icon name="queue" size={23}/></div>{insights?.finishedEvents === 0 || !Number(stats.playCount) ? <p className={s.habitsEmpty}>No recorded finishes or skips yet.</p> : <div className={s.habitStats}><div><strong>{Math.round(Math.max(0, Math.min(1, insights?.completionRate || 0)) * 100)}<small>%</small></strong><span>played to the end</span><p>{insights?.finishedEvents === undefined ? Number(stats.completedCount) || 0 : Math.round(insights.finishedEvents * insights.completionRate)} recorded finishes</p></div><div><strong>{Math.round(Math.max(0, Math.min(1, insights?.skipRate || 0)) * 100)}<small>%</small></strong><span>skipped</span><p>{insights?.finishedEvents === undefined ? Number(stats.skippedCount) || 0 : Math.round(insights.finishedEvents * insights.skipRate)} recorded skips</p></div></div>}<div className={s.libraryCounts}><Link href="/liked"><Icon name="heart" size={17}/><span>{Number(stats.liked) || 0} liked songs</span><Icon name="arrow" size={14}/></Link><Link href="/library"><Icon name="library" size={17}/><span>{Number(stats.playlists) || 0} playlists</span><Icon name="arrow" size={14}/></Link></div><p className={s.smallNote}>{insights?.retention?.rateDescription || "These percentages describe listens that ended or were skipped. Paused and unfinished listens stay out of the count."}</p></section></div>
      {artists.length > 0 && <section className={s.artistSection}><div className={s.sectionHeading}><div><span className={s.eyebrow}>YOUR MOST HEARD ARTISTS</span><h2>The artists<br/><em>in your listening.</em></h2></div><Link href="/discover">Explore artists <Icon name="arrow" size={16}/></Link></div><div className={s.artistGrid}>{artists.slice(0, 6).map((artist, index) => <Link className={s.artistCard} href={`/artist/${encodeURIComponent(artist.id)}`} key={artist.id}><div className={s.artistArt}><Artwork url={artist.imageUrl} title={artist.name}/><span>{String(index + 1).padStart(2, "0")}</span></div><h3 dir="auto">{artist.name}</h3><small>{listeningTime(artist.audibleMs)} together</small></Link>)}</div></section>}
      <section className={s.topSongSection}><div className={s.sectionHeading}><div><span className={s.eyebrow}>YOUR MOST HEARD SONGS</span><h2>The songs<br/><em>you play most.</em></h2></div>{tracks.length > 0 && <Button secondary icon="play" onClick={() => music.play(tracks[0], tracks)}>Play top songs</Button>}</div>{tracks.length > 0 ? <TrackList tracks={tracks.slice(0, 8)}/> : <Empty title="No top songs yet." description="Songs are ranked by your recorded listening time." href="/home" action="Browse music"/>}</section>
      <BloomShelf/>
      <PersonalizationDataControls/>
      <p className={s.profileFootnote}>{insights?.retention?.description || "From your saved Sakura listening history."} These charts describe recorded listening patterns.</p>
    </>}
  </div>;
}
