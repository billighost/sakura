import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {settingsFields} from "../src/rebuild/app/preferences";
import {preferencesPatch} from "../src/rebuild/data/validation";

test("shuffle and repeat remain valid local and account-synced preferences",()=>{
 assert.deepEqual(settingsFields({shuffle:true,repeat:"one"}),{shuffle:true,repeat:"one"});
 assert.deepEqual(preferencesPatch({shuffle:true,repeat:"all"}),{repeat:"all",shuffle:true});
});

test("player toggles expose pressed state and the repeat-one mark",()=>{
 const source=readFileSync(new URL("../src/rebuild/app/Elements.tsx",import.meta.url),"utf8");
 const fullPlayer=readFileSync(new URL("../src/rebuild/player/FullPlayer.tsx",import.meta.url),"utf8");
 assert.match(source,/aria-pressed=\{active\}/);
 assert.match(source,/aria-pressed=\{p\.liked\.has\(id\)\}/);
 assert.match(source,/className=\{s\.repeatControl\}/);
 assert.match(source,/p\.repeat==="one"&&<b aria-hidden="true">1<\/b>/);
 assert.match(fullPlayer,/const trackId = track \? music\.effectiveId\(track\) : undefined;/);
 assert.match(fullPlayer,/active=\{liked\}/);
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
