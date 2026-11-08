"use client";
import {useEffect,useState} from "react";
import {useMusic} from "@/rebuild/app/MusicContext";
import {useBloomAudio} from "@/rebuild/bloom/useBloomAudio";
import {musicTrack} from "@/rebuild/app/types";
import {VolumeControl} from "@/rebuild/app/ListeningControls";

export default function MobileVolumeRoom(){
 const music=useMusic(),bloom=useBloomAudio();
 const [tracks,setTracks]=useState<Record<string,unknown>[]>([]);
 useEffect(()=>{void fetch("/api/v2/home").then(r=>r.json()).then(data=>setTracks(data.featured));},[]);
 useEffect(()=>{(window as unknown as {volumeState:unknown}).volumeState=music;},[music]);
 return <div>
  <h1>Mobile volume verification</h1>
  <button onClick={()=>tracks[0]&&music.play(musicTrack(tracks[0]))}>Play first song</button>
  <button onClick={()=>tracks[1]&&music.play(musicTrack(tracks[1]))}>Play second song</button>
  <button onClick={music.togglePlay}>Pause or resume</button>
  <button onClick={()=>tracks[1]&&bloom.play(tracks[1])}>Play chapter soundtrack</button>
  <button onClick={bloom.pause}>Pause chapter</button>
  <button onClick={bloom.resume}>Resume chapter</button>
  <button onClick={()=>bloom.close()}>Close chapter</button>
  <button onClick={()=>void music.updateSettings({audioTechnology:"night"})}>Use night sound</button>
  <button onClick={()=>void music.updateSettings({audioTechnology:"none"})}>Use original sound</button>
  <VolumeControl label="Verification volume" value={music.volume} onChange={music.setVolume}/>
  <p role="status">{bloom.message}</p>
 </div>;
}
