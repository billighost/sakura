"use client";
import Link from "next/link";
import type {MusicTrack} from "./types";
import {artistCreditHref} from "./artistNavigation";
export function ArtistLinks({track,className}:{track:MusicTrack;className?:string}){
 const credits:NonNullable<MusicTrack["artistCredits"]>=track.artistCredits?.length?track.artistCredits:track.artists.map((name,index)=>({name,artistId:index===0?track.artistId:null,role:index===0?"primary" as const:"featured" as const}));
 return <span className={className} data-artist-credits>{credits.map((credit,index)=>{
  const href=artistCreditHref(credit);
  return <span key={(credit.artistId||credit.reference?.id||credit.name)+":"+index}>{index>0&&<span aria-hidden="true">{credit.role==="featured"?" · feat. ":" & "}</span>}<Link href={href}>{credit.name}</Link></span>;
 })}</span>;
}
