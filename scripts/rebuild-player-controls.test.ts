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

test("mobile download activity combines the bloom with pause and resume",()=>{
 const room=readFileSync(new URL("../src/rebuild/app/DownloadsRoom.tsx",import.meta.url),"utf8");
 const styles=readFileSync(new URL("../src/rebuild/app/downloads-room.module.css",import.meta.url),"utf8");
 assert.match(room,/className=\{s\.mobileDownloadToggle\}/);
 assert.match(room,/<DownloadFlower percent=\{percent\} active=\{active\}\/?>/);
 assert.match(room,/name=\{paused\?"play":"pause"\}/);
 assert.match(styles,/@media\(max-width:700px\)[\s\S]*\.mobileDownloadToggle\{[^}]*display:grid/);
});

test("active player controls have a visible botanical pressed treatment",()=>{
 const app=readFileSync(new URL("../src/rebuild/app/ink.module.css",import.meta.url),"utf8");
 const player=readFileSync(new URL("../src/rebuild/player/player.module.css",import.meta.url),"utf8");
 for(const css of [app,player]){
  assert.match(css,/\.active\{[^}]*linear-gradient/);
  assert.match(css,/\.active::after\{[^}]*background:var\(--(?:ink|p)-petal\)/);
 }
});
