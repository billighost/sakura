/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-this-alias -- This deployable CommonJS service owns scoped Telegram streams. */
const {Readable}=require("node:stream");
const {createHash}=require("node:crypto");
const {assessAudioCandidate,verifiedRecordingAliases}=require("./core/matching.js");
const {normalizeMetadataText,normalizedRecording,parseRecordingTitle,referenceKey,isRecordingProofReference}=require("./core/identity.js");
const {parseByteRange}=require("./core/streaming.js");
const CHUNK=512*1024,ALIGN=4096,MAX_AUDIO=120*1024*1024;
const AUDIO_MIMES=new Set(["audio/mpeg","audio/mp3","audio/mp4","audio/aac","audio/flac","audio/x-flac","audio/ogg","audio/opus","audio/wav","audio/x-wav","audio/webm"]);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sourceId=reference=>reference?.provider==="deezer"?/^[1-9]\d{0,17}$/.test(String(reference.id)):reference?.provider==="spotify"&&/^[A-Za-z0-9]{22}$/.test(String(reference.id));
const sourceUrl=reference=>reference.provider==="deezer"?`https://www.deezer.com/track/${reference.id}`:`https://open.spotify.com/track/${reference.id}`;
const terminalMessage=text=>/daily.{0,30}limit|rate.?limit|limit reached|join.{0,30}channel|must.{0,15}join|subscribe|подпис|лимит/iu.test(text);
const noResult=text=>/no results?|not found|nothing found|no tracks|unsupported|не найден|見つかりません|没有找到|未找到/iu.test(text);

/** Searches share the existing socket. Only conversations in the same chat
 * serialize; independent chats and byte streams can proceed concurrently. */
