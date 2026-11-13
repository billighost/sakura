import {localRead,localWrite,localDelete,localEntries,offlineDatabase} from "./offline";
import type {UserSettings} from "./types";
import {AUDIO_TECHNOLOGIES} from "../audio/presets";
import {validTimeZone} from "../bloom/calendar";
import {FEED_NUMERIC_FIELDS,FEED_BOOLEAN_FIELDS} from "./feedPreferences";
import {initialTasteSignature,normalizeInitialTasteProfile} from "../recommendations/initialTaste";
export interface PreferenceIntent {operationId:string;field:keyof UserSettings;value:unknown;createdAt:number;baseValue?:unknown;baseRevision?:number}
export interface PreferenceSyncMetadata {serverRevision?:number;serverSettings?:Partial<UserSettings>;baseSettings?:Partial<UserSettings>;serverFieldRevisions?:Record<string,number>;baseFieldRevisions?:Record<string,number>;pendingOperations?:Record<string,PreferenceIntent>}
export interface PreferenceDraft extends PreferenceSyncMetadata {settings:UserSettings;pending:boolean;pendingPatch?:Partial<UserSettings>;savedAt:number}
const supported=["theme","audioQuality","audioTechnology","japaneseReading","lyricReading","privateSession",...FEED_NUMERIC_FIELDS,...FEED_BOOLEAN_FIELDS,"reducedMotion","openingAnimation","bloomPerformance","seedArtists","seedGenres","seedArtistSelections","timeZone","explicitContent","onboarded","volume","shuffle","repeat","previewVolume","previewLoop","sleepTimerMinutes"] as const;
export function cachedPreferences(accountId?:string):Partial<UserSettings>{try{const id=accountId||localStorage.getItem("sakura-v2-active-account");if(!id)return {};const raw=localStorage.getItem("sakura-v2-preferences:"+id),draft=raw?preferenceDraft(JSON.parse(raw)):undefined;const records=new Map<string,PreferenceIntent>(),acks:PreferenceIntent[]=[],servers:PreferenceServerRecord[]=[];for(const intent of Object.values(draft?.pendingOperations||{}))records.set(intent.operationId,intent);collectMirror(id,records,acks,servers);const server=latestServer(servers,draft);return fullSettings({...draft?.settings,...server?.serverSettings,...intentPatch(activeIntents(records,acks))});}catch{return {};}}
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
 return {...(serverRevision!==undefined?{serverRevision}:{}),...(object.serverSettings?{serverSettings:settingsFields(object.serverSettings)}:{}),...(object.baseSettings?{baseSettings:settingsFields(object.baseSettings)}:{}),...(object.serverFieldRevisions?{serverFieldRevisions:preferenceFieldRevisions({fieldRevisions:object.serverFieldRevisions})}:{}),...(object.baseFieldRevisions?{baseFieldRevisions:preferenceFieldRevisions({fieldRevisions:object.baseFieldRevisions})}:{}),...(object.pendingOperations?{pendingOperations:cleanIntents(object.pendingOperations)}:{})};
}
function preferenceDraft(value:unknown):PreferenceDraft|undefined{
 if(!value||typeof value!=="object")return;const draft=value as PreferenceDraft;
 if(!draft.settings||typeof draft.settings!=="object"||!Number.isFinite(draft.savedAt)||draft.savedAt<0)return;
 const metadata=preferenceMetadata(draft),pendingPatch=draft.pending?settingsFields(draft.pendingPatch||draft.settings):{};
 const pendingOperations=metadata.pendingOperations||Object.fromEntries(Object.entries(pendingPatch).map(([field,value])=>[field,legacyIntent(field as keyof UserSettings,value,draft.savedAt,metadata)]));
 return {settings:fullSettings(draft.settings) as UserSettings,pending:draft.pending===true,pendingPatch,savedAt:draft.savedAt,...metadata,pendingOperations};
}
const writes=new Map<string,Promise<void>>();
const writeStamps=new Map<string,number>();
const ownIntents=new Map<string,Record<string,PreferenceIntent>>();
const clocks=new Map<string,number>();
const intentPrefix=(accountId:string)=>"sakura-v2-preference-intent:"+accountId+":";
const ackPrefix=(accountId:string)=>"sakura-v2-preference-ack:"+accountId+":";
const serverPrefix=(accountId:string)=>"sakura-v2-preference-server:"+accountId+":";
const intentVersion=(intent:PreferenceIntent)=>intent.operationId+":"+(intent.baseRevision??"initial");
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
interface PreferenceServerRecord {serverRevision:number;serverSettings:Partial<UserSettings>;serverFieldRevisions?:Record<string,number>;savedAt:number}
function serverRecord(value:unknown):PreferenceServerRecord|undefined{
 if(!value||typeof value!=="object")return;const raw=value as PreferenceServerRecord,metadata=preferenceMetadata(raw);if(metadata.serverRevision===undefined||!metadata.serverSettings||!Object.keys(metadata.serverSettings).length||!Number.isFinite(raw.savedAt))return;
 return {serverRevision:metadata.serverRevision,serverSettings:copy(metadata.serverSettings),serverFieldRevisions:metadata.serverFieldRevisions,savedAt:raw.savedAt};
}
function latestServer(records:PreferenceServerRecord[],draft?:PreferenceDraft){const source=serverRecord(draft);return [...records,...(source?[source]:[])].sort((a,b)=>b.serverRevision-a.serverRevision||b.savedAt-a.savedAt)[0];}
function validIntent(value:unknown):PreferenceIntent|undefined{
 if(!value||typeof value!=="object")return;const intent=value as PreferenceIntent;
 if(typeof intent.operationId!=="string"||!intent.operationId||intent.operationId.length>180||!supported.includes(intent.field as typeof supported[number])||!Number.isSafeInteger(intent.createdAt)||intent.createdAt<0)return;
 const field=intent.field,clean=settingsFields({[field]:intent.value});if(!(field in clean))return;
 const base=settingsFields({[field]:intent.baseValue}),baseRevision=preferenceRevision({revision:intent.baseRevision});
 return {operationId:intent.operationId,field,value:copy(clean[field]),createdAt:intent.createdAt,...(field in base?{baseValue:copy(base[field])}:{}),...(baseRevision!==undefined?{baseRevision}:{})};
}
function cleanIntents(value:unknown):Record<string,PreferenceIntent>{
 if(!value||typeof value!=="object"||Array.isArray(value))return {};const result:Record<string,PreferenceIntent>={};
 for(const [field,raw]of Object.entries(value)){const intent=validIntent(raw);if(intent?.field===field)result[field]=intent;}return result;
}
function compareIntents(a:PreferenceIntent,b:PreferenceIntent){return a.createdAt===b.createdAt?a.operationId.localeCompare(b.operationId):a.createdAt-b.createdAt;}
export function mergePreferenceIntents(...sources:Array<Record<string,PreferenceIntent>|undefined>):Record<string,PreferenceIntent>{
 const result:Record<string,PreferenceIntent>={};for(const source of sources)for(const [field,intent]of Object.entries(cleanIntents(source))){const old=result[field];if(!old||compareIntents(intent,old)>0||intent.operationId===old.operationId&&(intent.baseRevision??-1)>(old.baseRevision??-1))result[field]=intent;}return result;
}
function intentPatch(intents:Record<string,PreferenceIntent>):Partial<UserSettings>{return settingsFields(Object.fromEntries(Object.values(intents).map(intent=>[intent.field,intent.value])));}
function legacyIntent(field:keyof UserSettings,value:unknown,savedAt:number,metadata:PreferenceSyncMetadata):PreferenceIntent{
 let hash=2166136261;for(const char of JSON.stringify(value)){hash=Math.imul(hash^char.charCodeAt(0),16777619);}
 const base=settingsFields(metadata.baseSettings),revision=metadata.baseFieldRevisions?.[field];
 return {field,value:copy(value),createdAt:Math.floor(savedAt),operationId:`legacy:${field}:${savedAt}:${hash>>>0}`,...(field in base?{baseValue:copy(base[field])}:{}),...(revision!==undefined?{baseRevision:revision}:{})};
}
/** Create IDs only for deliberate edits. The shared logical clock keeps later
 * edits later even when wall time repeats or moves backwards. */
