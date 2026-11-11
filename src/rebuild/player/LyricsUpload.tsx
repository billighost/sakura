"use client";
import { useEffect, useRef, useState } from "react";
import { useMusic } from "../app/MusicContext";
import { requestJson, userMessage } from "../app/errors";
import type {MusicTrack} from "../app/types";
import s from "./player.module.css";
import type {PlayerLyrics} from "./useLyrics";

export function LyricsUpload({track,onPublished}:{track:MusicTrack;onPublished:(lyrics?:PlayerLyrics)=>Promise<void>}) {
  const music=useMusic(),[open,setOpen]=useState(false),[text,setText]=useState(""),[format,setFormat]=useState("plain"),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const pending=useRef(false);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[track.id,music.account?.id]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setMessage("");
    const owner=music.account?.id;
    const operation=new AbortController();controller.current=operation;
    try{
      const canonical=await music.ensureRecording(track);
      if(operation.signal.aborted)return;
      const result=await requestJson<{published:boolean;lyrics?:PlayerLyrics}>("/api/v2/lyrics/publish",{method:"POST",signal:operation.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({recordingId:canonical.id,text,format})},{context:"save",accountId:owner,timeoutMs:60000});
      if(operation.signal.aborted)return;
      setOpen(false);setMessage("Published to LRCLIB. Fetching your lyrics…");await onPublished(result.lyrics);
    }catch(error){if(!operation.signal.aborted)setMessage(userMessage(error,"save"));}
    finally{pending.current=false;if(!operation.signal.aborted)setBusy(false);}
  }
  return <div className={s.lyricsUpload} data-playback-shortcuts="off">
    {!open?<button type="button" onClick={()=>setOpen(true)}>Missing lyrics? Upload them</button>:<form onSubmit={submit}>
      <p>Publish lyrics for <strong>{track.title}</strong> by {track.artists.join(", ")} to LRCLIB’s public database.</p>
      <label>Lyrics format<select value={format} onChange={event=>setFormat(event.target.value)} disabled={busy}><option value="plain">Plain text</option><option value="lrc">Synced LRC</option></select></label>
      <label>Lyrics<textarea value={text} onChange={event=>setText(event.target.value)} maxLength={20000} rows={8} required disabled={busy}/></label>
      <label className={s.lyricsFile}>Choose a .txt or .lrc file<input type="file" accept=".txt,.lrc,text/plain" disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(file){if(file.size>80000){setMessage("Choose a lyric file under 80 KB.");return;}void file.text().then(value=>{setText(value);setFormat(file.name.toLowerCase().endsWith(".lrc")?"lrc":"plain");});}}}/></label>
      <button type="submit" disabled={busy||!text.trim()}>{busy?"Publishing…":"Publish lyrics"}</button><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button>
    </form>}{message&&<p role="status">{message}</p>}
  </div>;
}
