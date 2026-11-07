/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-this-alias -- CommonJS worker generator retains its service instance across stream retries. */
const {Readable}=require("node:stream");
const {assessAudioCandidate,selectAudioCandidate}=require("./core/matching.js");
const {normalizeMetadataText,parseRecordingTitle}=require("./core/identity.js");
const {parseByteRange}=require("./core/streaming.js");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Newly written bot conversation and scoped streaming logic, using the existing socket owner. */
class RebuildAudioService {
 constructor({telegram,api,bigInt,bots,queue}){this.telegram=telegram;this.api=api;this.bigInt=bigInt;this.bots=new Set(bots.map(bot=>bot.toLowerCase()));this.queue=queue;this.documents=new Map();}
 scope(bot){if(typeof bot!=="string"||!this.bots.has(bot.toLowerCase()))throw new Error("Unknown worker chat scope");return bot.toLowerCase();}
 audio(message,bot){
  const document=message?.media?.document;
  if(!(document instanceof this.api.Document))return null;
  const attributes=document.attributes.find(item=>item instanceof this.api.DocumentAttributeAudio);
  if(!attributes||attributes.voice||!attributes.title||!attributes.performer)return null;
  const metadata={title:attributes.title,artists:[attributes.performer],durationMs:Number(attributes.duration)*1000};
  const audio={messageId:String(message.id),chatScope:bot,metadata,mimeType:document.mimeType,size:Number(document.size),fileId:String(document.id)};
  this.documents.set(`${bot}:${message.id}`,{audio,document});
  if(this.documents.size>1500)this.documents.delete(this.documents.keys().next().value);
  return audio;
 }
 candidate(audio){return {candidateId:audio.messageId,metadata:{...audio.metadata,artistsComplete:audio.metadata.artistsComplete??false},audioKind:"full",references:[{provider:"telegram",scope:audio.chatScope,id:audio.messageId}]};}
 async resolve(input){
  if(!input?.reference||!["deezer","spotify"].includes(input.reference.provider)||!input.metadata?.title||!Array.isArray(input.metadata.artists)||!input.metadata.artists.length||!input.metadata.durationMs)return {status:"unavailable",reason:"invalid-source-request"};
  const scopes=(Array.isArray(input.botScopes)?input.botScopes:[...this.bots]).map(bot=>this.scope(bot));
  const id=String(input.reference.id);
  if(input.reference.provider==="deezer"?!/^[1-9]\d{0,17}$/.test(id):!/^[A-Za-z0-9]{22}$/.test(id))return {status:"unavailable",reason:"invalid-source-reference"};
  if(this.queue.depth>=6)return {status:"unavailable",reason:"audio-worker-busy"};
  const requestedAt=Date.now();const deadline=requestedAt+Math.min(45000,Math.max(5000,Number(input.deadlineMs)||35000));
  return this.queue.run(async()=>{
   if(Date.now()>deadline-1000)return {status:"unavailable",reason:"audio-worker-queue-timeout"};
   const request={metadata:input.metadata};
   for(const bot of scopes){
    if(Date.now()>deadline-1000)break;
    const peer=await this.telegram().getEntity(bot);
    const recent=await this.telegram().getMessages(peer,{limit:24});
    const existing=recent.map(message=>this.audio(message,bot)).filter(Boolean).filter(audio=>assessAudioCandidate(request,this.candidate(audio)).acceptable);
    if(existing.length){const files=new Set(existing.map(audio=>audio.fileId));if(files.size===1||existing.length===1)return {status:"ready",audio:existing[0]};}
    const query=input.reference.provider==="deezer"?`https://www.deezer.com/track/${id}`:`https://open.spotify.com/track/${id}`;
    const sent=await this.telegram().sendMessage(peer,{message:query});
    let clicked=false;let seenAudio=[];
    while(Date.now()<deadline){
     await wait(700);
     const messages=await this.telegram().getMessages(peer,{limit:12,minId:sent.id});
     const fresh=messages.filter(message=>message.id>sent.id);
     const audio=fresh.map(message=>this.audio(message,bot)).filter(Boolean);
     if(audio.length){
      seenAudio=audio;const matched=audio.filter(item=>assessAudioCandidate(request,this.candidate(item)).acceptable);
      if(matched.length===1)return {status:"ready",audio:matched[0]};
      if(matched.length>1&&new Set(matched.map(item=>item.fileId)).size===1)return {status:"ready",audio:matched[0]};
      return {status:"review",candidates:audio.map(item=>({title:item.metadata.title,artists:item.metadata.artists,durationMs:item.metadata.durationMs,reasons:assessAudioCandidate(request,this.candidate(item)).reasons}))};
     }
     if(fresh.some(message=>/daily.{0,20}limit|rate.?limit|no results|not found|join.{0,25}channel/i.test(message.message||"")))break;
     if(!clicked){
      const buttonMessage=fresh.find(message=>message.replyMarkup instanceof this.api.ReplyInlineMarkup);
      if(buttonMessage){
       const buttons=buttonMessage.replyMarkup.rows.flatMap(row=>row.buttons).filter(button=>button instanceof this.api.KeyboardButtonCallback);
       const candidates=buttons.map((button,index)=>buttonCandidate(button.text,index,input.metadata)).filter(Boolean);
       const selected=selectAudioCandidate(request,candidates);
       if(selected.status!=="matched")return {status:"review",candidates:buttons.map(button=>({title:button.text,artists:[],durationMs:null,reasons:["ambiguous-source-button"]}))};
       const button=buttons[Number(selected.candidate.candidateId)];
       await this.telegram().invoke(new this.api.messages.GetBotCallbackAnswer({peer,msgId:buttonMessage.id,data:Buffer.from(button.data)}));
       clicked=true;
      }
     }
    }
    if(seenAudio.length)break;
   }
   return {status:"unavailable",reason:"audio-source-unavailable"};
  });
 }
 async info(bot,messageId,refresh=false){
  const scope=this.scope(bot);if(!/^[1-9]\d{0,14}$/.test(String(messageId)))throw new Error("Invalid source message ID");
  const key=`${scope}:${messageId}`;
  if(!refresh&&this.documents.has(key))return this.documents.get(key);
  const peer=await this.telegram().getEntity(scope);const messages=await this.telegram().getMessages(peer,{ids:[Number(messageId)]});
  const audio=this.audio(messages[0],scope);if(!audio)throw new Error("Source audio not found");return this.documents.get(key);
 }
 async stream(bot,messageId,start,length){
  let cached=await this.info(bot,messageId);const {size}=cached.audio;
  const aligned=Math.floor(start/4096)*4096;const skip=start-aligned;const chunks=Math.max(1,Math.ceil((skip+length)/(512*1024)));const self=this;
  const iterator=()=>self.telegram().iterDownload({file:new self.api.InputDocumentFileLocation({id:cached.document.id,accessHash:cached.document.accessHash,fileReference:cached.document.fileReference,thumbSize:""}),dcId:cached.document.dcId,fileSize:self.bigInt(size),offset:self.bigInt(aligned),limit:chunks,requestSize:512*1024,chunkSize:512*1024});
  async function* body(){let sent=0,toSkip=skip,retried=false;while(true){try{for await(const raw of iterator()){let part=Buffer.from(raw);if(toSkip){const trim=Math.min(toSkip,part.length);part=part.subarray(trim);toSkip-=trim;}if(!part.length)continue;part=part.subarray(0,length-sent);sent+=part.length;yield part;if(sent===length)return;}if(sent!==length)throw new Error("Source stream was truncated");return;}catch(error){if(!sent&&!retried&&/FILE_REFERENCE|FILEREF/i.test(String(error?.message||error))){cached=await self.info(bot,messageId,true);retried=true;toSkip=skip;continue;}throw error;}}}
  return Readable.from(body(),{objectMode:false});
 }
 async serve(req,res,bot,messageId){
  const {audio}=await this.info(bot,messageId);const range=parseByteRange(req.method==="HEAD"?null:req.headers.range||null,audio.size);
  const headers={"Content-Type":audio.mimeType,"Cache-Control":"private, max-age=3600","Accept-Ranges":"bytes","X-Audio-Size":String(audio.size),"Access-Control-Allow-Origin":"*","Access-Control-Expose-Headers":"Content-Length, Content-Range, X-Audio-Size"};
  if(range.status==="unsatisfiable"){res.writeHead(416,{...headers,"Content-Range":`bytes */${audio.size}`});res.end();return;}
  const start=range.status==="range"?range.start:0,end=range.status==="range"?range.end:audio.size-1,length=end-start+1;
  res.writeHead(range.status==="range"?206:200,{...headers,"Content-Length":String(length),...(range.status==="range"?{"Content-Range":`bytes ${start}-${end}/${audio.size}`}:{})});
  if(req.method==="HEAD"){res.end();return;}
  const stream=await this.stream(bot,messageId,start,length);res.on("close",()=>stream.destroy());stream.on("error",()=>res.destroy());stream.pipe(res);
 }
}

