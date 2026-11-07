import {localRead,localWrite} from "./offline";
import type {UserSettings} from "./types";
export interface PreferenceDraft {settings:UserSettings;pending:boolean;pendingPatch?:Partial<UserSettings>;savedAt:number}
const supported=["theme","audioQuality","privateSession","discovery","reducedMotion","openingAnimation","seedArtists","seedGenres","seedArtistSelections","timeZone","explicitContent","onboarded"] as const;
export function settingsFields(value:unknown):Partial<UserSettings>{const object=value&&typeof value==="object"?value as Record<string,unknown>:{};return Object.fromEntries(supported.filter(key=>object[key]!==undefined).map(key=>[key,object[key]])) as Partial<UserSettings>;}
const writes=new Map<string,Promise<void>>();
export async function readPreferenceDraft(accountId:string):Promise<PreferenceDraft|undefined>{
 let mirror:PreferenceDraft|undefined;try{const value=localStorage.getItem("sakura-v2-preferences:"+accountId);if(value)mirror=JSON.parse(value);}catch{}
 const saved=await localRead<PreferenceDraft>(accountId,"preference-draft").catch(()=>undefined);
 return saved&&(!mirror||saved.savedAt>=mirror.savedAt)?saved:mirror;
}
export async function writePreferenceDraft(accountId:string,settings:UserSettings,pending:boolean,pendingPatch?:Partial<UserSettings>){
 const draft={settings:settingsFields(settings),pending,pendingPatch:pending?settingsFields(pendingPatch||settings):{},savedAt:Date.now()};let mirrored=false;
 try{localStorage.setItem("sakura-v2-preferences:"+accountId,JSON.stringify(draft));mirrored=true;}catch{}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{await localWrite(accountId,"preference-draft",draft);await localWrite(accountId,"settings",draft.settings);});writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