class RebuildAudioService {
 constructor({telegram,api,bigInt,bots,queue,queueFor,ensureConnected,onFatal,recoverMetadata,metrics,pollIntervalMs=650,now=Date.now,sleep=wait}){
  this.telegram=telegram;this.api=api;this.bigInt=bigInt;this.bots=new Set(bots.map(bot=>bot.toLowerCase()));
  this.queue=queue;this.queueFor=queueFor;this.ensureConnected=ensureConnected;this.pollIntervalMs=pollIntervalMs;this.now=now;this.sleep=sleep;
  this.onFatal=onFatal;
  this.metrics=metrics;
  this.recoverMetadata=recoverMetadata;this.metadataFlights=new Map();this.metadataRecovered=new Map();
  this.documents=new Map();this.documentFlights=new Map();this.peerFlights=new Map();this.resolveFlights=new Map();this.resolved=new Map();
 }
 scope(bot){if(typeof bot!=="string"||!this.bots.has(bot.toLowerCase()))throw new Error("Unknown worker chat scope");return bot.toLowerCase();}
 async peer(bot){
  if(!this.peerFlights.has(bot)){
   const promise=Promise.resolve().then(()=>this.telegram().getEntity(bot));this.peerFlights.set(bot,promise);
   promise.catch(()=>{if(this.peerFlights.get(bot)===promise)this.peerFlights.delete(bot);});
  }
  return this.peerFlights.get(bot);
 }
 forgetSource(bot,messageId){
  this.documents.delete(`${bot}:${messageId}`);
  for(const [key,value] of this.resolved)if(value.audio.chatScope===bot&&value.audio.messageId===String(messageId))this.resolved.delete(key);
 }
 audio(message,bot){
  const document=message?.media?.document;
  if(message?.out||!(document instanceof this.api.Document))return null;
  const attributes=document.attributes?.find(item=>item instanceof this.api.DocumentAttributeAudio);
  const size=Number(document.size),mimeType=String(document.mimeType||"").split(";")[0].trim().toLowerCase();
  if(!attributes||attributes.voice||typeof attributes.title!=="string"||!attributes.title.trim()||typeof attributes.performer!=="string"||!attributes.performer.trim()||!Number.isFinite(Number(attributes.duration))||Number(attributes.duration)<=0||!Number.isSafeInteger(size)||size<4096||size>MAX_AUDIO||!AUDIO_MIMES.has(mimeType)||!/^[1-9]\d{0,14}$/.test(String(message.id)))return null;
  const metadata={title:attributes.title,artists:[attributes.performer],artistsComplete:false,durationMs:Math.round(Number(attributes.duration)*1000)};
  const audio={messageId:String(message.id),chatScope:bot,metadata,mimeType,size,fileId:String(document.id)};
  const key=`${bot}:${message.id}`,entry=this.documents.get(key),previous=entry?.audio,rawMetadata=metadata;
  if(previous&&previous.fileId===audio.fileId&&previous.size===audio.size&&previous.mimeType===audio.mimeType&&entry.rawMetadata&&JSON.stringify(entry.rawMetadata)===JSON.stringify(rawMetadata))audio.metadata=previous.metadata;
  if(previous&&(previous.fileId!==audio.fileId||previous.size!==audio.size||previous.mimeType!==audio.mimeType||JSON.stringify(previous.metadata)!==JSON.stringify(audio.metadata)))this.forgetSource(bot,message.id);
  this.documents.delete(key);this.documents.set(key,{audio,document,rawMetadata,checkedAt:this.now()});
  if(this.documents.size>1500)this.documents.delete(this.documents.keys().next().value);
  return audio;
 }
 candidate(audio){return {candidateId:audio.messageId,metadata:audio.metadata,audioKind:"full",references:[{provider:"telegram",scope:audio.chatScope,id:audio.messageId}]};}
 async recover(audio){
  if(!this.recoverMetadata)return audio;
  const key=`${audio.chatScope}:${audio.messageId}:${audio.fileId}`;
  if((this.metadataRecovered.get(key)||0)>this.now())return this.documents.get(`${audio.chatScope}:${audio.messageId}`)?.audio||audio;
  if(!this.metadataFlights.has(key)){
   let recovered=false;
   const flight=Promise.resolve().then(()=>this.recoverMetadata(audio)).then(metadata=>{
    const cached=this.documents.get(`${audio.chatScope}:${audio.messageId}`);
    if(metadata&&cached?.audio.fileId===audio.fileId){recovered=true;cached.audio={...cached.audio,metadata};return cached.audio;}
    return audio;
   }).catch(()=>audio).finally(()=>{this.metadataFlights.delete(key);this.metadataRecovered.set(key,this.now()+(recovered?3600000:30000));if(this.metadataRecovered.size>1500)this.metadataRecovered.delete(this.metadataRecovered.keys().next().value);});
   this.metadataFlights.set(key,flight);
  }
  return this.metadataFlights.get(key);
 }
 select(request,audios){
  const matched=audios.filter(audio=>assessAudioCandidate(request,this.candidate(audio)).acceptable);
  const files=new Map(matched.map(audio=>[audio.fileId,audio]));
  return files.size===1?[...files.values()][0]:null;
 }
 review(request,audios){return audios.map(audio=>({title:audio.metadata.title,artists:audio.metadata.artists,durationMs:audio.metadata.durationMs,reasons:assessAudioCandidate(request,this.candidate(audio)).reasons}));}
 async resolve(input){
  const metadata=input?.metadata;
  if(!sourceId(input?.reference)||typeof metadata?.title!=="string"||!metadata.title.trim()||metadata.title.length>500||!Array.isArray(metadata.artists)||!metadata.artists.length||metadata.artists.length>20||metadata.artists.some(value=>typeof value!=="string"||!value.trim()||value.length>300)||!Number.isSafeInteger(metadata.durationMs)||metadata.durationMs<=0||metadata.durationMs>86400000)return {status:"unavailable",reason:"invalid-source-request"};
  if(input.references!==undefined&&(!Array.isArray(input.references)||input.references.length>20))return {status:"unavailable",reason:"invalid-source-reference"};
  if(metadata.verifiedAliases!==undefined&&(!Array.isArray(metadata.verifiedAliases)||metadata.verifiedAliases.length>32))return {status:"unavailable",reason:"invalid-source-request"};
  if(input.botScopes!==undefined&&(!Array.isArray(input.botScopes)||input.botScopes.length>20))return {status:"unavailable",reason:"invalid-source-request"};
  const requestedScopes=Array.isArray(input.botScopes)?input.botScopes:[...this.bots];
  const scopes=[...new Set(requestedScopes.filter(bot=>typeof bot==="string"&&this.bots.has(bot.toLowerCase())).map(bot=>bot.toLowerCase()))];
  if(!scopes.length)return {status:"unavailable",reason:"audio-worker-unknown-scope"};
  const proofReferences=[input.reference,...(input.references||[])].filter(isRecordingProofReference);
  const references=[...new Map(proofReferences.filter(sourceId).map(reference=>[JSON.stringify([reference.provider,String(reference.id)]),{provider:reference.provider,id:String(reference.id)}])).values()];
  const proofKeys=[...new Set(proofReferences.map(referenceKey))].sort();
  const request={metadata,references:proofReferences},key=JSON.stringify([proofKeys,normalizedRecording(metadata),metadata.artistsComplete??null,metadata.verifiedAliases??null,scopes]);
  const deadline=this.now()+Math.min(45000,Math.max(5000,Number(input.deadlineMs)||35000));
  const cached=this.resolved.get(key);
  if(cached&&this.now()-cached.at<600000&&assessAudioCandidate(request,this.candidate(cached.audio)).acceptable)return {status:"ready",audio:cached.audio};
  if(this.resolveFlights.has(key))return this.waitResolve(this.resolveFlights.get(key),deadline);
  if(!this.queueFor&&this.queue?.depth>=6)return {status:"unavailable",reason:"audio-worker-busy"};
  const flight=this.resolveFresh(request,references,scopes,deadline).then(result=>{
   if(result.status==="ready"&&this.now()>=deadline)return {status:"unavailable",reason:"audio-source-unavailable",attempts:result.attempts||[]};
   if(result.status==="ready"){this.resolved.delete(key);this.resolved.set(key,{at:this.now(),audio:result.audio});if(this.resolved.size>500)this.resolved.delete(this.resolved.keys().next().value);}
   return result;
  }).finally(()=>{if(this.resolveFlights.get(key)===flight)this.resolveFlights.delete(key);});
  this.resolveFlights.set(key,flight);
  return this.waitResolve(flight,deadline);
 }
 async waitResolve(flight,deadline){
  const expired={status:"unavailable",reason:"audio-worker-timeout",retryable:true};
  if(this.now()>=deadline)return expired;
  let timer;
  // Expiring a caller must not release the active chat or remove its shared
  // flight. A late RPC still settles under the original source deadline.
  try{
   const result=await Promise.race([flight,new Promise(resolve=>{timer=setTimeout(()=>resolve(expired),Math.max(1,deadline-this.now()));})]);
   return result.status==="ready"&&this.now()>=deadline?expired:result;
  }finally{clearTimeout(timer);}
 }
 async resolveFresh(request,references,scopes,deadline){
  const reviews=[],attempts=[];let busy=false;
  for(let at=0;at<scopes.length;at++){
   if(this.now()>=deadline-500)break;
   const bot=scopes[at],queue=this.queueFor?.(bot)||this.queue;
   if(queue?.depth>=6){busy=true;continue;}
   const botDeadline=this.now()+Math.floor((deadline-this.now())/(scopes.length-at));
   const operation=async()=>{
    if(this.now()>=botDeadline-500)return {status:"unavailable",reason:"audio-worker-queue-timeout"};
    if(this.ensureConnected)await this.ensureConnected();
    if(this.now()>=botDeadline)return {status:"unavailable",reason:"audio-worker-queue-timeout"};
    const peer=await this.peer(bot);
    if(this.now()>=botDeadline)return {status:"unavailable",reason:"audio-worker-queue-timeout"};
    const recent=await this.telegram().getMessages(peer,{limit:64});
    if(this.now()>=botDeadline)return {status:"unavailable",reason:"audio-worker-queue-timeout"};
    const known=[...this.documents.values()].filter(value=>value.audio.chatScope===bot).map(value=>value.audio);
    let audios=[...new Map([...known,...recent.map(message=>this.audio(message,bot)).filter(Boolean)].map(audio=>[audio.fileId,audio])).values()];
    // Do not inspect every historical file. A bounded number of truncated
    // candidates may recover their own embedded tags before strict matching.
    let recovered=0;
    audios=await Promise.all(audios.map(audio=>/…|\.{3}/u.test([audio.metadata.title,...audio.metadata.artists].join(" "))&&recovered++<2?this.recover(audio):audio));
    const audio=this.select(request,audios);if(audio)return {status:"ready",audio};
    const queries=searchQueries(request.metadata,references,request.references);
    for(let index=0;index<queries.length;index++){
     const remaining=botDeadline-this.now();if(remaining<500)break;
     const queryDeadline=this.now()+Math.floor(remaining/(queries.length-index));
     const result=await this.conversation(peer,bot,queries[index],request,queryDeadline);
     attempts.push({chatScope:bot,strategy:queries[index].startsWith("https:")?"catalog-link":"exact-metadata",outcome:result.status});
     if(result.status==="ready")return result;
     reviews.push(...(result.candidates||[]));
     if(result.terminal)break;
    }
    return {status:"unavailable"};
   };
   try{const result=queue?await queue.run(operation,{deadline:botDeadline}):await operation();if(result.status==="ready"&&this.now()<botDeadline)return {...result,attempts};}
   catch(error){
    if(/AUTH_KEY_DUPLICATED/.test(String(error?.errorMessage||error?.message||error))){this.onFatal?.(error);throw error;}
    attempts.push({chatScope:bot,strategy:"catalog-link",outcome:/FLOOD_WAIT|rate.?limit/i.test(String(error?.message||error))?"rate-limited":"source-error"});
   }
  }
  const unique=[...new Map(reviews.map(candidate=>[JSON.stringify([candidate.title,candidate.artists,candidate.durationMs,candidate.reasons]),candidate])).values()].slice(0,12);
  return unique.length?{status:"review",candidates:unique,attempts}:{status:"unavailable",reason:busy?"audio-worker-busy":"audio-source-unavailable",attempts};
 }
 async conversation(peer,bot,query,request,deadline){
  if(this.now()>=deadline)return {status:"unavailable"};
  const sent=await this.telegram().sendMessage(peer,{message:query});
  if(this.now()>=deadline)return {status:"unavailable"};
  const seen=new Map(),processedButtons=new Set();let clickedAt=0;const clicked=new Set();
  while(this.now()<deadline){
   await this.sleep(Math.min(this.pollIntervalMs,Math.max(1,deadline-this.now())));
   if(this.now()>=deadline)break;
   const messages=await this.telegram().getMessages(peer,{limit:32,minId:sent.id});
   if(this.now()>=deadline)break;
   const fresh=messages.filter(message=>message?.id>sent.id&&!message.out).sort((a,b)=>a.id-b.id);
   let recovered=0;
   for(const message of fresh){let audio=this.audio(message,bot);if(audio&&/…|\.{3}/u.test([audio.metadata.title,...audio.metadata.artists].join(" "))&&recovered++<2)audio=await this.recover(audio);if(audio)seen.set(audio.fileId,audio);}
   const audio=this.select(request,[...seen.values()]);if(audio)return {status:"ready",audio};
   if(fresh.some(message=>terminalMessage(message.message||"")))return {status:"unavailable",terminal:true,candidates:this.review(request,[...seen.values()])};
   if(fresh.some(message=>noResult(message.message||""))&&!seen.size)return {status:"unavailable"};
   for(const message of fresh){
    if(!(this.api.ReplyInlineMarkup&&message.replyMarkup instanceof this.api.ReplyInlineMarkup))continue;
    const buttons=message.replyMarkup.rows.flatMap(row=>row.buttons).filter(button=>button instanceof this.api.KeyboardButtonCallback);
    const signature=JSON.stringify([message.id,buttons.map(button=>[button.text,Buffer.from(button.data||[]).toString("base64")])]);
    if(processedButtons.has(signature))continue;
    const ranked=buttons.map((button,index)=>buttonCandidate(button.text,index,request.metadata)).filter(Boolean)
     .map(candidate=>({candidate,assessment:assessAudioCandidate(request,candidate)}))
     .filter(value=>value.assessment.acceptable||value.assessment.reasons.every(reason=>reason==="missing-duration")||inspectionCandidate(value.candidate,request))
     .sort((a,b)=>b.assessment.score-a.assessment.score||(b.candidate.bitrateKbps||0)-(a.candidate.bitrateKbps||0));
    if(!ranked.length){processedButtons.add(signature);continue;}
    if(clickedAt&&this.now()-clickedAt<Math.min(2000,this.pollIntervalMs*3))continue;
    const selected=ranked.find(value=>!clicked.has(`${signature}:${value.candidate.candidateId}`));
    if(!selected){processedButtons.add(signature);continue;}
    // Button text chooses a file to inspect. Serving still requires the
    // received file's own title, credits, version and duration to pass.
    if(this.now()>=deadline)break;
    const button=buttons[Number(selected.candidate.candidateId)];clicked.add(`${signature}:${selected.candidate.candidateId}`);clickedAt=this.now();
    try{await this.telegram().invoke(new this.api.messages.GetBotCallbackAnswer({peer,msgId:message.id,data:Buffer.from(button.data)}));}
    catch(error){if(!/BOT_RESPONSE_TIMEOUT/.test(String(error?.errorMessage||error?.message||error)))throw error;}
    break;
   }
   if(seen.size&&[...seen.values()].every(value=>!assessAudioCandidate(request,this.candidate(value)).acceptable)&&(!fresh.some(message=>message.replyMarkup)||clicked.size>=3))break;
  }
  return seen.size?{status:"review",candidates:this.review(request,[...seen.values()])}:{status:"unavailable"};
 }
 async info(bot,messageId,refresh=false){
  const scope=this.scope(bot);if(!/^[1-9]\d{0,14}$/.test(String(messageId)))throw new Error("Invalid source message ID");
  const key=`${scope}:${messageId}`,cached=this.documents.get(key);
  if(!refresh&&cached&&this.now()-cached.checkedAt<600000)return cached;
  if(this.documentFlights.has(key))return this.documentFlights.get(key);
  const flight=(async()=>{if(this.ensureConnected)await this.ensureConnected();const peer=await this.peer(scope),messages=await this.telegram().getMessages(peer,{ids:[Number(messageId)]});const audio=this.audio(messages[0],scope);if(!audio){this.forgetSource(scope,messageId);throw new Error("Source audio not found");}if(/…|\.{3}/u.test([audio.metadata.title,...audio.metadata.artists].join(" ")))await this.recover(audio);return this.documents.get(key);})().catch(error=>{if(/AUTH_KEY_DUPLICATED/.test(String(error?.errorMessage||error?.message||error)))this.onFatal?.(error);throw error;});
  this.documentFlights.set(key,flight);try{return await flight;}finally{if(this.documentFlights.get(key)===flight)this.documentFlights.delete(key);}
 }
 async stream(bot,messageId,start,length,expectedAudio){
  let cached=await this.info(bot,messageId);const original={...cached.audio};
  // A forced refresh can replace the cached document after serve validated it.
  // Bind the opening document to that snapshot before sending its headers.
  if(expectedAudio&&!sameSource(original,expectedAudio))throw new Error("Source file changed before transfer");
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(length)||length<=0||start+length>original.size)throw new Error("Invalid source byte range");
  const self=this;let stream;
  async function* body(){
   let sent=0,retries=0;
   while(sent<length&&!stream.destroyed){
    const position=start+sent,aligned=Math.floor(position/ALIGN)*ALIGN;let skip=position-aligned;
    // Tiny probes and parallel client chunks should not each fetch 512 KiB.
    // Telegram accepts power-of-two request sizes in 4 KiB granularity.
    const requestSize=Math.min(CHUNK,2**Math.ceil(Math.log2(Math.max(ALIGN,skip+length-sent))));
    const chunks=Math.max(1,Math.ceil((skip+length-sent)/requestSize));
    let download;
    try{
     download=self.telegram().iterDownload({file:new self.api.InputDocumentFileLocation({id:cached.document.id,accessHash:cached.document.accessHash,fileReference:cached.document.fileReference,thumbSize:""}),dcId:cached.document.dcId,fileSize:self.bigInt(original.size),offset:self.bigInt(aligned),limit:chunks,requestSize,chunkSize:requestSize});
     for await(const raw of download){
      if(stream.destroyed)return;
      let part=Buffer.from(raw);if(skip){const trim=Math.min(skip,part.length);part=part.subarray(trim);skip-=trim;}
      if(!part.length)continue;part=part.subarray(0,length-sent);sent+=part.length;self.metrics?.count("transfer_bytes",part.length);yield part;if(sent===length)return;
     }
     throw new Error("Source stream was truncated");
    }catch(error){
     if(/AUTH_KEY_DUPLICATED/.test(String(error?.errorMessage||error?.message||error))){self.onFatal?.(error);throw error;}
     if(stream.destroyed)return;
     const detail=[error?.code,error?.errorMessage,error?.message].filter(Boolean).join(" ")||String(error);
     const referenceExpired=/FILE_REFERENCE|FILEREF/i.test(detail);
     const interrupted=/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|ERR_SOCKET_CLOSED|socket|network|Not connected|Disconnect|TIMEOUT|Source stream was truncated/i.test(detail);
     if(retries<2&&(referenceExpired||interrupted)){
      retries++;
      // Resume the exact unsent suffix after a transient socket failure. The
      // refreshed document must still match the one whose headers were sent.
      if(!referenceExpired){await self.sleep(400*retries);if(stream.destroyed)return;}
      cached=await self.info(bot,messageId,true);
      if(stream.destroyed)return;
      if(!sameSource(cached.audio,original))throw new Error("Source file changed during transfer");
      continue;
     }
     throw error;
    }finally{if(typeof download?.return==="function")await Promise.resolve(download.return()).catch(()=>{});}
   }
  }
  stream=Readable.from(body(),{objectMode:false});return stream;
 }
 async serve(req,res,bot,messageId){
  const {audio}=await this.info(bot,messageId);
  const etag=`"${createHash("sha256").update(JSON.stringify([audio.chatScope,audio.messageId,audio.fileId,audio.size,audio.mimeType])).digest("hex")}"`;
  const useRange=req.method!=="HEAD"&&(!req.headers["if-range"]||req.headers["if-range"]===etag);
  const range=parseByteRange(useRange?req.headers.range||null:null,audio.size);
  const headers={"Content-Type":audio.mimeType,"Cache-Control":"private, max-age=3600","Accept-Ranges":"bytes","ETag":etag,"X-Audio-Size":String(audio.size),"X-Content-Type-Options":"nosniff","Access-Control-Allow-Origin":"*","Access-Control-Expose-Headers":"Content-Length, Content-Range, Accept-Ranges, ETag, X-Audio-Size"};
  const ifMatch=req.headers["if-match"];
  if(ifMatch&&ifMatch!=="*"&&!String(ifMatch).split(",").map(value=>value.trim()).includes(etag)){res.writeHead(412,{...headers,"Content-Length":"0"});res.end();return;}
  if(range.status==="unsatisfiable"){res.writeHead(416,{...headers,"Content-Range":`bytes */${audio.size}`});res.end();return;}
  const start=range.status==="range"?range.start:0,end=range.status==="range"?range.end:audio.size-1,length=end-start+1;
  if(req.method==="HEAD"){res.writeHead(200,{...headers,"Content-Length":String(length)});res.end();return;}
  const stream=await this.stream(bot,messageId,start,length,audio);
  if(res.destroyed||req.aborted){stream.destroy();return;}
  const close=()=>stream.destroy();res.on("close",close);
  stream.on("error",()=>res.destroy());stream.on("close",()=>res.removeListener("close",close));
  res.writeHead(range.status==="range"?206:200,{...headers,"Content-Length":String(length),...(range.status==="range"?{"Content-Range":`bytes ${start}-${end}/${audio.size}`}:{})});
  stream.pipe(res);
 }
}