function buttonCandidate(label,index,expected){
 const duration=/[([](\d{1,2}):(\d{2})[)\]]/.exec(label);if(!duration)return null;
 let text=label.replace(duration[0]," ").replace(/\[?(?:\d{2,4}\s*(?:kbps|k)|flac|mp3)\]?/gi," ").replace(/^\s*\d+[.)]\s*/,"").trim();
 const artist=expected.artists[0];const parts=text.split(/\s[-–—]\s/);
 if(parts.length>=2){if(normalizeMetadataText(parts[0])===normalizeMetadataText(artist))text=parts.slice(1).join(" - ");else if(normalizeMetadataText(parts[parts.length-1])===normalizeMetadataText(artist))text=parts.slice(0,-1).join(" - ");else return null;}
 else{const at=text.toLowerCase().indexOf(artist.toLowerCase());if(at<0)return null;text=(text.slice(0,at)+text.slice(at+artist.length)).replace(/^\s*[-–—:]+|[-–—:]+\s*$/g,"").trim();}
 const parsed=parseRecordingTitle(text);if(!parsed.base)return null;
 return {candidateId:String(index),metadata:{title:text,artists:[artist],artistsComplete:false,durationMs:(Number(duration[1])*60+Number(duration[2]))*1000},audioKind:"full"};
}
module.exports={RebuildAudioService,buttonCandidate};