export function createPreferenceIntents(accountId:string,patch:Partial<UserSettings>,metadata:PreferenceSyncMetadata={}):Record<string,PreferenceIntent>{
 let shared=0;try{shared=Number(localStorage.getItem("sakura-v2-preference-clock:"+accountId))||0;}catch{}
 const createdAt=Math.max(Date.now(),(clocks.get(accountId)||0)+1,Number.isSafeInteger(shared)&&shared>=0?shared+1:0,...Object.values(cleanIntents(metadata.pendingOperations)).map(intent=>intent.createdAt+1));clocks.set(accountId,createdAt);
 try{localStorage.setItem("sakura-v2-preference-clock:"+accountId,String(createdAt));}catch{}
 const base=settingsFields(metadata.baseSettings),server=settingsFields(metadata.serverSettings),result:Record<string,PreferenceIntent>={};
 for(const [key,value]of Object.entries(settingsFields(patch))){const field=key as keyof UserSettings,baseValue=field in base?base[field]:server[field],baseRevision=metadata.baseFieldRevisions?.[field]??metadata.serverFieldRevisions?.[field];result[key]={field,value:copy(value),createdAt,operationId:globalThis.crypto?.randomUUID?.()||`${createdAt}:${Math.random().toString(36).slice(2)}:${field}`,...(baseValue!==undefined?{baseValue:copy(baseValue)}:{}),...(baseRevision!==undefined?{baseRevision}:{})};}return result;
}
function collectIntent(records:Map<string,PreferenceIntent>,value:unknown){const intent=validIntent(value);if(!intent)return;const old=records.get(intent.operationId);if(!old||JSON.stringify(old.value)===JSON.stringify(intent.value)&&(intent.baseRevision??-1)>(old.baseRevision??-1))records.set(intent.operationId,intent);}
function preserveBaseline(intent:PreferenceIntent,stored:unknown){const previous=validIntent(stored);return previous?.operationId===intent.operationId&&previous.field===intent.field&&JSON.stringify(previous.value)===JSON.stringify(intent.value)&&(previous.baseRevision??-1)>(intent.baseRevision??-1)?previous:intent;}
function collectMirror(accountId:string,records:Map<string,PreferenceIntent>,acks:PreferenceIntent[],servers:PreferenceServerRecord[]=[]){
 try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||!key.startsWith(intentPrefix(accountId))&&!key.startsWith(ackPrefix(accountId))&&!key.startsWith(serverPrefix(accountId)))continue;let value:unknown;try{value=JSON.parse(localStorage.getItem(key)||"null");}catch{continue;}if(key.startsWith(ackPrefix(accountId))){const ack=validIntent(value);if(ack)acks.push(ack);}else if(key.startsWith(serverPrefix(accountId))){const server=serverRecord(value);if(server)servers.push(server);}else collectIntent(records,value);}}catch{}
}
function activeIntents(records:Map<string,PreferenceIntent>,acks:PreferenceIntent[]){return mergePreferenceIntents(...[...records.values()].filter(intent=>!acks.some(ack=>ack.field===intent.field&&compareIntents(intent,ack)<=0)).map(intent=>({[intent.field]:intent})));}
const sameDraft=(left:PreferenceDraft|undefined,right:PreferenceDraft)=>{if(!left)return false;const {savedAt:_,...a}=left,{savedAt:__,...b}=right;void _;void __;return JSON.stringify(a)===JSON.stringify(b);};
async function writeCheckpoint(accountId:string,name:string,value:PreferenceIntent|PreferenceServerRecord,kind:"ack"|"server"){
 const compare=(left:unknown,right:typeof value)=>kind==="ack"?compareIntents(validIntent(left)!,right as PreferenceIntent):(serverRecord(left)!.serverRevision-(right as PreferenceServerRecord).serverRevision);
 const valid=(value:unknown)=>kind==="ack"?validIntent(value):serverRecord(value),mirrorName=(kind==="ack"?ackPrefix(accountId):serverPrefix(accountId))+name;
 let mirrored=false,durable=false;
 try{const old=valid(JSON.parse(localStorage.getItem(mirrorName)||"null"));if(!old||compare(old,value)<0)localStorage.setItem(mirrorName,JSON.stringify(value));mirrored=true;}catch{}
 try{const database=await offlineDatabase(),tx=database.transaction("entries","readwrite"),done=tx.done;void done.catch(()=>{});const key="account:"+accountId+":preference-"+kind+":"+name,old=valid(await tx.store.get(key));if(!old||compare(old,value)<0)await tx.store.put(value,key);await done;durable=true;}catch(error){if(!mirrored)throw error;}
 return {mirrored,durable};
}
const compactions=new Map<string,Promise<void>>();
/** The small reserved-order ledger is point-read, never scanned or expired:
 * an old writer must not assign a fresh order to a retired operation ID. */
