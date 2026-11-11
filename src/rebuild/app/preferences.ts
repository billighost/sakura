import {localRead,localWrite} from "./offline";
import type {UserSettings} from "./types";
import {AUDIO_TECHNOLOGIES} from "../audio/presets";
import {validTimeZone} from "../bloom/calendar";
import {FEED_NUMERIC_FIELDS,FEED_BOOLEAN_FIELDS} from "./feedPreferences";
import {initialTasteSignature,normalizeInitialTasteProfile} from "../recommendations/initialTaste";
export interface PreferenceSyncMetadata {serverRevision?:number;serverSettings?:Partial<UserSettings>;baseSettings?:Partial<UserSettings>;serverFieldRevisions?:Record<string,number>;baseFieldRevisions?:Record<string,number>}
export interface PreferenceDraft extends PreferenceSyncMetadata {settings:UserSettings;pending:boolean;pendingPatch?:Partial<UserSettings>;savedAt:number}
const supported=["theme","audioQuality","audioTechnology","japaneseReading","lyricReading","privateSession",...FEED_NUMERIC_FIELDS,...FEED_BOOLEAN_FIELDS,"reducedMotion","openingAnimation","bloomPerformance","seedArtists","seedGenres","seedArtistSelections","timeZone","explicitContent","onboarded","volume","shuffle","repeat","previewVolume","previewLoop","sleepTimerMinutes"] as const;
export function cachedPreferences(accountId?:string):Partial<UserSettings>{try{const id=accountId||localStorage.getItem("sakura-v2-active-account");if(!id)return {};const raw=localStorage.getItem("sakura-v2-preferences:"+id);return raw?fullSettings(JSON.parse(raw).settings):{};}catch{return {};}}
/** Read-only account metadata may be cached, but can never enter a PATCH. */
export function fullSettings(value:unknown):Partial<UserSettings>{
 const fields=settingsFields(value),raw=value&&typeof value==="object"?value as Record<string,unknown>:{},profile=normalizeInitialTasteProfile(raw.initialTasteProfile);
 return profile?.signature===initialTasteSignature(fields)?{...fields,initialTasteProfile:profile}:fields;
}
/** Local caches can outlive an app version, or contain a partial failed write. */
export function settingsFields(value:unknown):Partial<UserSettings>{
 const object=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const choices:Record<string,readonly string[]>={theme:["system","light","dark"],audioQuality:["high","balanced","data-saver"],audioTechnology:AUDIO_TECHNOLOGIES.map(mode=>mode.id),bloomPerformance:["auto","1","2","3","4","5"],repeat:["off","one","all"]};
 const booleans=["japaneseReading","lyricReading","privateSession","reducedMotion","explicitContent","onboarded","shuffle","previewLoop",...FEED_BOOLEAN_FIELDS];
 const result:Record<string,unknown>={};
 for(const key of supported){const field=object[key];if(field===undefined)continue;
  if(choices[key]){if(typeof field==="string"&&choices[key].includes(field))result[key]=field;}
  else if(booleans.includes(key)){if(typeof field==="boolean")result[key]=field;}
  else if([...FEED_NUMERIC_FIELDS,"volume","previewVolume"].includes(key)){if(typeof field==="number"&&Number.isFinite(field)&&field>=0&&field<=1)result[key]=field;}
  else if(key==="openingAnimation"||key==="sleepTimerMinutes"){if(typeof field==="number"&&Number.isInteger(field)&&field>=(key==="openingAnimation"?0:1)&&field<=(key==="openingAnimation"?4:180))result[key]=field;}
  else if(key==="timeZone"){if(validTimeZone(field))result[key]=field;}
  else if(key==="seedArtists"||key==="seedGenres"){if(Array.isArray(field)&&field.length<=(key==="seedArtists"?20:12)&&field.every(item=>typeof item==="string"&&item.trim()&&item.length<=(key==="seedArtists"?120:80)))result[key]=[...new Set(field)];}
  else if(key==="seedArtistSelections"&&Array.isArray(field)&&field.length<=20){
   const valid=field.every(item=>item&&typeof item==="object"&&typeof item.name==="string"&&item.name.trim()&&item.name.length<=120&&typeof item.selectionKey==="string"&&item.reference&&((item.reference.provider==="deezer"&&/^[1-9]\d{0,17}$/.test(item.reference.id))||(item.reference.provider==="spotify"&&/^[A-Za-z0-9]{22}$/.test(item.reference.id))));
   if(valid)result[key]=field;
  }
 }
 return result as Partial<UserSettings>;
}
export function unacknowledgedPreferences(pending:Partial<UserSettings>,sent:Partial<UserSettings>):Partial<UserSettings>{
 return Object.fromEntries(Object.entries(pending).filter(([key,value])=>!(key in sent)||JSON.stringify(value)!==JSON.stringify(sent[key as keyof UserSettings]))) as Partial<UserSettings>;
}
export function preferenceRevision(value:unknown):number|undefined {
 const object=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const nested=object.settings&&typeof object.settings==="object"?object.settings as Record<string,unknown>:undefined;
 const revision=object.revision??nested?.revision;
 return typeof revision==="number"&&Number.isSafeInteger(revision)&&revision>=0?revision:undefined;
}
export function preferenceFieldRevisions(value:unknown):Record<string,number> {
 const object=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const nested=object.settings&&typeof object.settings==="object"?object.settings as Record<string,unknown>:undefined;
 const fields=object.fieldRevisions??nested?.fieldRevisions;
 if(!fields||typeof fields!=="object"||Array.isArray(fields))return {};
 return Object.fromEntries(Object.entries(fields).filter(([key,revision])=>supported.includes(key as typeof supported[number])&&typeof revision==="number"&&Number.isSafeInteger(revision)&&revision>=0)) as Record<string,number>;
}
/** Replay only choices made against a server value that is still current.
 * Unknown older drafts cannot safely override a later choice on another device. */
