/** Real browser media/cache diagnostics; no account/catalog mutations or mocks. */
import {chromium,expect} from "@playwright/test";
import fs from "node:fs/promises";
const base=process.env.SAKURA_TEST_URL||"http://127.0.0.1:3003";
if(new URL(base).hostname!=="127.0.0.1"||!["3002","3003"].includes(new URL(base).port))throw new Error("Use isolated localhost QA.");
const fixture=JSON.parse(await fs.readFile(".local/rebuild-test-account.json","utf8"));
const browser=await chromium.launch({channel:"chrome",headless:true});
const context=await browser.newContext();await context.addCookies(fixture.cookie.split("; ").map(pair=>{const index=pair.indexOf("=");return{name:pair.slice(0,index),value:pair.slice(index+1),url:base};}));
const page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send("Network.enable");
const report={checkedAt:new Date().toISOString(),origin:base,accountWrites:false,requests:[],cases:[]};let phase="prepare";
const requests=new Map();
cdp.on("Network.requestWillBeSent",event=>{const url=new URL(event.request.url);if(!url.pathname.includes("/audio/"))return;const entry={phase,path:url.pathname,method:event.request.method,range:event.request.headers.Range||event.request.headers.range||null,type:event.type,startMs:Math.round(event.timestamp*1000)};requests.set(event.requestId,entry);report.requests.push(entry);});
cdp.on("Network.responseReceived",event=>{const item=requests.get(event.requestId);if(item){item.status=event.response.status;item.fromDiskCache=event.response.fromDiskCache;item.mime=event.response.mimeType;item.headersMs=Math.round(event.timestamp*1000)-item.startMs;}});
cdp.on("Network.dataReceived",event=>{const item=requests.get(event.requestId);if(item){if(item.firstDataMs===undefined)item.firstDataMs=Math.round(event.timestamp*1000)-item.startMs;item.bodyBytes=(item.bodyBytes||0)+event.dataLength;}});
cdp.on("Network.loadingFinished",event=>{const item=requests.get(event.requestId);if(item){item.totalMs=Math.round(event.timestamp*1000)-item.startMs;item.encodedBytes=event.encodedDataLength;item.complete=true;}});
cdp.on("Network.loadingFailed",event=>{const item=requests.get(event.requestId);if(item){item.failed=true;item.canceled=event.canceled;item.error=event.errorText;}});
try{
 await page.goto(base+"/about");
 const response=await context.request.post(base+"/api/v2/recordings/resolve",{headers:{Origin:base},data:{reference:{provider:"deezer",id:"444333332"}}});const value=await response.json();if(value.status!=="resolved")throw new Error("Verified remix must be ready");
 const direct=value.playback.url,gateway=base+value.playback.fallbackUrl;
 await page.evaluate(()=>{const button=document.createElement("button");button.id="source-probe-play";button.textContent="Start source probe";document.body.append(button);window.__sourceEvents=[];});
 async function start(url,label){
  phase=label;await page.evaluate(url=>{const button=document.getElementById("source-probe-play");button.onclick=()=>{window.__sourceAudio?.pause();const a=new Audio();window.__sourceAudio=a;for(const event of ["loadstart","loadedmetadata","loadeddata","canplay","playing","waiting","error"]){a.addEventListener(event,()=>window.__sourceEvents.push({event,ms:performance.now(),mediaTime:a.currentTime,readyState:a.readyState,error:a.error?.code}));}a.preload="metadata";a.src=url;window.__sourceStarted=performance.now();a.load();void a.play().catch(error=>window.__sourceFailure=error.name);};},url);
  await page.locator("#source-probe-play").click();let success=true;try{await expect.poll(()=>page.evaluate(()=>window.__sourceAudio.currentTime),{timeout:45000,intervals:[100,250,500]}).toBeGreaterThan(1);}catch{success=false;}
  const state=await page.evaluate(()=>({elapsedMs:Math.round(performance.now()-window.__sourceStarted),time:window.__sourceAudio.currentTime,duration:window.__sourceAudio.duration,readyState:window.__sourceAudio.readyState,events:window.__sourceEvents.map(event=>({...event,ms:Math.round(event.ms-window.__sourceStarted)})),error:window.__sourceFailure}));report.cases.push({label,success,...state});console.log(JSON.stringify({label,success,elapsedMs:state.elapsedMs,time:state.time,readyState:state.readyState}));
 }
 async function transfer(url,label,cache="default"){
  phase=label;const result=await page.evaluate(async({url,cache})=>{const started=performance.now(),result={bytes:0};try{const response=await fetch(url,{cache,signal:AbortSignal.timeout(25000)});result.headersMs=Math.round(performance.now()-started);result.status=response.status;const reader=response.body.getReader();while(true){const chunk=await reader.read();if(chunk.done)break;if(result.firstByteMs===undefined)result.firstByteMs=Math.round(performance.now()-started);result.bytes+=chunk.value.length;}result.complete=true;}catch(error){result.complete=false;result.error=error.name;}result.totalMs=Math.round(performance.now()-started);return result;},{url,cache});report.cases.push({label,cache,...result});console.log(JSON.stringify({label,cache,...result}));
 }
 await start(direct,"signed-media");
 await transfer(direct,"same-signed-fetch-default");
 await transfer(direct,"same-signed-fetch-no-store","no-store");
 await transfer(gateway,"gateway-fetch-while-signed-playing","no-store");
 await page.evaluate(()=>{window.__sourceAudio.pause();window.__sourceAudio.removeAttribute("src");window.__sourceAudio.load();window.__sourceEvents=[];});
 await start(gateway,"gateway-media");
 await page.evaluate(()=>window.__sourceAudio.pause());
}finally{await fs.writeFile(".local/rebuild-browser-source-probe.json",JSON.stringify(report,null,2));await browser.close();}
