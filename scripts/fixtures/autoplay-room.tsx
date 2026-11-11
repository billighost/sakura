"use client";
import { useEffect, useState } from "react";
import { useMusic } from "@/rebuild/app/MusicContext";
import { musicTrack, type MusicTrack } from "@/rebuild/app/types";
export default function AutoplayRoom() {
  const music = useMusic(), [tracks, setTracks] = useState<MusicTrack[]>([]);
  useEffect(() => { void fetch("/api/v2/home").then(response => response.json()).then(data => setTracks(data.featured.map(musicTrack))); }, []);
  useEffect(() => { Object.assign(window, { autoplayState: music, autoplayTracks: tracks }); }, [music, tracks]);
  return <section><h1>Continuous listening fixture</h1><button onClick={() => tracks[0] && music.play(tracks[0])}>Start continuous listening</button><p aria-live="polite">{music.track?.title || "Waiting"} · {music.status}</p></section>;
}
