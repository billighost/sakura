/** Real Chrome service-worker media ranges using the production bridge and generated WAV. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {chromium} from "@playwright/test";
import ts from "typescript";

const accountId="90000000-0000-4000-8000-000000000061",recordingId="80000000-0000-4000-8000-000000000061",assetId="81000000-0000-4000-8000-000000000061";
const samples=24000*9,wav=Buffer.alloc(44+samples*2);wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*Math.PI*2*440/24000)*1200),44+i*2);
const sha256=createHash("sha256").update(wav).digest("hex"),sw=await readFile("public/sw.js","utf8"),bridge=ts.transpileModule(await readFile("src/rebuild/app/partialPlayback.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const report={scope:"Actual production service worker and TypeScript bridge served in an isolated browser fixture; generated tone, no production account or server database writes",checks:[],gatewayRanges:[],pageErrors:[]};
const html=`<!doctype html><meta charset="utf-8"><title>Progressive audio verification</title><button id="play">Play</button><script type="module">
import {partialPlaybackUrl,revokePartialPlayback} from '/partialPlayback.js';
const accountId=${JSON.stringify(accountId)},recordingId=${JSON.stringify(recordingId)},assetId=${JSON.stringify(assetId)},sizeBytes=${wav.length},sha256=${JSON.stringify(sha256)};
window.audioFixture={joined:[],progress:[],source:{track:{id:recordingId,readyPlayback:{mimeType:'audio/wav'}},assetId,sizeBytes,sha256,url:'/source',fallbackUrl:'/api/v2/recordings/'+recordingId+'/audio?assetId='+assetId}};
const f=window.audioFixture,key=name=>'account:'+accountId+':'+name;
const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('sakura-ink-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('entries');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const put=(name,value)=>new Promise((resolve,reject)=>{const tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(value,key(name));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
const read=name=>new Promise(resolve=>{const r=db.transaction('entries').objectStore('entries').get(key(name));r.onsuccess=()=>resolve(r.result);});
const bytes=new Uint8Array(await (await fetch('/fixture.wav')).arrayBuffer());
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
async function save(offset){const chunk=bytes.slice(offset,offset+262144);await put('chunk:'+recordingId+':'+offset,{offset,blob:new Blob([chunk],{type:'audio/wav'}),sha256:await digest(chunk)});}
if(!await read('download:'+recordingId)){await put('download:'+recordingId,{version:1,recordingId,track:{id:recordingId},fingerprint:{assetId,sizeBytes,sha256},chunkBytes:262144,mimeType:'audio/wav'});await save(0);}
f.ensureChunk=async(offset,signal)=>{f.joined.push(offset);await new Promise(resolve=>setTimeout(resolve,75));signal.throwIfAborted();await save(offset);return{offset};};
await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
f.url=await partialPlaybackUrl(accountId,f.source,f.ensureChunk);f.revoke=revokePartialPlayback;f.read=read;f.db=db;f.ready=true;
document.querySelector('#play').onclick=()=>{f.audio=new Audio(f.url);f.audio.addEventListener('timeupdate',()=>f.progress.push(f.audio.currentTime));f.audio.play().catch(error=>f.error=error.message);};
</script>`;
const server=createServer((request,response)=>{
 const url=new URL(request.url,"http://localhost");
 if(url.pathname==="/sw.js"){response.writeHead(200,{"Content-Type":"text/javascript","Cache-Control":"no-store"});response.end(sw);return;}
 if(url.pathname==="/partialPlayback.js"){response.writeHead(200,{"Content-Type":"text/javascript"});response.end(bridge);return;}
 if(url.pathname==="/fixture.wav"){response.writeHead(200,{"Content-Type":"audio/wav"});response.end(wav);return;}
 if(url.pathname.startsWith("/api/v2/recordings/")){const match=/bytes=(\d+)-(\d+)/.exec(request.headers.range||"");if(!match){response.writeHead(400);response.end();return;}const start=Number(match[1]),end=Number(match[2]);report.gatewayRanges.push({start,end});response.writeHead(206,{"Content-Type":"audio/wav","Content-Length":end-start+1,"Content-Range":`bytes ${start}-${end}/${wav.length}`,"Accept-Ranges":"bytes"});response.end(wav.subarray(start,end+1));return;}
 if(url.pathname.startsWith("/_sakura/audio/")){response.writeHead(404);response.end();return;}
 response.writeHead(200,{"Content-Type":"text/html"});response.end(html);
});
let browser;
try{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base="http://127.0.0.1:"+server.address().port;
 browser=await chromium.launch({channel:"chrome",headless:true});const context=await browser.newContext({serviceWorkers:"allow"}),page=await context.newPage();page.on("pageerror",error=>report.pageErrors.push(error.message));
 const cdp=await context.newCDPSession(page);let workerVersions=[];cdp.on("ServiceWorker.workerVersionUpdated",data=>{workerVersions=data.versions;});await cdp.send("ServiceWorker.enable");
 await page.goto(base);await page.waitForFunction(()=>window.audioFixture?.ready);assert.ok(await page.evaluate(()=>window.audioFixture.url.startsWith('/_sakura/audio/')));
 let result=await page.evaluate(async()=>{const r=await fetch(window.audioFixture.url,{headers:{Range:'bytes=0-999'}});return {status:r.status,length:(await r.arrayBuffer()).byteLength,joined:window.audioFixture.joined};});assert.equal(result.status,206);assert.equal(result.length,1000);assert.deepEqual(result.joined,[]);report.checks.push("Real Chrome range request consumes persisted first chunk without gateway fetch or manager transfer");
 const activeVersion=workerVersions.find(version=>version.status==="activated"&&version.runningStatus==="running");assert.ok(activeVersion,"Production service worker is active");await cdp.send("ServiceWorker.stopWorker",{versionId:activeVersion.versionId});
 assert.equal(await page.evaluate(async()=>{const response=await fetch(window.audioFixture.url,{headers:{Range:'bytes=99-199'}});return response.status;}),206);report.checks.push("An actual stopped/restarted service worker restores the same client's persisted capability and cached audio");
 const other=await context.newPage();await other.goto(base);await other.waitForFunction(()=>window.audioFixture?.ready);const privateUrl=await page.evaluate(()=>window.audioFixture.url);assert.equal(await other.evaluate(async url=>(await fetch(url)).status,privateUrl),404);await other.close();report.checks.push("A different tab cannot read the first tab's capability URL");
 await page.click("#play");await page.waitForFunction(()=>window.audioFixture.audio?.currentTime>1.5,{},{timeout:20000});result=await page.evaluate(()=>({position:window.audioFixture.audio.currentTime,joined:window.audioFixture.joined,error:window.audioFixture.error}));assert.ok(result.position>1.5);assert.equal(result.error,undefined);assert.ok(result.joined.includes(262144));assert.deepEqual(report.gatewayRanges,[]);report.checks.push("Actual HTMLAudioElement plays a continuous WAV stream, joining manager work for the missing later chunk");
 await page.evaluate(()=>window.audioFixture.audio.pause());await page.reload();await page.waitForFunction(()=>window.audioFixture?.ready);result=await page.evaluate(async()=>{const r=await fetch(window.audioFixture.url,{headers:{Range:'bytes=262144-262999'}});return {status:r.status,length:(await r.arrayBuffer()).byteLength,joined:window.audioFixture.joined};});assert.equal(result.status,206);assert.equal(result.length,856);assert.deepEqual(result.joined,[]);report.checks.push("Reload retains later persisted audio chunks and serves them with no repeated transfer");
 assert.equal(await page.evaluate(async()=>{const f=window.audioFixture;f.revoke();await new Promise(resolve=>setTimeout(resolve,20));return (await fetch(f.url,{headers:{Range:'bytes=0-99'}})).status;}),404);report.checks.push("Account revoke immediately invalidates prior audio capability URLs");
 assert.deepEqual(report.pageErrors,[]);await mkdir(".local",{recursive:true});await writeFile(".local/partial-playback-browser-report.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
