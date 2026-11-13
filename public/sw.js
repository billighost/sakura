const CACHE="sakura-ink-shell-v4";
const ASSETS="sakura-ink-assets-v1";
const ARTWORK="sakura-ink-artwork-v1";
const CACHE_METADATA="sakura-ink-cache-metadata-v1";
const cacheRecords=new Map();
const validatedDocuments=new Set();
const pendingDocumentAssets=new Map();
let cacheRecordsLoaded,cacheRecordWork=Promise.resolve(),cachePruning,pruneAgain=false;
const cacheBudgets={assets:{entries:1024,bytes:96*1024*1024,age:90*86400000},artwork:{entries:256,bytes:48*1024*1024,age:30*86400000},documents:{entries:64,bytes:16*1024*1024,age:30*86400000}};
const resourceFlights=new Map();
const resourceDurability=new Map();
const documentFlights=new Map();
const OFFLINE="/offline";
const AUDIO_PREFIX="/_sakura/audio/";
const OPENING_AUDIO_BYTES=32768;
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
/** One coherent transaction cannot mix a finalized file with an old manifest. */
async function localAudioEntries(capability,offset){const db=await audioDb(),prefix="account:"+capability.accountId+":";return new Promise((resolve,reject)=>{
 const tx=db.transaction("entries","readonly"),store=tx.objectStore("entries"),result={};
 const ready=store.get(prefix+"audio:"+capability.recordingId);ready.onsuccess=()=>{result.ready=ready.result;
  const saved=ready.result;if(saved?.track?.id===capability.recordingId&&saved.sha256===capability.sha256&&saved.sizeBytes===capability.sizeBytes&&saved.blob instanceof Blob&&saved.blob.size===capability.sizeBytes&&saved.blob.type.startsWith("audio/"))return;
  const record=store.get(prefix+"download:"+capability.recordingId),chunk=store.get(prefix+"chunk:"+capability.recordingId+":"+offset);
  record.onsuccess=()=>{result.record=record.result;};chunk.onsuccess=()=>{result.chunk=chunk.result;if(!chunk.result){const opening=store.get(prefix+"chunk-opening:"+capability.recordingId+":"+offset);opening.onsuccess=()=>{result.opening=opening.result;};}if(offset%262144!==0||chunk.result?.blob?.size>32768){const covering=store.get(prefix+"chunk:"+capability.recordingId+":"+Math.floor(offset/262144)*262144);covering.onsuccess=()=>{result.covering=covering.result;};}};
 };
 tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Audio storage read was interrupted."));
 });}
