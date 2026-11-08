import assert from "node:assert/strict";
import {test} from "node:test";
import {randomUUID} from "node:crypto";
import {rebasePreferences,preferenceRevision,preferenceFieldRevisions,readPreferenceDraft,writePreferenceDraft} from "../src/rebuild/app/preferences";
import {DEFAULT_SETTINGS} from "../src/rebuild/data/validation";
import type {UserSettings} from "../src/rebuild/app/types";
import {readJsonResponse,UserFacingError} from "../src/rebuild/app/errors";

test("reconnecting keeps independent offline choices and uses newer remote privacy choices",()=>{
 const pending={privateSession:false,learnFromListening:true,theme:"dark" as const,artistVariety:.8};
 const base={privateSession:false,learnFromListening:true,theme:"light" as const,artistVariety:.65};
 const remote={...base,privateSession:true,learnFromListening:false};
 const result=rebasePreferences(pending,base,remote);
 assert.deepEqual(result.pending,{theme:"dark",artistVariety:.8});
 assert.deepEqual(result.conflicts,["privateSession","learnFromListening"]);
});

test("a draft without a recorded server base cannot overwrite another device's settings",()=>{
 assert.deepEqual(rebasePreferences({privateSession:false,theme:"dark"},undefined,{privateSession:true,theme:"light"}),{pending:{},conflicts:["theme","privateSession"]});
 assert.deepEqual(rebasePreferences({theme:"dark"},undefined,{theme:"dark"}),{pending:{},conflicts:[]});
});

test("a newer same-field choice wins even when another device returned to the old value",()=>{
 const result=rebasePreferences({privateSession:true,theme:"dark"},{privateSession:false,theme:"light"},{privateSession:false,theme:"light"},{base:{privateSession:2,theme:1},remote:{privateSession:5,theme:1}});
 assert.deepEqual(result.pending,{theme:"dark"});assert.deepEqual(result.conflicts,["privateSession"]);
 assert.deepEqual(preferenceFieldRevisions({fieldRevisions:{theme:3,privateSession:-1,volume:"5",password:8}}),{theme:3});
 assert.deepEqual(preferenceFieldRevisions({settings:{fieldRevisions:{volume:0}}}),{volume:0});
});

test("reconciliation removes already accepted fields while retaining changes made against unchanged bases",()=>{
 assert.deepEqual(rebasePreferences({volume:.2,repeat:"all"},{volume:.8,repeat:"off"},{volume:.2,repeat:"off"}),{pending:{repeat:"all"},conflicts:[]});
 assert.deepEqual(rebasePreferences({volume:.3},{volume:.2},{volume:.2}),{pending:{volume:.3},conflicts:[]},"A newer local edit can be based on the acknowledged earlier value");
});

test("conflicting artist names and verified artist selections are reconciled together",()=>{
 const selection={name:"Artist",reference:{provider:"deezer" as const,id:"123"},selectionKey:"artist:deezer:123"};
 const result=rebasePreferences({seedArtists:["Artist"],seedArtistSelections:[selection]},{seedArtists:[],seedArtistSelections:[]},{seedArtists:["Another artist"],seedArtistSelections:[]});
 assert.deepEqual(result.pending,{});
 assert.deepEqual(result.conflicts,["seedArtists","seedArtistSelections"]);
});

test("preference revision accepts only safe server revisions",()=>{
 assert.equal(preferenceRevision({revision:0}),0);assert.equal(preferenceRevision({settings:{revision:12}}),12);
 for(const revision of [-1,1.2,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,"12",null])assert.equal(preferenceRevision({revision}),undefined);
});

test("preference conflicts retain HTTP status for safe refresh without being retried as audio failures",async()=>{
 await assert.rejects(readJsonResponse(Response.json({error:"Settings changed"},{status:409}),{context:"save"}),error=>error instanceof UserFacingError&&error.status===409);
});

test("mirrored preference drafts preserve their bases and order writes even within one millisecond",async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),values=new Map<string,string>();
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,"localStorage",original);else Reflect.deleteProperty(globalThis,"localStorage");});
 t.mock.method(Date,"now",()=>2000);
 const account=randomUUID(),settings={...DEFAULT_SETTINGS,seedArtists:[],seedGenres:[],seedArtistSelections:[],onboarded:true} as UserSettings;
 await writePreferenceDraft(account,{...settings,volume:.2},true,{volume:.2},{serverRevision:9,serverSettings:{volume:.8,privateSession:false},baseSettings:{volume:.8},serverFieldRevisions:{volume:4},baseFieldRevisions:{volume:4}});
 const first=await readPreferenceDraft(account);assert.equal(first?.serverRevision,9);assert.deepEqual(first?.baseSettings,{volume:.8});assert.deepEqual(first?.baseFieldRevisions,{volume:4});
 await writePreferenceDraft(account,{...settings,volume:.3},true,{volume:.3});
 const second=await readPreferenceDraft(account);assert.ok(second!.savedAt>first!.savedAt);assert.equal(second?.serverRevision,9);assert.deepEqual(second?.pendingPatch,{volume:.3});
 values.set("sakura-v2-preferences:"+account,JSON.stringify({...second,serverRevision:-3,baseSettings:{volume:4,privateSession:"false"},serverSettings:{volume:.8,token:"not a setting"}}));
 const clean=await readPreferenceDraft(account);assert.equal(clean?.serverRevision,undefined);assert.deepEqual(clean?.baseSettings,{});assert.deepEqual(clean?.serverSettings,{volume:.8});
});
