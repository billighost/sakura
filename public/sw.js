const CACHE="sakura-ink-shell-v4";
const ASSETS="sakura-ink-assets-v1";
const ARTWORK="sakura-ink-artwork-v1";
const resourceFlights=new Map();
const documentFlights=new Map();
const OFFLINE="/offline";
const AUDIO_PREFIX="/_sakura/audio/";
const audioCapabilities=new Map();
const revokedAudioClients=new Set();
const audioClientEpochs=new Map();
let audioCapabilityWork=Promise.resolve();
const audioUuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
let audioDatabase;
function audioDb(){
 if(!audioDatabase)audioDatabase=new Promise((resolve,reject)=>{
  const request=indexedDB.open("sakura-ink-v1",1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("entries"))request.result.createObjectStore("entries");};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 }).catch(error=>{audioDatabase=undefined;throw error;});
 return audioDatabase;
}
async function audioEntry(key){const db=await audioDb();return new Promise((resolve,reject)=>{const request=db.transaction("entries","readonly").objectStore("entries").get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function saveAudioCapability(token,capability){const db=await audioDb();return new Promise((resolve,reject)=>{const tx=db.transaction("entries","readwrite");const {streams,...saved}=capability;void streams;tx.objectStore("entries").put(saved,"audio-bridge:"+token);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function deleteAudioCapability(token){const db=await audioDb();return new Promise((resolve,reject)=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").delete("audio-bridge:"+token);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function pruneAudioCapabilities(clientId){const db=await audioDb();return new Promise((resolve,reject)=>{const tx=db.transaction("entries","readwrite"),entries=[];const request=tx.objectStore("entries").openCursor(IDBKeyRange.bound("audio-bridge:","audio-bridge:\uffff"));request.onsuccess=()=>{const cursor=request.result;if(cursor){const saved=cursor.value;if(saved?.expiresAt<Date.now()||saved?.clientId===clientId)cursor.delete();else entries.push({key:cursor.key,issuedAt:saved.issuedAt||0});cursor.continue();}else{entries.sort((a,b)=>b.issuedAt-a.issuedAt);for(const entry of entries.slice(100))tx.objectStore("entries").delete(entry.key);}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function validAudioBridge(bridge){
 if(!bridge||!audioUuid.test(bridge.accountId)||!audioUuid.test(bridge.recordingId)||!audioUuid.test(bridge.assetId)||!Number.isSafeInteger(bridge.sizeBytes)||bridge.sizeBytes<=0||bridge.sizeBytes>120*1024*1024||typeof bridge.sha256!=="string"||!/^[a-f0-9]{64}$/i.test(bridge.sha256)||typeof bridge.fallbackUrl!=="string"||bridge.mimeType!==undefined&&(typeof bridge.mimeType!=="string"||!bridge.mimeType.startsWith("audio/")))return false;
 try{const url=new URL(bridge.fallbackUrl,self.location.origin);return url.origin===self.location.origin&&url.pathname==="/api/v2/recordings/"+bridge.recordingId+"/audio"&&url.searchParams.get("assetId")===bridge.assetId&&!url.username&&!url.password&&!url.hash;}catch{return false;}
}
function revokeAudioCapability(token){const capability=audioCapabilities.get(token);for(const controller of capability?.streams||[])controller.abort(new DOMException("Audio capability expired","AbortError"));audioCapabilities.delete(token);void deleteAudioCapability(token).catch(()=>{});}
self.addEventListener("message",event=>{
 const data=event.data,clientId=event.source?.id;
 if(!clientId||event.origin&&event.origin!==self.location.origin)return;
 if(data?.type==="sakura-cache-route"&&typeof data.path==="string"&&data.path.length<2048&&musicPath(data.path)){event.waitUntil(cacheDocument(data.path).catch(()=>{}));return;}
 if(data?.type==="sakura-warm-shell"){event.waitUntil(cacheDocument(OFFLINE,true).catch(()=>{}));return;}
 if(data?.type==="sakura-audio-revoke"){audioClientEpochs.set(clientId,(audioClientEpochs.get(clientId)||0)+1);revokedAudioClients.add(clientId);for(const [token,capability]of audioCapabilities)if(capability.clientId===clientId)revokeAudioCapability(token);audioCapabilityWork=audioCapabilityWork.catch(()=>{}).then(async()=>{for(const [token,capability]of audioCapabilities)if(capability.clientId===clientId)revokeAudioCapability(token);await pruneAudioCapabilities(clientId);});event.waitUntil(audioCapabilityWork);return;}
 if(data?.type==="sakura-audio-revoke-token"&&audioUuid.test(data.token)){audioCapabilityWork=audioCapabilityWork.catch(()=>{}).then(async()=>{const active=audioCapabilities.get(data.token),saved=active||await audioEntry("audio-bridge:"+data.token).catch(()=>undefined);if(saved?.clientId!==clientId)return;if(active)revokeAudioCapability(data.token);else await deleteAudioCapability(data.token);});event.waitUntil(audioCapabilityWork);return;}
 if(data?.type!=="sakura-audio-register"||!audioUuid.test(data.token)||!validAudioBridge(data.bridge)){if(data?.type==="sakura-audio-register")event.ports[0]?.postMessage({status:"unavailable"});return;}
 const epoch=audioClientEpochs.get(clientId)||0;
 audioCapabilityWork=audioCapabilityWork.catch(()=>{}).then(async()=>{
  try{
   if(epoch!==(audioClientEpochs.get(clientId)||0))throw new Error("Audio registration was revoked");
   for(const [token,capability]of audioCapabilities)if(capability.expiresAt<Date.now())revokeAudioCapability(token);
   if(audioCapabilities.size>=100)throw new Error("Audio capability limit reached");
   const capability={...data.bridge,sha256:data.bridge.sha256.toLowerCase(),clientId,issuedAt:Date.now(),expiresAt:Date.now()+6*60*60*1000,streams:new Set()};
   await saveAudioCapability(data.token,capability);if(epoch!==(audioClientEpochs.get(clientId)||0))throw new Error("Audio registration was revoked");await pruneAudioCapabilities();if(epoch!==(audioClientEpochs.get(clientId)||0))throw new Error("Audio registration was revoked");audioCapabilities.set(data.token,capability);revokedAudioClients.delete(clientId);
   event.ports[0]?.postMessage({status:"ready",version:1});
  }catch{event.ports[0]?.postMessage({status:"unavailable"});}finally{event.ports[0]?.close();}
 });
 event.waitUntil(audioCapabilityWork);
});
function parseAudioRange(value,size){
 if(!value)return {start:0,end:size-1,partial:false};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!match||!match[1]&&!match[2])return;
 let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[1]?(match[2]?Number(match[2]):size-1):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start||!match[1]&&Number(match[2])<=0)return;
 end=Math.min(end,size-1);return {start,end,partial:true};
}
function audioFingerprintMatches(record,capability){return record?.version===1&&record.recordingId===capability.recordingId&&record.track?.id===capability.recordingId&&record.fingerprint?.assetId===capability.assetId&&record.fingerprint?.sizeBytes===capability.sizeBytes&&record.fingerprint?.sha256===capability.sha256&&record.chunkBytes===262144;}
async function verifiedAudioChunk(chunk,offset,size){
 if(!chunk||chunk.offset!==offset||!(chunk.blob instanceof Blob)||chunk.blob.size!==size||typeof chunk.sha256!=="string"||!/^[a-f0-9]{64}$/i.test(chunk.sha256))return;
 const data=await chunk.blob.arrayBuffer(),hash=await crypto.subtle.digest("SHA-256",data),sha=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
 if(sha!==chunk.sha256.toLowerCase())return;return new Uint8Array(data);
}
async function localAudioChunk(capability,offset,size){
 const prefix="account:"+capability.accountId+":";
 const ready=await audioEntry(prefix+"audio:"+capability.recordingId);
 if(ready?.track?.id===capability.recordingId&&ready.sha256===capability.sha256&&ready.sizeBytes===capability.sizeBytes&&ready.blob instanceof Blob&&ready.blob.size===capability.sizeBytes&&ready.blob.type.startsWith("audio/"))return {bytes:new Uint8Array(await ready.blob.slice(offset,offset+size).arrayBuffer()),mimeType:ready.blob.type};
 const record=await audioEntry(prefix+"download:"+capability.recordingId);
 if(!audioFingerprintMatches(record,capability))return;
 const bytes=await verifiedAudioChunk(await audioEntry(prefix+"chunk:"+capability.recordingId+":"+offset),offset,size);
 if(bytes&&typeof record.mimeType==="string"&&record.mimeType.startsWith("audio/"))return {bytes,mimeType:record.mimeType};
}
async function askClientForChunk(capability,token,offset,signal){
 signal.throwIfAborted();const client=await self.clients.get(capability.clientId);if(!client)return "unavailable";
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),requestId=crypto.randomUUID();let timer;
  const clean=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);channel.port1.close();};
  const abort=()=>{client.postMessage({type:"sakura-audio-cancel",requestId});clean();reject(signal.reason||new DOMException("Canceled","AbortError"));};
  signal.addEventListener("abort",abort,{once:true});
  timer=setTimeout(()=>{client.postMessage({type:"sakura-audio-cancel",requestId});clean();resolve("unavailable");},18000);
  channel.port1.onmessage=event=>{clean();resolve(event.data?.status||"unavailable");};
  client.postMessage({type:"sakura-audio-chunk",token,offset,requestId},[channel.port2]);
 });
}
async function remoteAudioChunk(capability,offset,size,signal){
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
 const timer=setTimeout(()=>controller.abort(new Error("Audio range timed out")),20000);
 try{
  const response=await fetch(new URL(capability.fallbackUrl,self.location.origin),{credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal,headers:{Range:`bytes=${offset}-${offset+size-1}`,"X-Sakura-Account":capability.accountId}});
  const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range")||""),mimeType=(response.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if(response.status!==206||!range||Number(range[1])!==offset||Number(range[2])!==offset+size-1||Number(range[3])!==capability.sizeBytes||!mimeType.startsWith("audio/")||capability.mimeType&&mimeType!==capability.mimeType.toLowerCase()){await response.body?.cancel();throw new Error("The audio range did not match its verified source.");}
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength!==size)throw new Error("The audio range ended early.");return {bytes,mimeType};
 }finally{clearTimeout(timer);signal.removeEventListener("abort",abort);}
}
async function loadAudioChunk(capability,token,offset,size,signal){
 signal.throwIfAborted();const local=await localAudioChunk(capability,offset,size).catch(()=>undefined);if(local)return local;
 const result=await askClientForChunk(capability,token,offset,signal);
 if(result==="ready"){const saved=await localAudioChunk(capability,offset,size).catch(()=>undefined);if(saved)return saved;throw new Error("The saved audio range did not match this recording.");}
 if(result==="invalid")throw new Error("The audio range did not match this verified recording.");
 // `failed` is retained as a transient result for compatibility with an older
 // page bundle during a rolling service-worker update. The gateway is scoped to
 // this exact recording and asset and validates every returned byte interval.
 return remoteAudioChunk(capability,offset,size,signal);
}
async function serveDeviceAudio(request,clientId,token){
 const epoch=audioClientEpochs.get(clientId)||0;
 let capability=audioCapabilities.get(token);
 if(!capability&&!revokedAudioClients.has(clientId)&&audioUuid.test(token)){const saved=await audioEntry("audio-bridge:"+token).catch(()=>undefined);if(epoch===(audioClientEpochs.get(clientId)||0)&&!revokedAudioClients.has(clientId)&&validAudioBridge(saved)&&saved.clientId===clientId&&saved.expiresAt>Date.now()){capability={...saved,streams:new Set()};audioCapabilities.set(token,capability);}}
 if(epoch!==(audioClientEpochs.get(clientId)||0)||!capability||revokedAudioClients.has(clientId)||capability.clientId!==clientId||capability.expiresAt<Date.now())return new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}});
 const range=parseAudioRange(request.headers.get("Range"),capability.sizeBytes),headers=new Headers({"Accept-Ranges":"bytes","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",ETag:'"'+capability.sha256+'"'});
 if(!range){headers.set("Content-Range",`bytes */${capability.sizeBytes}`);return new Response(null,{status:416,headers});}
 headers.set("Content-Length",String(range.end-range.start+1));if(range.partial)headers.set("Content-Range",`bytes ${range.start}-${range.end}/${capability.sizeBytes}`);
 if(request.method==="HEAD"){headers.set("Content-Type",capability.mimeType||"audio/mpeg");return new Response(null,{status:range.partial?206:200,headers});}
 const controller=new AbortController(),abort=()=>controller.abort(request.signal.reason);request.signal.addEventListener("abort",abort,{once:true});if(request.signal.aborted)abort();
 capability.streams ||= new Set();capability.streams.add(controller);
 const cleanup=()=>{request.signal.removeEventListener("abort",abort);capability.streams.delete(controller);};
 try{
  const offset=Math.floor(range.start/262144)*262144;
  let prepared=await loadAudioChunk(capability,token,offset,Math.min(262144,capability.sizeBytes-offset),controller.signal),position=range.start;
  headers.set("Content-Type",prepared.mimeType||capability.mimeType||"audio/mpeg");
  const body=new ReadableStream({
   async pull(stream){try{controller.signal.throwIfAborted();if(position>range.end){cleanup();stream.close();return;}const aligned=Math.floor(position/262144)*262144,stop=Math.min(range.end+1,aligned+262144);if(!prepared)prepared=await loadAudioChunk(capability,token,aligned,Math.min(262144,capability.sizeBytes-aligned),controller.signal);stream.enqueue(prepared.bytes.slice(position-aligned,stop-aligned));prepared=undefined;position=stop;}catch(error){cleanup();controller.abort(error);stream.error(error);}},
   cancel(reason){cleanup();controller.abort(reason);}
  });
  return new Response(body,{status:range.partial?206:200,headers});
 }catch(error){cleanup();controller.abort(error);return new Response(null,{status:request.signal.aborted?499:503,headers:{"Cache-Control":"private, no-store"}});}
}
function musicPath(path){return /^\/(?:home|discover|search|library(?:\/downloaded)?|liked|downloads|offline|profile|settings|onboarding|import|(?:artist|album|playlist|mix|track)\/[^/]+|bloom(?:\/[^/]+)?)\/?$/.test(path);}
async function cacheFirst(request,name){
 const cache=await caches.open(name),saved=await cache.match(request,{ignoreSearch:name===ASSETS});if(saved)return saved;
 const identity=new URL(request.url);if(name===ASSETS)identity.search="";
 const key=name+":"+identity.href;let flight=resourceFlights.get(key);
 if(!flight){
  // One consumer cancelling its image does not cancel another consumer's copy.
  flight=(async()=>{const response=await fetch(new Request(request,{signal:null}));if(response.ok&&response.status===200&&(name!==ARTWORK||response.headers.get("Content-Type")?.startsWith("image/"))){try{await cache.put(request,response.clone());}catch{}}return response;})();
  resourceFlights.set(key,flight);void flight.finally(()=>{if(resourceFlights.get(key)===flight)resourceFlights.delete(key);}).catch(()=>{});
 }
 return (await flight).clone();
}
async function cacheDocument(path,refresh=false){
 if(!musicPath(path))return;const cache=await caches.open(CACHE);
 if(!refresh&&await cache.match(path))return;
 let flight=documentFlights.get(path);if(flight)return flight;
 flight=(async()=>{
  const response=await fetch(path,{cache:"reload",credentials:"same-origin",headers:{Accept:"text/html"}});
  // Never persist an authentication redirect as an offline music page.
  if(!response.ok||response.redirected||!response.headers.get("Content-Type")?.includes("text/html"))return;
  const savedResponse=response.clone(),html=await response.text();
  const assets=[...new Set(html.match(/\/_next\/static\/[^"\s<>]+\.(?:js|css|woff2?)/g)||[])];
  await Promise.allSettled(assets.map(url=>cacheFirst(new Request(new URL(url,self.location.origin)),ASSETS)));
  try{await cache.put(path,savedResponse);}catch{}
 })();documentFlights.set(path,flight);
 try{return await flight;}finally{if(documentFlights.get(path)===flight)documentFlights.delete(path);}
}
self.addEventListener("install",event=>event.waitUntil((async()=>{
 await cacheDocument(OFFLINE,true).catch(()=>{});
 await Promise.allSettled(["/icons/ink.svg","/icons/ink-180.png","/icons/ink-192.png","/icons/ink-512.png","/manifest.json","/lyric-publish-worker.js"].map(path=>cacheFirst(new Request(new URL(path,self.location.origin)),CACHE)));
 await self.skipWaiting();
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 // Artwork and verified audio belong to the device, not this deployment. Keep
 // the previous shell's hashed assets available to already-open player tabs.
 await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
 const request=event.request;const url=new URL(request.url);
 if(["GET","HEAD"].includes(request.method)&&url.origin===self.location.origin&&url.pathname.startsWith(AUDIO_PREFIX)){event.respondWith(serveDeviceAudio(request,event.clientId,url.pathname.slice(AUDIO_PREFIX.length)));return;}
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 if(url.pathname==="/api/v2/image"){event.respondWith(cacheFirst(request,ARTWORK));return;}
 // Account JSON is persisted by Sakura's account-scoped resource store. RSC
 // responses vary by router state and must never share a URL-only cache.
 if(url.pathname.startsWith("/api/")||request.headers.has("RSC")||url.searchParams.has("_rsc"))return;
 if(request.mode==="navigate"){event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const response=await fetch(request);
   if(response.ok&&!response.redirected&&musicPath(url.pathname)&&response.headers.get("Content-Type")?.includes("text/html")){
    try{await cache.put(url.pathname,response.clone());}catch{}
   }
   return response;
  }catch{
   const saved=await cache.match(url.pathname);if(saved)return saved;
   // Deliver the neutral client shell under the requested URL. Its offline
   // renderer opens that page using account-scoped data, preserving deep links.
   const offline=musicPath(url.pathname)&&await cache.match(OFFLINE);if(offline)return offline;
   return new Response("Open Sakura once while connected to prepare this device for offline listening.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  }
 })());return;}
 if(url.pathname.startsWith("/_next/static/")){event.respondWith(cacheFirst(request,ASSETS));return;}
 if(request.destination==="image"&&!url.pathname.startsWith("/icons/")&&url.pathname!=="/favicon.svg"){event.respondWith(cacheFirst(request,ARTWORK));return;}
 if(url.pathname.startsWith("/icons/")||["/manifest.json","/favicon.svg","/lyric-publish-worker.js"].includes(url.pathname))event.respondWith(cacheFirst(request,CACHE));
});
