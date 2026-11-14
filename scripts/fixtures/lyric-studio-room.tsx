"use client";
import { useEffect, useState } from "react";
import { useMusic } from "@/rebuild/app/MusicContext";
import { LyricsUpload } from "@/rebuild/player/LyricsUpload";
import { VERIFIED_LYRICS_VERSION } from "@/rebuild/lyrics/versions";
import type { MusicTrack } from "@/rebuild/app/types";
import type { PlayerLyrics } from "@/rebuild/player/useLyrics";

const track: MusicTrack = { id: "95170000-0000-4000-8000-000000000481", title: "Words in the garden", artists: ["Studio fixture"], albumTitle: "A little manuscript", albumId: null, artistId: null, durationMs: 12000, coverUrl: null, versionLabel: "Original recording", reference: { provider: "deezer", id: "481" }, references: [] };
const plain: PlayerLyrics = { schemaVersion: VERIFIED_LYRICS_VERSION, timing: "plain", provider: "lrclib", providerTrackId: 481, instrumental: false, hasJapanese: false, lines: [{ text: "The first petals find the light", start: 0 }, { text: "A song is carried on the breeze", start: 0 }, { text: "And every word has room to bloom", start: 0 }] };
export default function Room() {
  const music = useMusic(), [published, setPublished] = useState<PlayerLyrics | undefined>(), [unresolved,setUnresolved] = useState(false);
  const studioTrack=unresolved?{...track,id:"deezer:991",reference:{provider:"deezer" as const,id:"991"}}:track;
  useEffect(() => { Object.assign(window, { studioProbe: music, studioTrack: track, studioPublished: published }); });
  return <section><h1>Lyric studio verification</h1><p>A synthetic recording and words. No public contribution is sent.</p><button type="button" onClick={() => music.play(track)}>Play studio fixture</button><button type="button" onClick={()=>setUnresolved(true)}>Use unresolved studio recording</button><LyricsUpload key={unresolved?"unresolved":"known"} track={studioTrack} onPublished={async lyrics=>{setPublished(lyrics);if(unresolved)await new Promise<void>(()=>{});}}/>{!unresolved&&<LyricsUpload track={track} initialLyrics={plain} sync onPublished={async lyrics => setPublished(lyrics)}/>}<output data-studio-published>{published?.timing || "draft"}</output></section>;
}
