"use client";
import { useState } from "react";
import Link from "next/link";
import type { ProviderReference, RecordingVersion } from "../core/types";
import type { TimedLyric } from "../lyrics/parse";
import { Icon } from "../app/Icon";
import { Artwork, PlayerIcon } from "./Primitives";
import s from "./shared.module.css";

export interface PublicSharePayload {
  recordingId: string; title: string; artists: string[]; albumTitle: string | null; durationMs: number;
  coverUrl: string | null; version?: RecordingVersion | null; lines: TimedLyric[];
  reference: ProviderReference | null; references: ProviderReference[]; colorMode: "light" | "dark";
}
export interface PublicShare { slug: string; kind: "track" | "lyric"; payload: PublicSharePayload; created_at?: string }
export function SharedSong({ share, signedIn = false }: { share: PublicShare; signedIn?: boolean }) {
  const [mode, setMode] = useState(share.payload.colorMode);
  const payload = share.payload;
  const firstTime = share.kind === "lyric" ? payload.lines[0]?.start || 0 : 0;
  const target = `/track/${encodeURIComponent(payload.recordingId)}?at=${Math.floor(firstTime * 1000)}&share=${encodeURIComponent(share.slug)}`;
  const login = `/login?next=${encodeURIComponent(target)}`;
  const register = `/register?next=${encodeURIComponent(target)}`;
  const version = payload.version?.labels?.join(" · ") || payload.version?.kinds?.join(" · ") || "Original recording";
  return <main className={`${s.shared} ${mode === "dark" ? s.dark : ""}`}>
    <header className={s.header}><Link href="/" className={s.brand}><svg viewBox="0 0 35 35" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M17 18C5 20 5 5 12 5c7 0 10 9 5 13Zm0 0c0-12 15-15 18-7 2 6-10 12-18 7Zm0 0c12 2 12 17 4 17-7-1-9-12-4-17Zm0 0C5 26-5 15 1 9c5-4 12 0 16 9Z" transform="translate(1 -2) scale(.9)"/></g></svg><span>sakura</span></Link><button className={s.mode} type="button" aria-label={`Switch shared card to ${mode === "dark" ? "light" : "dark"} mode`} onClick={() => setMode(mode === "dark" ? "light" : "dark")}>{mode === "dark" ? "Light paper" : "Night ink"}</button></header>
    <section className={s.card}><p className={s.eyebrow}>SHARED FROM SAKURA</p>{share.kind === "lyric" ? <div className={s.words}>{payload.lines.map((line, index) => <p key={`${line.start}-${index}`}>{line.text}</p>)}</div> : <Artwork url={payload.coverUrl} title={payload.title} className={s.cover}/>}
      <div className={s.song}><h1>{payload.title}</h1><p>{payload.artists.map((artist,index)=><span key={artist+":"+index}>{index>0&&<span aria-hidden="true"> · </span>}<Link href={"/search?"+new URLSearchParams({q:artist,tab:"Artists"})}>{artist}</Link></span>)}</p><small>{version}{payload.albumTitle ? ` · ${payload.albumTitle}` : ""}</small></div>
      <div className={s.actions}><Link className={s.listen} href={signedIn ? target : login}><PlayerIcon name="play" size={19}/>Listen on Sakura</Link>{!signedIn && <Link className={s.join} href={register}>A quiet place for your music<Icon name="external" size={14} style={{marginLeft:6}}/></Link>}</div><p className={s.note}>Open this recording in Sakura.{share.kind === "lyric" ? " The selected lyrics stay with this recording." : ""}</p>
    </section><footer className={s.footer}><span>music, with a little soul.</span><Link href="/about">Explore Sakura</Link></footer>
  </main>;
}
