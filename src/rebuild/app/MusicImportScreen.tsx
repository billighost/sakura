"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMusic } from "./MusicContext";
import { invalidateResources } from "./resources";
import { Button, SearchField, PageTitle, SectionTitle } from "./Elements";
import { requestJson, userMessage } from "./errors";
import { RecoveryNotice } from "./RecoveryNotice";
import { localId } from "./sessionState";
import { useScreenActions } from "./screenActions";
import { Blossom } from "./Brand";
import { TrackCollection } from "./TrackCollection";
import s from "./ink.module.css";
import { type Data, list } from "./MusicScreenResources";

export function Import(){
 const p=useMusic(),router=useRouter(),actions=useScreenActions(p.account?.id);
 const [url,setUrl]=useState(""),[result,setResult]=useState<{url:string;data:Data}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const currentUrl=useRef(""),importRequest=useRef<{url:string;id:string}|null>(null),ready=result?.url===url.trim()?result.data:null;
 function change(value:string){currentUrl.current=value.trim();setUrl(value);setResult(null);setError(null);actions.cancel("import");}
 async function preview(){
  const submitted=url.trim();if(!submitted)return;const controller=actions.begin("import");if(!controller)return;setBusy(true);setError(null);setResult(null);
  try{const data=await requestJson("/api/v2/import",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({url:submitted,confirm:false})},{context:"save",accountId:p.account?.id,timeoutMs:300000});
   if(actions.current("import",controller)&&currentUrl.current===submitted)setResult({url:submitted,data});
  }catch(e){if(actions.current("import",controller))setError(userMessage(e,"save"));}finally{if(actions.finish("import",controller))setBusy(false);}
 }
 async function confirm(){
  const submitted=url.trim();if(!ready||!submitted)return;const controller=actions.begin("import");if(!controller)return;setBusy(true);setError(null);
  if(importRequest.current?.url!==submitted)importRequest.current={url:submitted,id:localId()};
  try{const data=await requestJson("/api/v2/import",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({url:submitted,confirm:true,requestId:importRequest.current.id})},{context:"save",accountId:p.account?.id,timeoutMs:300000});
   if(!actions.current("import",controller)||currentUrl.current!==submitted)return;p.notify("Playlist imported.");if(p.account)invalidateResources(p.account.id);router.push("/playlist/"+data.playlistId);
  }catch(e){if(actions.current("import",controller))setError(userMessage(e,"save"));}finally{if(actions.finish("import",controller))setBusy(false);}
 }
 return <><PageTitle eyebrow="YOUR PLAYLISTS, TOGETHER" title="Bring your playlists." description="Import a playlist and keep its songs in your library."/><div className={s.importCard}><Blossom/><h2>Your music belongs with you.</h2><p>Paste a public playlist link. Review its recordings before adding it to your library.</p><label>Playlist link<SearchField icon="link" value={url} onChange={change} label="Playlist link" placeholder="A Spotify or Deezer playlist link"/></label><Button icon="arrow" onClick={()=>void preview()} disabled={busy||!url.trim()}>{busy?"Finding your collection...":"Preview playlist"}</Button>{busy&&<Button secondary onClick={()=>actions.cancel("import")}>Cancel</Button>}{error&&<RecoveryNotice error={error} context="save" retry={()=>void(ready?confirm():preview())}/>}</div>{ready&&<><SectionTitle title={String(ready.name||"Your collection")} note="Exact catalog recordings. Audio availability is checked separately."/><TrackCollection tracks={list(ready.tracks||ready.recordings)} room="import" label="Playlist preview" firstSortLabel="Playlist order"/><Button icon="check" onClick={()=>void confirm()} disabled={busy}>Import this playlist</Button></>}</>;
}
