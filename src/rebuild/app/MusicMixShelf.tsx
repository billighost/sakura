"use client";
import { useState } from "react";
import Link from "next/link";
import { useMusic } from "./MusicContext";
import { loadResource, resourceSnapshot } from "./resources";
import { IconButton, SectionTitle } from "./Elements";
import { useScreenActions } from "./screenActions";
import { PlaylistArtwork } from "./CollectionRoom";
import { CollectionGesture } from "./CollectionGesture";
import s from "./ink.module.css";
import { type Data, list, useApi } from "./MusicScreenResources";
import m from "./music-mix-shelf.module.css";

type Mix={surfaces?:string[];situation?:string;slot?:string;id:string;name:string;description?:string;coverUrls?:string[];trackCount?:number;status?:string;playability?:string;reason?:string};

function MixCard({mix}:{mix:Mix}){const p=useMusic();const [busy,setBusy]=useState(false);const fresh=mix.slot==="latest-releases";const actions=useScreenActions(p.account?.id,mix.id);async function play(){const controller=actions.begin("play");if(!controller)return;setBusy(true);try{if(!p.account)return;const path="/api/v2/mixes/"+encodeURIComponent(mix.id);await loadResource(p.account.id,path,{signal:controller.signal,kind:"visible"});const snapshot=resourceSnapshot<Data>(p.account.id,path);if(!snapshot.data)throw snapshot.error||new Error("This mix has not been saved on this device yet.");const data=snapshot.data;if(!actions.current("play",controller))return;const tracks=list(data.recordings||data.tracks);if(!tracks.length)throw new Error("This mix is not ready yet. Choose another mix or browse the catalog.");p.play(tracks[0],tracks);}catch(e){if(actions.current("play",controller))p.reportError(e,"playback",()=>void play());}finally{if(actions.finish("play",controller))setBusy(false);}}return <CollectionGesture kind="mix" id={mix.id} title={mix.name} className={`${s.mixCard} ${fresh?m.freshMix:""}`}><Link href={"/mix/"+mix.id} className={s.mixArtwork} data-mix-slot={mix.slot}><PlaylistArtwork title={mix.name} coverUrls={mix.coverUrls}/><span className={`${s.mixStamp} ${fresh?m.freshStamp:""}`}>{fresh?"new songs, familiar voices":"sakura selects"}</span></Link><div><Link href={"/mix/"+mix.id}>{mix.name}</Link><IconButton icon="play" label={"Play "+mix.name} disabled={busy||mix.playability==="unavailable"||mix.status==="insufficient-candidates"} onClick={()=>void play()}/></div><p>{mix.description||"A different path through your music."}</p>{fresh&&typeof mix.trackCount==="number"&&<span className={m.freshCount}>{mix.trackCount} recent {mix.trackCount===1?"song":"songs"}</span>}</CollectionGesture>;}

export function MixShelf({surface="home"}:{surface?:"home"|"discover"}){const resource=useApi("/api/v2/mixes");const mixes=((resource.data?.mixes||[]) as Mix[]).filter(mix=>mix.status==="ready"&&(!mix.surfaces?.length||mix.surfaces.includes(surface))).sort((a,b)=>Number(b.slot==="latest-releases")-Number(a.slot==="latest-releases")).slice(0,6);return mixes.length?<section aria-label="Listening collections"><SectionTitle title="Music for different moments" note={mixes.some(mix=>mix.slot==="latest-releases")?"Latest releases from your artists, favorite genres, and a few new paths.":"Short sessions, favorite genres, and familiar artists."}/><div className={s.mixGrid}>{mixes.map(mix=><MixCard key={mix.id} mix={mix}/>)}</div></section>:null;}