function sameSource(first,second){
 const identity=audio=>JSON.stringify([audio.chatScope,audio.messageId,audio.fileId,audio.size,audio.mimeType,audio.metadata]);
 return identity(first)===identity(second);
}

function searchQueries(metadata,references,proofReferences=references){
 const queriesFor=value=>{
  const labels=value.version?.labels||[],parsed=parseRecordingTitle(value.title);
  let title=value.title.normalize("NFKC").replace(/\s+/g," ").trim();
  const extra=labels.filter(label=>label&&!parsed.version.labels.includes(normalizeMetadataText(label)));
  if(extra.length)title+=` (${extra.join("; ")})`;
  else if(!parsed.version.kinds.length&&value.version?.kinds?.length)title+=` (${value.version.kinds.join("; ")})`;
  const credits=value.artists.map(artist=>artist.normalize("NFKC").trim());
  return [`${title} ${credits.join(" ")}`,`${credits[0]} ${title}`];
 };
 const canonical=queriesFor(metadata),aliases=verifiedRecordingAliases({metadata,references:proofReferences}).map(alias=>queriesFor(alias.metadata));
 return [...new Set([...references.slice(0,3).map(sourceUrl),...(aliases.length?[aliases[0][0]]:[]),canonical[0],...aliases.slice(1).map(query=>query[0]),canonical[1],...aliases.map(query=>query[1])])].slice(0,6);
}

