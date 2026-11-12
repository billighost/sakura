import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {settingsFields} from "../src/rebuild/app/preferences";
import {preferencesPatch} from "../src/rebuild/data/validation";
import vm from "node:vm";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import {renderToStaticMarkup} from "react-dom/server";

test("shuffle and repeat remain valid local and account-synced preferences",()=>{
 assert.deepEqual(settingsFields({shuffle:true,repeat:"one"}),{shuffle:true,repeat:"one"});
 assert.deepEqual(preferencesPatch({shuffle:true,repeat:"all"}),{repeat:"all",shuffle:true});
});

test("player toggles expose pressed state and the repeat-one mark",()=>{
 const source=readFileSync(new URL("../src/rebuild/app/Elements.tsx",import.meta.url),"utf8");
 const fullPlayer=readFileSync(new URL("../src/rebuild/player/FullPlayer.tsx",import.meta.url),"utf8");
 assert.match(source,/aria-pressed=\{active\}/);
 assert.match(source,/aria-pressed=\{liked\.has\(id\)\}/);
 assert.match(source,/className=\{s\.repeatControl\}/);
 assert.match(source,/p\.repeat==="one"&&<b aria-hidden="true">1<\/b>/);
 assert.match(fullPlayer,/const trackId = track \? music\.effectiveId\(track\) : undefined;/);
 assert.match(fullPlayer,/active=\{liked\}/);
});

test("memoized collection rows render liked pressed state against the canonical recording identity",()=>{
 const song={id:"provider-row",title:"Fixture song",artists:["Fixture artist"],coverUrl:null,albumTitle:null,durationMs:120000,versionLabel:"Original recording"};
 const state={track:null,status:"idle",queue:[],downloads:{},liked:new Set(["canonical-recording"]),effectiveId:()=>"canonical-recording"};
 const exports={},context=vm.createContext({module:{exports},exports,require(name:string){
  if(name==="react")return react;if(name==="react/jsx-runtime")return jsx;
  if(name==="./MusicContext")return {useMusic:()=>state};
  if(name==="../player/imageUrl")return {responsiveArtworkSources:()=>({src:null,srcSet:undefined})};
  if(name==="next/link")return {__esModule:true,default:({children,...props}:react.ComponentProps<"a">)=>react.createElement("a",props,children)};
  if(name==="./SongGesture")return {SongGesture:({children,id}: {children:react.ReactNode;id:string})=>react.createElement("div",{"data-song-id":id},children)};
  if(name.endsWith(".css"))return {__esModule:true,default:new Proxy({},{get:(_target,key)=>String(key)})};
  // Other imported controls do not participate in this isolated TrackList.
  return new Proxy({},{get:()=>()=>null});
 }});
 const code=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/Elements.tsx",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInContext(code,context);
 const TrackList=vm.runInContext("module.exports.TrackList",context) as react.ComponentType<{tracks:typeof song[]}>;
 const pressed=renderToStaticMarkup(react.createElement(TrackList,{tracks:[song]}));
 const likeButton=pressed.match(/<button[^>]*aria-label="Unlike Fixture song"[^>]*>/)?.[0];assert.ok(likeButton);assert.match(likeButton,/aria-pressed="true"/);
 assert.match(pressed,/data-song-id="canonical-recording"/);
 state.liked=new Set();
 const unpressed=renderToStaticMarkup(react.createElement(TrackList,{tracks:[song]}));
 const unlikeButton=unpressed.match(/<button[^>]*aria-label="Like Fixture song"[^>]*>/)?.[0];assert.ok(unlikeButton);assert.match(unlikeButton,/aria-pressed="false"/);
});

test("download activity keeps one accessible bloom control for pause, resume and retry on every screen",()=>{
 const room=readFileSync(new URL("../src/rebuild/app/DownloadsRoom.tsx",import.meta.url),"utf8");
 const styles=readFileSync(new URL("../src/rebuild/app/downloads-room.module.css",import.meta.url),"utf8");
 const control=room.match(/<button type="button" className=\{s\.transferControl\}[\s\S]*?<\/button>/)?.[0];
 assert.ok(control,"The progress flower and playback toggle share one button");
 assert.match(control,/aria-label=\{controlLabel\}/);
 assert.match(control,/<DownloadFlower percent=\{percent\} active=\{active\}\/>/);
 assert.match(control,/name=\{canRetry\?"repeat":paused\?"play":"pause"\}/);
 assert.match(control,/onClick=\{canRetry\?\(\)=>p\.requestDownload\(job\.track\):toggle\}/);
 assert.match(room,/toggle=\(\)=>paused\?p\.resumeDownload\(job\.recordingId\):p\.pauseDownload\(job\.recordingId\)/);
 assert.match(room,/toggleLabel=\(paused\?"Resume ":"Pause "\)/);
 assert.doesNotMatch(room,/mobileDownloadToggle|desktopDownloadToggle/);
 assert.match(styles,/\.transferControl,\.transferEmblem\{[^}]*display:grid[^}]*width:48px;height:48px/);
 assert.match(styles,/@media\(max-width:700px\)[\s\S]*\.jobTransfer\{[^}]*grid-column:1\/-1/);
});

test("active player controls have a visible botanical pressed treatment",()=>{
 const app=readFileSync(new URL("../src/rebuild/app/ink.module.css",import.meta.url),"utf8");
 const player=readFileSync(new URL("../src/rebuild/player/player.module.css",import.meta.url),"utf8");
 for(const css of [app,player]){
  assert.match(css,/\.active\{[^}]*linear-gradient/);
  assert.match(css,/\.active::after\{[^}]*background:var\(--(?:ink|p)-petal\)/);
 }
});
