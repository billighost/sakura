import { productResponse,jsonBody } from "@/rebuild/data/http";
import { getSettings,patchSettings } from "@/rebuild/data/settings";
import { after } from "next/server";
import { warmCandidateCatalog } from "@/rebuild/recommendations/catalog";
import { ensureMixes } from "@/rebuild/recommendations/service";
export const maxDuration=120;
export async function GET(request:Request){return productResponse(request,a=>getSettings(a.id));}
export async function PATCH(request:Request){return productResponse(request,async a=>{
  const body=await jsonBody(request),settings=await patchSettings(a.id,body);
  if(body.seedArtists!==undefined||body.seedGenres!==undefined||body.onboarded===true)after(async()=>{
    try{await warmCandidateCatalog(a.id);await ensureMixes(a.id,true);}catch{console.error("[Sakura v2] Personalized catalog refresh failed");}
  });
  return settings;
});}