function buttonCandidate(label,index,expected){
 if(typeof label!=="string")return null;
 let text=label.normalize("NFKC");
 const duration=/(?:[([]|\b)(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[)\]]|\b)/u.exec(text);
 if(duration&&Number(duration[3])>59)return null;
 if(duration)text=text.replace(duration[0]," ");
 const bitrate=/\b(\d{2,4})\s*(?:kbps|kbit\/s|k)\b/iu.exec(text);
 text=text.replace(/\[?\b(?:\d{2,4}\s*(?:kbps|kbit\/s|k)|flac|mp3|aac|m4a)\b\]?/giu," ").replace(/^[^\p{L}\p{N}]*/u,"").replace(/^\s*\d+[.)]\s*/,"").replace(/\s*[|·]\s*$/u,"").trim();
 const parts=text.split(/\s[-–—|:]\s/u);let title,performer;
 const known=normalizedRecording(expected).artists;
 const artistPart=value=>{const info=normalizedRecording({title:"candidate",artists:[value]},known);return info.primaryArtist===known[0]&&info.artists.every(artist=>known.includes(artist))||truncatedPrefix(value,known[0]);};
 if(parts.length>=2){
  if(artistPart(parts[0])){performer=parts[0];title=parts.slice(1).join(" - ");}
  else if(artistPart(parts[parts.length-1])){performer=parts[parts.length-1];title=parts.slice(0,-1).join(" - ");}
  else return null;
 }else{
  const artist=expected.artists[0].normalize("NFKC"),at=text.toLowerCase().indexOf(artist.toLowerCase());
  if(at<0)return null;performer=text.slice(at,at+artist.length);title=(text.slice(0,at)+text.slice(at+artist.length)).replace(/^\s*[-–—:]+|[-–—:]+\s*$/gu,"").trim();
 }
 if(!parseRecordingTitle(title).base)return null;
 return {candidateId:String(index),metadata:{title,artists:[performer],artistsComplete:false,durationMs:duration?(Number(duration[1]||0)*3600+Number(duration[2])*60+Number(duration[3]))*1000:null},audioKind:/\b(?:preview|clip|snippet)\b/iu.test(label)?"preview":"full",...(bitrate?{bitrateKbps:Number(bitrate[1])}:{})};
}
function truncatedPrefix(value,expected){
 if(typeof value!=="string"||!/(?:…|\.{3})\s*$/u.test(value))return false;
 const prefix=normalizeMetadataText(value.replace(/(?:…|\.{3})\s*$/u,""));
 return prefix.length>=12&&expected.startsWith(prefix);
}
function inspectionCandidate(candidate,request){
 if(!candidate)return false;
 const assessment=assessAudioCandidate(request,candidate),want=normalizedRecording(request.metadata);
 if(!assessment.reasons.every(reason=>["title","artist","missing-duration"].includes(reason)))return false;
 return (!assessment.reasons.includes("title")||truncatedPrefix(candidate.metadata.title,want.title))&&(!assessment.reasons.includes("artist")||truncatedPrefix(candidate.metadata.artists[0],want.primaryArtist));
}
module.exports={RebuildAudioService,buttonCandidate,searchQueries,inspectionCandidate};