export function rebasePreferences(pending:Partial<UserSettings>,base:Partial<UserSettings>|undefined,remote:Partial<UserSettings>,revisions?:{base:Record<string,number>;remote:Record<string,number>}):{pending:Partial<UserSettings>;conflicts:string[]} {
 const safe=settingsFields(pending),known=settingsFields(base),latest=settingsFields(remote);
 const retained:Record<string,unknown>={},conflicts:string[]=[];
 for(const [key,value] of Object.entries(safe)){
  const field=key as keyof UserSettings,unchanged=JSON.stringify(value)===JSON.stringify(latest[field]);
  if(unchanged)continue;
  const newerRemoteChoice=revisions&&(revisions.remote[key]||0)>(revisions.base[key]||0);
  if(!newerRemoteChoice&&Object.prototype.hasOwnProperty.call(known,key)&&JSON.stringify(known[field])===JSON.stringify(latest[field]))retained[key]=value;
  else conflicts.push(key);
 }
 // Artist display names and verified identities describe a single selection.
 // Dropping only one half could reintroduce an artist the other device removed.
 if(conflicts.some(key=>key==="seedArtists"||key==="seedArtistSelections")){
  for(const key of ["seedArtists","seedArtistSelections"]){if(key in retained){delete retained[key];if(!conflicts.includes(key))conflicts.push(key);}}
 }
 return {pending:retained as Partial<UserSettings>,conflicts};
}
function preferenceMetadata(value:unknown):PreferenceSyncMetadata {
 const object=value&&typeof value==="object"?value as PreferenceSyncMetadata:{};
 const serverRevision=preferenceRevision({revision:object.serverRevision});
 return {...(serverRevision!==undefined?{serverRevision}:{}),...(object.serverSettings?{serverSettings:settingsFields(object.serverSettings)}:{}),...(object.baseSettings?{baseSettings:settingsFields(object.baseSettings)}:{}),...(object.serverFieldRevisions?{serverFieldRevisions:preferenceFieldRevisions({fieldRevisions:object.serverFieldRevisions})}:{}),...(object.baseFieldRevisions?{baseFieldRevisions:preferenceFieldRevisions({fieldRevisions:object.baseFieldRevisions})}:{})};
}
function preferenceDraft(value:unknown):PreferenceDraft|undefined{
 if(!value||typeof value!=="object")return;const draft=value as PreferenceDraft;
 if(!draft.settings||typeof draft.settings!=="object"||!Number.isFinite(draft.savedAt)||draft.savedAt<0)return;
 return {settings:fullSettings(draft.settings) as UserSettings,pending:draft.pending===true,pendingPatch:draft.pending?settingsFields(draft.pendingPatch||draft.settings):{},savedAt:draft.savedAt,...preferenceMetadata(draft)};
}
const writes=new Map<string,Promise<void>>();
const writeStamps=new Map<string,number>();
export async function readPreferenceDraft(accountId:string):Promise<PreferenceDraft|undefined>{
 let mirror:PreferenceDraft|undefined;try{const value=localStorage.getItem("sakura-v2-preferences:"+accountId);if(value)mirror=preferenceDraft(JSON.parse(value));}catch{}
 const saved=preferenceDraft(await localRead<PreferenceDraft>(accountId,"preference-draft").catch(()=>undefined));
 return saved&&(!mirror||saved.savedAt>=mirror.savedAt)?saved:mirror;
}
export async function writePreferenceDraft(accountId:string,settings:UserSettings,pending:boolean,pendingPatch?:Partial<UserSettings>,metadata?:PreferenceSyncMetadata){
 let existing:PreferenceDraft|undefined;try{const value=localStorage.getItem("sakura-v2-preferences:"+accountId);if(value)existing=preferenceDraft(JSON.parse(value));}catch{}
 const savedAt=Math.max(Date.now(),(writeStamps.get(accountId)||0)+1,(existing?.savedAt||0)+1);writeStamps.set(accountId,savedAt);
 const draft={settings:fullSettings(settings),pending,pendingPatch:pending?settingsFields(pendingPatch||settings):{},savedAt,...preferenceMetadata(metadata||existing)};let mirrored=false;
 try{localStorage.setItem("sakura-v2-preferences:"+accountId,JSON.stringify(draft));mirrored=true;}catch{}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{await localWrite(accountId,"preference-draft",draft);await localWrite(accountId,"settings",draft.settings);});writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