async function saveAudioCapability(token,capability){const db=await audioDb();return new Promise((resolve,reject)=>{const tx=db.transaction("entries","readwrite");const {streams,...saved}=capability;void streams;tx.objectStore("entries").put(saved,"audio-bridge:"+token);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function deleteAudioCapability(token){const db=await audioDb();return new Promise((resolve,reject)=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").delete("audio-bridge:"+token);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function pruneAudioCapabilities(clientId){const db=await audioDb();return new Promise((resolve,reject)=>{const tx=db.transaction("entries","readwrite"),entries=[];const request=tx.objectStore("entries").openCursor(IDBKeyRange.bound("audio-bridge:","audio-bridge:\uffff"));request.onsuccess=()=>{const cursor=request.result;if(cursor){const saved=cursor.value;if(saved?.expiresAt<Date.now()||saved?.clientId===clientId)cursor.delete();else entries.push({key:cursor.key,issuedAt:saved.issuedAt||0});cursor.continue();}else{entries.sort((a,b)=>b.issuedAt-a.issuedAt);for(const entry of entries.slice(100))tx.objectStore("entries").delete(entry.key);}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function validAudioBridge(bridge){
 if(bridge?.nativeOpening!==undefined&&typeof bridge.nativeOpening!=="boolean")return false;
 if(!bridge||!audioUuid.test(bridge.accountId)||!audioUuid.test(bridge.recordingId)||!audioUuid.test(bridge.assetId)||!Number.isSafeInteger(bridge.sizeBytes)||bridge.sizeBytes<=0||bridge.sizeBytes>120*1024*1024||typeof bridge.sha256!=="string"||!/^[a-f0-9]{64}$/i.test(bridge.sha256)||typeof bridge.fallbackUrl!=="string"||bridge.mimeType!==undefined&&(typeof bridge.mimeType!=="string"||!bridge.mimeType.startsWith("audio/")))return false;
 try{const url=new URL(bridge.fallbackUrl,self.location.origin);return url.origin===self.location.origin&&url.pathname==="/api/v2/recordings/"+bridge.recordingId+"/audio"&&url.searchParams.get("assetId")===bridge.assetId&&!url.username&&!url.password&&!url.hash;}catch{return false;}
}
function revokeAudioCapability(token){const capability=audioCapabilities.get(token);for(const controller of capability?.streams||[])controller.abort(new DOMException("Audio capability expired","AbortError"));audioCapabilities.delete(token);void deleteAudioCapability(token).catch(()=>{});}
self.addEventListener("message",event=>{
 const data=event.data,clientId=event.source?.id;
 if(!clientId||event.origin&&event.origin!==self.location.origin)return;
 if(data?.type==="sakura-cache-route"&&typeof data.path==="string"&&data.path.length<2048&&documentPath(data.path)){event.waitUntil((async()=>{const assets=Array.isArray(data.assets)?data.assets.filter(path=>typeof path==="string"&&path.startsWith("/_next/static/")&&path.length<2048).slice(0,512):[];await rememberCacheRecord("client:"+clientId,{kind:"client",clientId,path:data.path,assets,complete:data.assetsComplete===true&&assets.length<512,updatedAt:Date.now()});await cacheDocument(data.path).catch(()=>{});await pruneCacheStorage();})());return;}
 if(data?.type==="sakura-warm-shell"){event.waitUntil(cacheDocument(OFFLINE,true).catch(()=>{}));return;}
 if(data?.type==="sakura-assets-ready"){
  const port=event.ports[0];
  const work=(async()=>{try{while(resourceDurability.size)await Promise.allSettled([...resourceDurability.values()]);await cacheRecordWork.catch(()=>{});port?.postMessage({status:"ready"});}catch{port?.postMessage({status:"unavailable"});}finally{port?.close();}})();
  event.waitUntil(work);return;
 }
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
async function localAudioChunk(capability,offset,size,opening=false){
 const {ready,record,chunk,covering,opening:prefix}=await localAudioEntries(capability,offset);
 if(ready?.track?.id===capability.recordingId&&ready.sha256===capability.sha256&&ready.sizeBytes===capability.sizeBytes&&ready.blob instanceof Blob&&ready.blob.size===capability.sizeBytes&&ready.blob.type.startsWith("audio/"))return {bytes:new Uint8Array(await ready.blob.slice(offset,offset+size).arrayBuffer()),mimeType:ready.blob.type};
 if(!audioFingerprintMatches(record,capability))return;
 const bytes=await verifiedAudioChunk(chunk,offset,size);
 if(bytes&&typeof record.mimeType==="string"&&record.mimeType.startsWith("audio/"))return {bytes,mimeType:record.mimeType};
 if(opening){const bytes=await verifiedAudioChunk(prefix,offset,Math.min(size,OPENING_AUDIO_BYTES));if(bytes&&typeof record.mimeType==="string"&&record.mimeType.startsWith("audio/"))return {bytes,mimeType:record.mimeType};}
 if(opening&&covering){const base=Math.floor(offset/262144)*262144,length=Math.min(262144,capability.sizeBytes-base),expected=Math.min(size,OPENING_AUDIO_BYTES);if(offset+expected<=base+length){const bytes=await verifiedAudioChunk(covering,base,length);if(bytes&&typeof record.mimeType==="string"&&record.mimeType.startsWith("audio/"))return {bytes:bytes.slice(offset-base),mimeType:record.mimeType};}}
}
async function askClientForChunk(capability,token,offset,signal,opening=false){
 signal.throwIfAborted();const client=await self.clients.get(capability.clientId);signal.throwIfAborted();if(!client)return "unavailable";
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),requestId=crypto.randomUUID();let timer;
  const clean=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);channel.port1.close();};
  const abort=()=>{client.postMessage({type:"sakura-audio-cancel",requestId});clean();reject(signal.reason||new DOMException("Canceled","AbortError"));};
  signal.addEventListener("abort",abort,{once:true});
  timer=setTimeout(()=>{client.postMessage({type:"sakura-audio-cancel",requestId});clean();resolve("unavailable");},18000);
  channel.port1.onmessage=event=>{clean();resolve(event.data?.status||"unavailable");};
  client.postMessage({type:"sakura-audio-chunk",token,offset,requestId,opening},[channel.port2]);
 });
}
async function remoteAudioChunk(capability,offset,size,signal){
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
 const timer=setTimeout(()=>controller.abort(new Error("Audio range timed out")),20000);
 try{
  const response=await fetch(new URL(capability.fallbackUrl,self.location.origin),{credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal,headers:{Range:`bytes=${offset}-${offset+size-1}`,"X-Sakura-Account":capability.accountId,"X-Sakura-Playback":"1"}});
  const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range")||""),mimeType=(response.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if(response.status!==206||!range||Number(range[1])!==offset||Number(range[2])!==offset+size-1||Number(range[3])!==capability.sizeBytes||!mimeType.startsWith("audio/")||capability.mimeType&&mimeType!==capability.mimeType.toLowerCase()){await response.body?.cancel();throw new Error("The audio range did not match its verified source.");}
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength!==size)throw new Error("The audio range ended early.");return {bytes,mimeType};
 }finally{clearTimeout(timer);signal.removeEventListener("abort",abort);}
}
async function loadAudioChunk(capability,token,offset,size,signal,opening=false){
 signal.throwIfAborted();const local=await localAudioChunk(capability,offset,size,opening).catch(()=>undefined);if(local)return local;
 const result=await askClientForChunk(capability,token,offset,signal,opening);
 if(result==="ready"){const saved=await localAudioChunk(capability,offset,size,opening).catch(()=>undefined);if(saved)return saved;throw new Error("The saved audio range did not match this recording.");}
 if(result==="invalid")throw new Error("The audio range did not match this verified recording.");
 const completed=await localAudioChunk(capability,offset,size,opening).catch(()=>undefined);if(completed)return completed;
 // `failed` is retained as a transient result for compatibility with an older
 // page bundle during a rolling service-worker update. The gateway is scoped to
 // this exact recording and asset and validates every returned byte interval.
 return remoteAudioChunk(capability,offset,opening?Math.min(size,OPENING_AUDIO_BYTES):size,signal);
}
async function serveDeviceAudio(request,clientId,token){
 const epoch=audioClientEpochs.get(clientId)||0;
 let capability=audioCapabilities.get(token);
 if(!capability&&!revokedAudioClients.has(clientId)&&audioUuid.test(token)){const saved=await audioEntry("audio-bridge:"+token).catch(()=>undefined);if(epoch===(audioClientEpochs.get(clientId)||0)&&!revokedAudioClients.has(clientId)&&validAudioBridge(saved)&&saved.clientId===clientId&&saved.expiresAt>Date.now()){capability={...saved,streams:new Set()};audioCapabilities.set(token,capability);}}
 if(epoch!==(audioClientEpochs.get(clientId)||0)||!capability||revokedAudioClients.has(clientId)||capability.clientId!==clientId||capability.expiresAt<Date.now())return new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}});
 // The manager validates the first MPEG frame before publishing this layout.
 // This view omits tag artwork while every saved range and checksum continues
 // to describe the original, immutable source file.
 const layout=await localAudioEntries(capability,0).catch(()=>undefined),known=capability.nativeOpening===true?(audioFingerprintMatches(layout?.record,capability)?layout.record.audioStartBytes:capability.audioStartBytes):0;
 const audioStart=Number.isSafeInteger(known)&&known>=0&&known<capability.sizeBytes&&known<=32*1024*1024?known:0,size=capability.sizeBytes-audioStart;
 const knownEnd=capability.nativeOpening===true?(audioFingerprintMatches(layout?.record,capability)?layout.record.audioOpeningEndBytes:capability.audioOpeningEndBytes):undefined,openingEnd=Number.isSafeInteger(knownEnd)&&knownEnd>audioStart&&knownEnd<=Math.min(capability.sizeBytes,audioStart+294912)?knownEnd:audioStart;
 if(epoch!==(audioClientEpochs.get(clientId)||0)||revokedAudioClients.has(clientId))return new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}});
 if(audioStart>0&&(capability.audioStartBytes!==audioStart||capability.audioOpeningEndBytes!==openingEnd)){capability.audioStartBytes=audioStart;capability.audioOpeningEndBytes=openingEnd;audioCapabilityWork=audioCapabilityWork.catch(()=>{}).then(async()=>{if(audioCapabilities.get(token)===capability&&epoch===(audioClientEpochs.get(clientId)||0))await saveAudioCapability(token,capability);}).catch(()=>{});await audioCapabilityWork;}
 if(epoch!==(audioClientEpochs.get(clientId)||0)||revokedAudioClients.has(clientId))return new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}});
 const range=parseAudioRange(request.headers.get("Range"),size),headers=new Headers({"Accept-Ranges":"bytes","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",ETag:'"'+capability.sha256+(audioStart?'-audio-'+audioStart:'')+'"'});
 if(!range){headers.set("Content-Range",`bytes */${size}`);return new Response(null,{status:416,headers});}
 headers.set("Content-Length",String(range.end-range.start+1));if(range.partial)headers.set("Content-Range",`bytes ${range.start}-${range.end}/${size}`);
 if(request.method==="HEAD"){headers.set("Content-Type",capability.mimeType||"audio/mpeg");return new Response(null,{status:range.partial?206:200,headers});}
 const controller=new AbortController(),abort=()=>controller.abort(request.signal.reason);request.signal.addEventListener("abort",abort,{once:true});if(request.signal.aborted)abort();
 capability.streams ||= new Set();capability.streams.add(controller);
 const cleanup=()=>{request.signal.removeEventListener("abort",abort);capability.streams.delete(controller);};
 try{
  const fragments=capability.nativeOpening===true;let position=range.start+audioStart,preparedOffset=position<openingEnd?audioStart+Math.floor((position-audioStart)/OPENING_AUDIO_BYTES)*OPENING_AUDIO_BYTES:Math.floor(position/(fragments?OPENING_AUDIO_BYTES:262144))*(fragments?OPENING_AUDIO_BYTES:262144);
  const firstOpening=fragments||!audioStart&&range.start<OPENING_AUDIO_BYTES&&preparedOffset===0,firstSize=fragments?Math.min(OPENING_AUDIO_BYTES,position<openingEnd?openingEnd-preparedOffset:capability.sizeBytes-preparedOffset):262144;
  let prepared=await loadAudioChunk(capability,token,preparedOffset,Math.min(firstSize,capability.sizeBytes-preparedOffset),controller.signal,firstOpening);
  headers.set("Content-Type",prepared.mimeType||capability.mimeType||"audio/mpeg");
  const body=new ReadableStream({
   async pull(stream){try{controller.signal.throwIfAborted();if(position>range.end+audioStart){cleanup();stream.close();return;}if(!prepared){const opening=position<openingEnd,width=fragments?OPENING_AUDIO_BYTES:262144;preparedOffset=opening?audioStart+Math.floor((position-audioStart)/OPENING_AUDIO_BYTES)*OPENING_AUDIO_BYTES:Math.floor(position/width)*width;prepared=await loadAudioChunk(capability,token,preparedOffset,Math.min(width,(opening?openingEnd:capability.sizeBytes)-preparedOffset),controller.signal,fragments||opening);}const stop=Math.min(range.end+audioStart+1,preparedOffset+prepared.bytes.byteLength);if(stop<=position)throw new Error("The audio range ended before playback could continue.");stream.enqueue(prepared.bytes.slice(position-preparedOffset,stop-preparedOffset));prepared=undefined;position=stop;}catch(error){cleanup();controller.abort(error);stream.error(error);}},
   cancel(reason){cleanup();controller.abort(reason);}
  });
  return new Response(body,{status:range.partial?206:200,headers});
 }catch(error){cleanup();controller.abort(error);return new Response(null,{status:request.signal.aborted?499:503,headers:{"Cache-Control":"private, no-store"}});}
}
function musicPath(path){return /^\/(?:home|discover|search|library(?:\/downloaded)?|liked|downloads|offline|profile|settings|onboarding|import|(?:artist|album|playlist|mix|track)\/[^/]+|bloom(?:\/[^/]+)?)\/?$/.test(path);}
function publicPath(path){return /^\/(?:about|privacy|terms)\/?$/.test(path);}
function documentPath(path){return musicPath(path)||publicPath(path);}
async function openCache(name){try{return await caches.open(name);}catch{return undefined;}}
async function matchCache(cache,request,options){try{return await cache?.match(request,options);}catch{return undefined;}}
function cacheRecordRequest(key){return new Request(new URL("/__sakura_cache__/"+encodeURIComponent(key),self.location.origin));}
async function loadCacheRecords(){if(!cacheRecordsLoaded)cacheRecordsLoaded=(async()=>{const cache=await openCache(CACHE_METADATA);if(!cache?.keys)return;const keys=await cache.keys();for(let start=0;start<keys.length;start+=16){await Promise.allSettled(keys.slice(start,start+16).map(async request=>{const response=await matchCache(cache,request);if(!response)return;const value=await response.json();if(value&&["resource","document","client"].includes(value.kind)){const key=decodeURIComponent(new URL(request.url).pathname.slice("/__sakura_cache__/".length));cacheRecords.set(key,value);}}));}})().catch(()=>{});await cacheRecordsLoaded;}
async function rememberCacheRecord(key,value){await loadCacheRecords();cacheRecords.set(key,value);const work=cacheRecordWork.catch(()=>{}).then(async()=>{if(cacheRecords.get(key)!==value)return;const cache=await openCache(CACHE_METADATA);try{await cache?.put(cacheRecordRequest(key),new Response(JSON.stringify(value),{headers:{"Content-Type":"application/json"}}));}catch{}});cacheRecordWork=work;await work;}
async function deleteCacheRecord(key){cacheRecords.delete(key);const cache=await openCache(CACHE_METADATA);try{await cache?.delete?.(cacheRecordRequest(key));}catch{}}
/** Protected offline documents and open old-build tabs take precedence over a budget. */
async function pruneCacheStorage(pressure=false){
 if(cachePruning){pruneAgain=true;await cachePruning;return;}
 const work=(async()=>{await loadCacheRecords();await cacheRecordWork.catch(()=>{});const now=Date.now(),clients=await self.clients.matchAll?.({type:"window",includeUncontrolled:true}).catch(()=>[])||[],liveIds=new Set(clients.map(client=>client.id)),protectedAssets=new Set(),protectedDocuments=new Set([OFFLINE]);let unknownClient=false;
  for(const client of clients){const record=cacheRecords.get("client:"+client.id);if(!record?.complete)unknownClient=true;if(record?.path)protectedDocuments.add(record.path);for(const path of record?.assets||[])protectedAssets.add(path);}
  for(const [key,record]of [...cacheRecords])if(record.kind==="client"&&!liveIds.has(record.clientId))await deleteCacheRecord(key);
  const documents=[...cacheRecords].filter(([,record])=>record.kind==="document").sort((a,b)=>a[1].updatedAt-b[1].updatedAt),shell=await openCache(CACHE);let documentBytes=documents.reduce((sum,[,record])=>sum+record.bytes,0),documentCount=documents.length;
  const docEntryTarget=pressure?Math.min(cacheBudgets.documents.entries,Math.floor(documentCount/2)):cacheBudgets.documents.entries,docByteTarget=pressure?Math.min(cacheBudgets.documents.bytes,documentBytes/2):cacheBudgets.documents.bytes;
  for(const [key,record]of documents){if(protectedDocuments.has(record.path))continue;if(documentCount<=docEntryTarget&&documentBytes<=docByteTarget&&record.updatedAt>now-cacheBudgets.documents.age)continue;try{if(await shell?.delete?.(record.path)){documentBytes-=record.bytes;documentCount--;await deleteCacheRecord(key);}}catch{}}
  // Legacy documents get manifests before any of their dependencies can retire.
  if(shell?.keys)for(const request of await shell.keys()){const path=new URL(request.url).pathname;if(!documentPath(path)||validatedDocuments.has(path))continue;const response=await matchCache(shell,request);if(response){try{const html=await cachedDocumentText(response),old=cacheRecords.get("document:"+path);await rememberCacheRecord("document:"+path,{kind:"document",path,assets:documentAssets(html),bytes:new TextEncoder().encode(html).length,updatedAt:old?.updatedAt||now});validatedDocuments.add(path);}catch{unknownClient=true;}}}
  for(const record of cacheRecords.values())if(record.kind==="document")for(const path of record.assets||[])protectedAssets.add(path);
  for(const path of pendingDocumentAssets.keys())protectedAssets.add(path);
  for(const [name,budget]of [[ARTWORK,cacheBudgets.artwork],[ASSETS,cacheBudgets.assets]]){const cache=await openCache(name);if(!cache?.keys)continue;const keys=await cache.keys(),records=[];
   for(const request of keys){const url=new URL(request.url);if(name===ASSETS)url.search="";const key="resource:"+name+":"+url.href;let record=cacheRecords.get(key);if(!record){const response=await matchCache(cache,request),length=Number(response?.headers.get("Content-Length"));record={kind:"resource",name,url:url.href,bytes:Number.isFinite(length)&&length>0?length:256*1024,accessedAt:now};await rememberCacheRecord(key,record);}records.push({key,record,request,path:url.pathname});}
   let bytes=records.reduce((sum,value)=>sum+value.record.bytes,0),count=records.length;const entryTarget=pressure?Math.min(budget.entries,Math.floor(count/2)):budget.entries,byteTarget=pressure?Math.min(budget.bytes,bytes/2):budget.bytes;records.sort((a,b)=>a.record.accessedAt-b.record.accessedAt);
   for(const value of records){if(name===ASSETS&&(unknownClient||protectedAssets.has(value.path)))continue;if(count<=entryTarget&&bytes<=byteTarget&&value.record.accessedAt>now-budget.age)continue;try{if(await cache.delete(value.request)){bytes-=value.record.bytes;count--;await deleteCacheRecord(value.key);}}catch{}}
  }
  // Historical shell names are expendable only when no old tab can depend on
  // them and the current neutral shell has every required dependency saved.
  if(!clients.length&&!pendingDocumentAssets.size){const obsolete=(await caches.keys()).filter(name=>name!==CACHE&&/^sakura-ink-shell-v\d+$/.test(name));if(obsolete.length&&await usableDocument(shell,OFFLINE))for(const name of obsolete)await caches.delete?.(name);}
 })();cachePruning=work;try{await work;}finally{if(cachePruning===work)cachePruning=undefined;if(pruneAgain){pruneAgain=false;await pruneCacheStorage();}}
}
async function putCachedResource(cache,request,response,name){
 let bytes=0;const reader=response.body?.getReader(),maximum=name===ARTWORK?10*1024*1024:32*1024*1024;
 const body=reader?new ReadableStream({async pull(controller){try{const value=await reader.read();if(value.done){controller.close();return;}bytes+=value.value.byteLength;if(bytes>maximum)throw new Error("Resource exceeds the device cache limit.");controller.enqueue(value.value);}catch(error){controller.error(error);}},cancel(reason){return reader.cancel(reason);}}):null;
 const url=new URL(request.url);if(name===ASSETS)url.search="";
 try{await cache.put(new Request(url.href),new Response(body,{status:response.status,headers:response.headers}));}finally{if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
 await rememberCacheRecord("resource:"+name+":"+url.href,{kind:"resource",name,url:url.href,bytes,accessedAt:Date.now()});await pruneCacheStorage();
}
async function touchCachedResource(request,name){await loadCacheRecords();const url=new URL(request.url);if(name===ASSETS)url.search="";const key="resource:"+name+":"+url.href,record=cacheRecords.get(key);if(record&&record.accessedAt<Date.now()-60000)await rememberCacheRecord(key,{...record,accessedAt:Date.now()});}
async function timedFetch(input,options={}){
 const controller=new AbortController(),source=options.signal||(input instanceof Request?input.signal:null),abort=()=>controller.abort(source.reason);
 if(source?.aborted)abort();else source?.addEventListener("abort",abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new Error("The connection did not respond in time.")),15000);
 try{return await fetch(input,{...options,signal:controller.signal});}finally{clearTimeout(timer);source?.removeEventListener("abort",abort);}
}
/** Cached documents are bounded independently of the live network response. */
async function cachedDocumentText(response){
 const reader=response.body?.getReader();if(!reader)return "";
 const decoder=new TextDecoder();let bytes=0,text="",timer;
 const read=(async()=>{while(true){const value=await reader.read();if(value.done)return text+decoder.decode();bytes+=value.value.byteLength;if(bytes>8*1024*1024)throw new Error("The page exceeds the device cache limit.");text+=decoder.decode(value.value,{stream:true});}})();
 try{return await Promise.race([read,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("The page ended before it could be saved.")),15000);})]);}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function cacheableResource(request,response,name){
 if(!response.ok||response.status!==200||response.redirected)return false;
 const mime=(response.headers.get("Content-Type")||"").toLowerCase(),path=new URL(request.url).pathname;
 if(name===ARTWORK)return mime.startsWith("image/");
 if(name===ASSETS&&path.endsWith(".js"))return /(?:javascript|ecmascript)/.test(mime);
 if(name===ASSETS&&path.endsWith(".css"))return mime.startsWith("text/css");
 return !mime.includes("text/html")||name===CACHE;
}
async function cacheFirst(request,name,lifetime,durable=false){
 // Browser storage can be unavailable or full while the network still works.
 const cache=await openCache(name),saved=await matchCache(cache,request,{ignoreSearch:name===ASSETS});if(saved&&cacheableResource(request,saved,name)){const work=touchCachedResource(request,name).catch(()=>{});lifetime?.waitUntil?.(work);return saved;}
 const identity=new URL(request.url);if(name===ASSETS)identity.search="";
 const key=name+":"+identity.href;let flight=resourceFlights.get(key);
 if(!flight){
  // One consumer cancelling its image does not cancel another consumer's copy.
  flight=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error("The resource ended before it could be saved.")),15000);
   let response;
   try{response=await fetch(new Request(request,{signal:null}),{signal:controller.signal});}catch(error){clearTimeout(timer);throw error;}
   const work=(async()=>{try{if(cacheableResource(request,response,name)){const copy=response.clone();try{if(cache)await putCachedResource(cache,request,copy,name);else{const reader=copy.body?.getReader();if(reader)try{while(!(await reader.read()).done){/* Drain without a full-body allocation. */}}finally{reader.releaseLock();}}}catch(error){void copy.body?.cancel().catch(()=>{});if(cache&&error?.name==="QuotaExceededError"){await pruneCacheStorage(true).catch(()=>{});try{await putCachedResource(cache,request,response.clone(),name);}catch{}}}}}finally{clearTimeout(timer);}})();
   resourceDurability.set(key,work);
   void work.finally(()=>{if(resourceFlights.get(key)===flight){resourceFlights.delete(key);resourceDurability.delete(key);}setTimeout(()=>{void response.body?.cancel().catch(()=>{});},0);}).catch(()=>{});
   return response;
  })();
  resourceFlights.set(key,flight);void flight.catch(()=>{if(resourceFlights.get(key)===flight){resourceFlights.delete(key);resourceDurability.delete(key);}});
 }
 const response=(await flight).clone(),work=resourceDurability.get(key);
 if(lifetime?.waitUntil)lifetime.waitUntil(work||Promise.resolve());
 if(durable)await work;
 return response;
}
function documentAssets(html){return [...new Set(html.match(/\/_next\/static\/[^"\s<>\\]+\.(?:js|css|woff2?)/g)||[])];}
async function usableDocument(cache,path){
 const response=await matchCache(cache,path);if(!response)return;
 try{
  const assets=await openCache(ASSETS),critical=documentAssets(await cachedDocumentText(response.clone())).filter(path=>/\.(?:js|css)$/.test(path));
  for(const path of critical){const request=new Request(new URL(path,self.location.origin)),saved=await matchCache(assets,request,{ignoreSearch:true});if(!saved||!cacheableResource(request,saved,ASSETS))return;}
  return response;
 }catch{return undefined;}
}
async function commitDocument(cache,path,response){
 // A deployment is usable offline only after its critical modules and styles
 // are in durable storage. Failed warming must retain the previous document.
 if(!cache||!response.ok||response.redirected||!response.headers.get("Content-Type")?.includes("text/html"))return false;
 const html=await cachedDocumentText(response.clone());
 const assets=documentAssets(html),assetCache=await openCache(ASSETS);
 // A new document's dependencies must survive budget pruning until its
 // manifest replaces the old document. Concurrent warmups own separate pins.
 for(const path of assets)pendingDocumentAssets.set(path,(pendingDocumentAssets.get(path)||0)+1);
 try{
 const results=await Promise.allSettled(assets.map(async path=>{
  const request=new Request(new URL(path,self.location.origin)),critical=/\.(?:js|css)$/.test(path);
  const fetched=await cacheFirst(request,ASSETS,undefined,true),saved=await matchCache(assetCache,request,{ignoreSearch:true});
  if(critical&&(!cacheableResource(request,fetched,ASSETS)||!saved||!cacheableResource(request,saved,ASSETS)))throw new Error("A required page dependency could not be saved.");
 }));
 if(results.some((result,index)=>result.status==="rejected"&&/\.(?:js|css)$/.test(assets[index])))return false;
 try{await cache.put(path,response);await rememberCacheRecord("document:"+path,{kind:"document",path,assets,bytes:new TextEncoder().encode(html).length,updatedAt:Date.now()});validatedDocuments.add(path);return true;}catch{return false;}
 }finally{for(const path of assets){const owners=(pendingDocumentAssets.get(path)||1)-1;if(owners)pendingDocumentAssets.set(path,owners);else pendingDocumentAssets.delete(path);}await pruneCacheStorage().catch(()=>{});}
}
async function cacheDocument(path,refresh=false){
 if(!documentPath(path))return;const cache=await openCache(CACHE);if(!cache)return;
 if(!refresh&&await usableDocument(cache,path))return;
 let flight=documentFlights.get(path);if(flight)return flight;
 flight=(async()=>{
  const response=await timedFetch(path,{cache:"reload",credentials:"same-origin",headers:{Accept:"text/html"}});
  // Never persist an authentication redirect as an offline music page.
  try{if(!response.ok||response.redirected||!response.headers.get("Content-Type")?.includes("text/html"))return;
  return await commitDocument(cache,path,response);}finally{void response.body?.cancel().catch(()=>{});}
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
 await pruneCacheStorage().catch(()=>{});
})()));
self.addEventListener("fetch",event=>{
 const request=event.request;const url=new URL(request.url);
 if(["GET","HEAD"].includes(request.method)&&url.origin===self.location.origin&&url.pathname.startsWith(AUDIO_PREFIX)){event.respondWith(serveDeviceAudio(request,event.clientId,url.pathname.slice(AUDIO_PREFIX.length)));return;}
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 if(url.pathname==="/api/v2/image"){event.respondWith(cacheFirst(request,ARTWORK,event));return;}
 // Account JSON is persisted by Sakura's account-scoped resource store. RSC
 // responses vary by router state and must never share a URL-only cache.
 if(url.pathname.startsWith("/api/")||request.headers.has("RSC")||url.searchParams.has("_rsc"))return;
 if(request.mode==="navigate"){event.respondWith((async()=>{
  const cache=await openCache(CACHE);
  try{
   const response=await timedFetch(request);
   if(response.status>=500&&response.status<=599&&documentPath(url.pathname)){
    const saved=await usableDocument(cache,url.pathname)||musicPath(url.pathname)&&await usableDocument(cache,OFFLINE);if(saved)return saved;
   }
   if(response.ok&&!response.redirected&&documentPath(url.pathname)&&response.headers.get("Content-Type")?.includes("text/html")){
    const warming=commitDocument(cache,url.pathname,response.clone()).catch(()=>false);
    // Deliver online HTML immediately; the worker finishes the atomic cache
    // commit in the background without delaying the live page's first paint.
    event.waitUntil(warming);
   }
   return response;
  }catch{
   const saved=documentPath(url.pathname)&&await usableDocument(cache,url.pathname);if(saved)return saved;
   // Deliver the neutral client shell under the requested URL. Its offline
   // renderer opens that page using account-scoped data, preserving deep links.
   const offline=musicPath(url.pathname)&&await usableDocument(cache,OFFLINE);if(offline)return offline;
   return new Response("Open Sakura once while connected to prepare this device for offline listening.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  }
 })());return;}
 if(url.pathname.startsWith("/_next/static/")){event.respondWith(cacheFirst(request,ASSETS,event));return;}
 if(request.destination==="image"&&!url.pathname.startsWith("/icons/")&&url.pathname!=="/favicon.svg"){event.respondWith(cacheFirst(request,ARTWORK,event));return;}
 if(url.pathname.startsWith("/icons/")||["/manifest.json","/favicon.svg","/lyric-publish-worker.js"].includes(url.pathname))event.respondWith(cacheFirst(request,CACHE,event));
});
