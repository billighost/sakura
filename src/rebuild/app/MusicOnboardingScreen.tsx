"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMusic } from "./MusicContext";
import { Artwork, Button, SearchField, PageTitle } from "./Elements";
import { useScreenActions } from "./screenActions";
import { groupArtistCards } from "../data/artistSelection";
import type { ProviderReference } from "../core/types";
import { Icon } from "./Icon";
import { OnboardingTastePreview } from "./OnboardingTastePreview";
import onboardingStyles from "./onboarding-taste.module.css";
import s from "./ink.module.css";
import { type Data, useApi, ResourceBody } from "./MusicScreenResources";

export function Onboarding(){const music=useMusic();return <OnboardingChoices key={music.account?.id}/>;}

function OnboardingChoices(){
 const p=useMusic();const router=useRouter();const [draft,setDraft]=useState(()=>({version:p.artistChoiceVersion,selections:p.settings.seedArtistSelections||[],legacy:p.settings.seedArtists.filter(name=>!(p.settings.seedArtistSelections||[]).some(artist=>artist.name===name))}));const {selections,legacy}=draft;const [query,setQuery]=useState("");const [artistQuery,setArtistQuery]=useState("");const [busy,setBusy]=useState(false);const actions=useScreenActions(p.account?.id);
 const dirty=useRef(false),finishRef=useRef<()=>Promise<void>>(async()=>{});
 const setSelections=(update:(previous:typeof selections)=>typeof selections)=>setDraft(old=>({...old,selections:update(old.selections)}));
 const setLegacy=(update:(previous:string[])=>string[])=>setDraft(old=>({...old,legacy:update(old.legacy)}));
 useEffect(()=>{
  if(draft.version===p.artistChoiceVersion)return;
  let active=true;queueMicrotask(()=>{if(!active)return;const hadChanges=dirty.current;dirty.current=false;
   setDraft({version:p.artistChoiceVersion,selections:p.settings.seedArtistSelections||[],legacy:p.settings.seedArtists.filter(name=>!(p.settings.seedArtistSelections||[]).some(artist=>artist.name===name))});
   if(hadChanges&&!busy)p.notify("Your current artist choices are now shown. Review them before saving.");
  });return()=>{active=false;};
 },[p,busy,draft.version]);
 function removeSelection(key:string){if(busy)return;dirty.current=true;setSelections(old=>old.filter(artist=>artist.selectionKey!==key));}
 function removeLegacy(name:string){if(busy)return;dirty.current=true;setLegacy(old=>old.filter(artist=>artist!==name));}
 useEffect(()=>{const timer=setTimeout(()=>setArtistQuery(query.trim()),350);return()=>clearTimeout(timer);},[query]);
 const resource=useApi(artistQuery?"/api/v2/search?"+new URLSearchParams({q:artistQuery,kind:"artists",searchVersion:"2"}):"/api/v2/artists?limit=32");const rows=((resource.data?.artists||[]) as Data[]).map(row=>({id:String(row.id),name:String(row.name||""),imageUrl:String(row.imageUrl||row.picture||"")||null,trackCount:Number(row.trackCount)||0,albumCount:Number(row.albumCount)||0,reference:row.reference as ProviderReference|undefined,provider:row.provider as string|undefined,externalId:row.externalId as string|undefined}));const artists=groupArtistCards(rows);
 function pick(a:typeof artists[number]){if(busy)return;const selected=selections.some(s=>s.selectionKey===a.selectionKey)||legacy.includes(a.name);if(selected){dirty.current=true;setSelections(old=>old.filter(s=>s.selectionKey!==a.selectionKey));setLegacy(old=>old.filter(name=>name!==a.name));return;}if(selections.length+legacy.length>=20){p.notify("You can choose up to twenty artists. Remove one to add another.");return;}dirty.current=true;if(a.reference)setSelections(old=>[...old,{name:a.name,reference:a.reference!,selectionKey:a.selectionKey}]);else setLegacy(old=>[...old,a.name]);}
 async function finish(){const controller=actions.begin("finish");if(!controller)return;setBusy(true);try{await p.updateSettings({seedArtists:[...new Set([...legacy,...selections.map(a=>a.name)])],seedArtistSelections:selections,onboarded:true},{artistChoiceVersion:draft.version});if(actions.current("finish",controller))router.replace("/home");}catch(e){if(actions.current("finish",controller))p.reportError(e,"save",()=>void finishRef.current());}finally{if(actions.finish("finish",controller))setBusy(false);}}
 useLayoutEffect(()=>{finishRef.current=finish;});
 return <><PageTitle eyebrow="YOUR FAVORITE ARTISTS" title="Start with your favorite artists." description="Choose artists you enjoy to help shape your first recommendations. These choices can be changed later."/><SearchField value={query} onChange={value=>{setQuery(value);if(!value)setArtistQuery("");}} label="Find favorite artists" placeholder="Find a favorite artist"/>{selections.length+legacy.length>0&&<div className={s.chips+" "+onboardingStyles.chosenArtists} aria-label="Your chosen artists">{selections.map(a=><button key={a.selectionKey} aria-label={"Remove "+a.name} disabled={busy} onClick={()=>removeSelection(a.selectionKey)}>{a.name} ×</button>)}{legacy.map(name=><button key={name} aria-label={"Remove "+name} disabled={busy} onClick={()=>removeLegacy(name)}>{name} ×</button>)}</div>}<OnboardingTastePreview seedArtists={[...new Set([...legacy,...selections.map(artist=>artist.name)])]} seedArtistSelections={selections}/><ResourceBody resource={resource}><div className={s.entityGrid+" "+onboardingStyles.artistChoices}>{artists.slice(0,24).map(a=>{const selected=selections.some(s=>s.selectionKey===a.selectionKey)||legacy.includes(a.name);return <button className={s.artistPick} key={a.selectionKey} disabled={busy} aria-label={a.name} aria-pressed={selected} onClick={()=>pick(a)}><Artwork url={a.imageUrl} title={a.name}/><h3>{a.name}</h3>{selected&&<Icon name="check"/>}</button>;})}</div></ResourceBody><div className={s.onboardingFooter+" "+onboardingStyles.saveFooter}><span>{selections.length+legacy.length} {selections.length+legacy.length===1?"artist":"artists"} selected.</span><Button icon="arrow" onClick={()=>void finish()} disabled={busy}>{busy?"Saving your choices…":selections.length+legacy.length?"Save and continue":"Continue without artists"}</Button></div></>;
}
