import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { chromium } from "@playwright/test";
import { SourceAudioTransport } from "../src/rebuild/server/gateway";
import type { StoredAudioAsset } from "../src/rebuild/server/contracts";

const moduleUrl = (source:string) => "data:text/javascript;base64," + Buffer.from(source).toString("base64");

test("locally minted audio URLs pass the deployed worker authenticator and immutable document checks",async()=>{
 const {authorized,audioHeaders}=await import(new URL("../worker/cloudflare/src/http.mjs",import.meta.url).href);
 const secret="fixture-local-worker-signature-secret",asset:StoredAudioAsset={assetId:"22222222-2222-4222-8222-222222222222",recordingId:"11111111-1111-4111-8111-111111111111",candidate:{candidateId:"22222222-2222-4222-8222-222222222222",metadata:{title:"Song",artists:["Artist"],durationMs:240000},audioKind:"full",references:[]},locator:{kind:"telegram-worker",protocol:"v2",messageId:"42",chatScope:"primary",documentId:"123"},state:"ready",verifiedAt:"2026-11-07T00:00:00Z",mimeType:"audio/mpeg",sizeBytes:4096,ownerAccountId:null};
 let requests=0;const transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{url:"https://worker.example.test",secret,chatScope:"primary"}},(async()=>{requests++;throw new Error("No signing request allowed");})as typeof fetch);
 const url=(await transport.signedPlaybackUrl(asset))!,request=new Request(url,{headers:{Range:"bytes=0-511"}}),audio={chatScope:"primary",messageId:"42",fileId:"123",size:4096,mimeType:"audio/mpeg"};
 assert.equal(authorized(request,secret),true);const headers=audioHeaders(request,audio);assert.equal(headers.status,206);assert.equal(new Headers(headers.headers).get("Content-Range"),"bytes 0-511/4096");assert.equal(requests,0);
 assert.equal(audioHeaders(request,{...audio,fileId:"124"}).response?.status,412);
 const tampered=new URL(url);tampered.searchParams.set("documentTag",'"'+"f".repeat(64)+'"');assert.equal(authorized(new Request(tampered),secret),false);
 assert.equal(authorized(new Request(url),"another-worker-secret-with-enough-characters"),false);
});

test("real IndexedDB preparation pins prevent cross-tab eviction and expire within the owning account", {timeout:60000}, async()=>{
 const idb=moduleUrl(await readFile("node_modules/idb/build/index.js","utf8"));
 const offline=moduleUrl(`import {openDB} from ${JSON.stringify(idb)};
 const database=openDB("sakura-audio-pin-fixture",1,{upgrade(database){database.createObjectStore("entries");}});
 export const offlineDatabase=()=>database;
 export const savedAudio=async()=>[];
 export const savedAudioMetadata=async()=>[];
 export const offlineAudioMetadata=({blob,...audio})=>({version:1,...audio});
 export const invalidateSavedAudioMetadata=()=>{};
 export const validOfflineAudio=value=>!!value&&value.blob instanceof Blob&&value.blob.size===value.sizeBytes;
 `);
 const source=ts.transpileModule(await readFile("src/rebuild/app/downloadStorage.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
 const storageUrl=moduleUrl(source.replaceAll('"./offline"',JSON.stringify(offline)));
 const browser=await chromium.launch({channel:"chrome",headless:true});
 try{
  const page=await browser.newPage();await page.route("http://sakura-prepare.test/**",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><title>Preparation storage</title>"}));await page.goto("http://sakura-prepare.test/");await page.evaluate("globalThis.__name = (fn) => fn");
  const result=await page.evaluate(async url=>{
   const {indexedDownloadStorage}=await import(url),one=indexedDownloadStorage("one"),otherTab=indexedDownloadStorage("one"),two=indexedDownloadStorage("two");
   const audio={track:{id:"recording"},blob:new Blob([new Uint8Array(8)],{type:"audio/mpeg"}),sha256:"a".repeat(64),sizeBytes:8,savedAt:Date.now(),requested:false};
   await one.finalize("recording",audio);await two.finalize("recording",audio);
   await one.pinAutomatic("recording","first",Date.now()+10000);await one.pinAutomatic("recording","second",Date.now()+10000);
   const firstBlocked=await otherTab.clearAutomatic("recording")===false,otherAccount=await two.clearAutomatic("recording");
   await one.releaseAutomaticPin("recording","first");const secondBlocked=await otherTab.clearAutomatic("recording")===false;
   await one.releaseAutomaticPin("recording","second");const released=await otherTab.clearAutomatic("recording");
   const scopedAudio={...audio,track:{id:"scoped"}};await one.finalize("scoped",scopedAudio);await one.pinAutomatic("scoped","tab:prepare:old",Date.now()+10000);await one.pinAutomatic("scoped","other:prepare:active",Date.now()+10000);await one.releaseAutomaticPins("tab:prepare:");
   const scopedBlocked=await otherTab.clearAutomatic("scoped")===false;await one.releaseAutomaticPin("scoped","other:prepare:active");const scopedReleased=await otherTab.clearAutomatic("scoped");
   const legacyAudio={...audio,track:{id:"legacy"}};await one.finalize("legacy",legacyAudio);
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("sakura-audio-pin-fixture",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise<void>((resolve,reject)=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").put({expiresAt:Date.now()+10000},"account:one:audio-pin:legacy:tab:prepare:legacy");tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});db.close();
   await one.releaseAutomaticPins("tab:prepare:");const legacyReleased=await otherTab.clearAutomatic("legacy");
   await one.finalize("recording",audio);await one.pinAutomatic("recording","expired",Date.now()-1);const expired=await otherTab.clearAutomatic("recording");
   await one.finalize("recording",{...audio,requested:true});const explicitProtected=await otherTab.clearAutomatic("recording")===false;
   return {scopedBlocked,scopedReleased,legacyReleased,firstBlocked,otherAccount,secondBlocked,released,expired,explicitProtected};
  },storageUrl);
  assert.deepEqual(result,{scopedBlocked:true,scopedReleased:true,legacyReleased:true,firstBlocked:true,otherAccount:true,secondBlocked:true,released:true,expired:true,explicitProtected:true});
 }finally{await browser.close();}
});