async function compactPreferenceHistory(accountId:string,acks:PreferenceIntent[],servers:PreferenceServerRecord[],entries:Array<{name:string;value:unknown}>,orders:Map<string,number>){
 if(compactions.has(accountId))return;
 const operation=(async()=>{
  const latest=new Map<string,PreferenceIntent>();for(const ack of acks){const old=latest.get(ack.field);if(!old||compareIntents(old,ack)<0)latest.set(ack.field,ack);}
  for(const ack of latest.values()){
   const name="field:"+ack.field,paths=await writeCheckpoint(accountId,name,ack,"ack");
   if(paths.durable)for(const entry of entries){const old=entry.name.startsWith("preference-ack:")||entry.name.startsWith("preference-intent:")?validIntent(entry.value):undefined;if(old&&orders.has(old.operationId))old.createdAt=orders.get(old.operationId)!;if(old?.field===ack.field&&compareIntents(old,ack)<=0&&entry.name!=="preference-ack:"+name)await localDelete(accountId,entry.name);}
   if(paths.mirrored){const names:string[]=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&(key.startsWith(ackPrefix(accountId))||key.startsWith(intentPrefix(accountId)))&&key!==ackPrefix(accountId)+name){const old=validIntent(JSON.parse(localStorage.getItem(key)||"null"));if(old&&orders.has(old.operationId))old.createdAt=orders.get(old.operationId)!;if(old?.field===ack.field&&compareIntents(old,ack)<=0)names.push(key);}}for(const key of names)localStorage.removeItem(key);}catch{}}
  }
  const server=latestServer(servers);if(server){const paths=await writeCheckpoint(accountId,"current",server,"server");
   if(paths.durable)for(const entry of entries){const old=entry.name.startsWith("preference-server:")?serverRecord(entry.value):undefined;if(old&&old.serverRevision<=server.serverRevision&&entry.name!=="preference-server:current")await localDelete(accountId,entry.name);}
   if(paths.mirrored){const names:string[]=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(serverPrefix(accountId))&&key!==serverPrefix(accountId)+"current"){const old=serverRecord(JSON.parse(localStorage.getItem(key)||"null"));if(old&&old.serverRevision<=server.serverRevision)names.push(key);}}for(const key of names)localStorage.removeItem(key);}catch{}}
  }
 })();compactions.set(accountId,operation);try{await operation;}finally{if(compactions.get(accountId)===operation)compactions.delete(accountId);}
}
async function reserveIntentOrder(accountId:string,intents:Record<string,PreferenceIntent>){
 if(!Object.keys(intents).length)return;const database=await offlineDatabase(),tx=database.transaction("entries","readwrite"),done=tx.done,prefix="account:"+accountId+":",clockKey=prefix+"preference-clock";
 // A rejected request also rejects transaction completion. Observe both
 // promises immediately so the mirror fallback does not leave an unhandled
 // transaction error when a request fails before the final await.
 void done.catch(()=>{});
 let clock=Number(await tx.store.get(clockKey))||0;
 for(const intent of Object.values(intents)){
  const orderKey=prefix+"preference-order:"+intent.operationId,stored=await tx.store.get(orderKey) as {createdAt?:number}|undefined;
  const createdAt=Number.isSafeInteger(stored?.createdAt)&&stored!.createdAt!>=0?stored!.createdAt!:Math.max(clock+1,intent.createdAt);clock=Math.max(clock,createdAt);intent.createdAt=createdAt;
  await tx.store.put({operationId:intent.operationId,createdAt},orderKey);await tx.store.put(intent,prefix+"preference-intent:"+intentVersion(intent));
 }
 await tx.store.put(clock,clockKey);await done;clocks.set(accountId,Math.max(clocks.get(accountId)||0,clock));
}
export async function readPreferenceDraft(accountId:string):Promise<PreferenceDraft|undefined>{
 let mirror:PreferenceDraft|undefined;try{const value=localStorage.getItem("sakura-v2-preferences:"+accountId);if(value)mirror=preferenceDraft(JSON.parse(value));}catch{}
 const saved=preferenceDraft(await localRead<PreferenceDraft>(accountId,"preference-draft").catch(()=>undefined));
 const draft=saved&&(!mirror||saved.savedAt>=mirror.savedAt)?saved:mirror,records=new Map<string,PreferenceIntent>(),acks:PreferenceIntent[]=[],servers:PreferenceServerRecord[]=[];
 for(const source of [mirror,saved])for(const intent of Object.values(source?.pendingOperations||{}))collectIntent(records,intent);
 const entries=(await Promise.all(["preference-ack:","preference-intent:","preference-server:"].map(prefix=>localEntries<unknown>(accountId,prefix).catch(()=>[])))).flat();for(const entry of entries){if(entry.name.startsWith("preference-ack:")){const ack=validIntent(entry.value);if(ack)acks.push(ack);}else if(entry.name.startsWith("preference-intent:"))collectIntent(records,entry.value);else if(entry.name.startsWith("preference-server:")){const server=serverRecord(entry.value);if(server)servers.push(server);}}collectMirror(accountId,records,acks,servers);
 const orders=new Map<string,number>();await Promise.all([...new Set([...records.keys(),...acks.map(ack=>ack.operationId)])].map(async id=>{const order=await localRead<{createdAt?:number}>(accountId,"preference-order:"+id).catch(()=>undefined);if(Number.isSafeInteger(order?.createdAt)&&order!.createdAt!>=0)orders.set(id,order!.createdAt!);}));for(const intent of [...records.values(),...acks]){const order=orders.get(intent.operationId);if(order!==undefined)intent.createdAt=order;}const server=latestServer(servers,draft);
 void compactPreferenceHistory(accountId,acks,servers,entries,orders).catch(()=>{});
 const pendingOperations=activeIntents(records,acks),pendingPatch=intentPatch(pendingOperations);if(!draft&&!server&&!Object.keys(pendingPatch).length)return;
 const savedAt=Math.max(draft?.savedAt||0,server?.savedAt||0,...[...records.values()].map(intent=>intent.createdAt));clocks.set(accountId,Math.max(clocks.get(accountId)||0,savedAt));
 return {...draft,...server,settings:fullSettings({...draft?.settings,...server?.serverSettings,...pendingPatch}) as UserSettings,savedAt,pending:Object.keys(pendingPatch).length>0,pendingPatch,pendingOperations,baseSettings:settingsFields(Object.fromEntries(Object.values(pendingOperations).filter(intent=>intent.baseValue!==undefined).map(intent=>[intent.field,intent.baseValue]))),baseFieldRevisions:Object.fromEntries(Object.values(pendingOperations).filter(intent=>intent.baseRevision!==undefined).map(intent=>[intent.field,intent.baseRevision!]))};
}
export async function writePreferenceDraft(accountId:string,settings:UserSettings,pending:boolean,pendingPatch?:Partial<UserSettings>,metadata?:PreferenceSyncMetadata){
 let existing:PreferenceDraft|undefined;try{const value=localStorage.getItem("sakura-v2-preferences:"+accountId);if(value)existing=preferenceDraft(JSON.parse(value));}catch{}
 const savedAt=Math.max(Date.now(),(writeStamps.get(accountId)||0)+1,(existing?.savedAt||0)+1);writeStamps.set(accountId,savedAt);
 const clean=pending?settingsFields(pendingPatch||settings):{},meta=preferenceMetadata(metadata||existing),supplied=cleanIntents(metadata?.pendingOperations),own=ownIntents.get(accountId)||{},pendingOperations:Record<string,PreferenceIntent>={};
 for(const [field,value]of Object.entries(clean)){const match=[supplied[field],own[field]].find(intent=>intent&&JSON.stringify(intent.value)===JSON.stringify(value));let intent=match||createPreferenceIntents(accountId,{[field]:value},meta)[field];intent=preserveBaseline(intent,existing?.pendingOperations?.[field]);pendingOperations[field]=intent;}ownIntents.set(accountId,{...own,...pendingOperations});
 const newerServer=existing&&(existing.serverRevision??-1)>(meta.serverRevision??-1)?existing:undefined;
 const draft={...(newerServer?preferenceMetadata(newerServer):meta),settings:copy(fullSettings({...newerServer?.settings,...settings,...(newerServer?.serverSettings||{}),...intentPatch(pendingOperations)})),pending,pendingPatch:clean,pendingOperations,savedAt};let mirrored=false;
 if(!pending&&sameDraft(existing,draft as PreferenceDraft))return;
 const server=serverRecord({...meta,savedAt});
 try{localStorage.setItem("sakura-v2-preferences:"+accountId,JSON.stringify(draft));mirrored=true;}catch{}
 // Baseline rebases get separate immutable keys: a sleeping tab can persist
 // its older version afterward without replacing a higher acknowledged base.
 let journalMirrored=true;for(const intent of Object.values(pendingOperations))try{localStorage.setItem(intentPrefix(accountId)+intentVersion(intent),JSON.stringify(intent));}catch{journalMirrored=false;}
 if(server)try{const old=serverRecord(JSON.parse(localStorage.getItem(serverPrefix(accountId)+"current")||"null"));if(!old||old.serverRevision<server.serverRevision)localStorage.setItem(serverPrefix(accountId)+"current",JSON.stringify(server));}catch{journalMirrored=false;}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{const disk=preferenceDraft(await localRead(accountId,"preference-draft").catch(()=>undefined));if(!pending&&sameDraft(disk,draft as PreferenceDraft))return;await reserveIntentOrder(accountId,pendingOperations);for(const [field,intent]of Object.entries(pendingOperations)){if(metadata?.pendingOperations?.[field]?.operationId===intent.operationId)metadata.pendingOperations[field].createdAt=intent.createdAt;try{localStorage.setItem(intentPrefix(accountId)+intentVersion(intent),JSON.stringify(intent));}catch{}await localWrite(accountId,"preference-intent:"+intentVersion(intent),intent);}if(server)await writeCheckpoint(accountId,"current",server,"server");await localWrite(accountId,"preference-draft",draft);await localWrite(accountId,"settings",draft.settings);});writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored||!journalMirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
/** A valid response retires only the sent field generations, never a newer
 * edit captured while that request was in flight or a different tab's field. */
export async function acknowledgePreferenceIntents(accountId:string,sent:Record<string,PreferenceIntent>){
 const intents=Object.values(cleanIntents(sent));let mirrored=true;for(const intent of intents)try{const key=ackPrefix(accountId)+"field:"+intent.field,old=validIntent(JSON.parse(localStorage.getItem(key)||"null"));if(!old||compareIntents(old,intent)<0)localStorage.setItem(key,JSON.stringify(intent));localStorage.removeItem(intentPrefix(accountId)+intentVersion(intent));}catch{mirrored=false;}
 const write=(writes.get(accountId)||Promise.resolve()).catch(()=>{}).then(async()=>{for(const intent of intents){await writeCheckpoint(accountId,"field:"+intent.field,intent,"ack");await localDelete(accountId,"preference-intent:"+intentVersion(intent));}});writes.set(accountId,write);
 try{await write;}catch(error){if(!mirrored)throw error;}finally{if(writes.get(accountId)===write)writes.delete(accountId);}
}
