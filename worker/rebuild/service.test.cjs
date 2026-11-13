/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS worker tests use Node's native runner. */
const assert=require("node:assert/strict"),{test}=require("node:test");
const {RebuildAudioService,buttonCandidate,searchQueries,inspectionCandidate}=require("./service.cjs");
const {assessAudioCandidate}=require("./core/matching.js");
class Document{constructor(value){Object.assign(this,value);}}
class DocumentAttributeAudio{constructor(value){Object.assign(this,value);}}
const api={Document,DocumentAttributeAudio};
function message(title="Finesse",artist="Bruno Mars",duration=191,size=5000){return{id:42,media:{document:new Document({id:123,accessHash:456,fileReference:Buffer.from("ref"),dcId:1,size,mimeType:"audio/mpeg",attributes:[new DocumentAttributeAudio({title,performer:artist,duration})]})}};}
function service(client,options={}){return new RebuildAudioService({telegram:()=>client,api,bigInt:Number,bots:["primary","fallback"],queue:{depth:0,run:operation=>operation()},...options});}
test("truncated message metadata recovers only from complete file tags and survives reference refresh",async()=>{
 let reads=0;const metadata={title:"A sufficiently long recording title",artists:["Bruno Mars"],durationMs:191000};
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message("A sufficiently long…")];}}, {recoverMetadata:async()=>{reads++;return metadata;}});
 const input={reference:{provider:"deezer",id:"123"},metadata,botScopes:["primary"]};
 const first=await backend.resolve(input);assert.equal(first.status,"ready");assert.equal(reads,1);
 const refreshed=await backend.info("primary","42",true);assert.equal(refreshed.audio.metadata.title,metadata.title);assert.equal(reads,1);
});
test("a displayed prefix permits inspection but cannot authorize audio or a wrong edition",()=>{
 const request={metadata:{title:"A sufficiently long recording title",artists:["Bruno Mars"],durationMs:191000}};
 const candidate=buttonCandidate("Bruno Mars - A sufficiently long… [03:11]",0,request.metadata);
 assert.equal(inspectionCandidate(candidate,request),true);assert.equal(assessAudioCandidate(request,candidate).acceptable,false);
 const remix=buttonCandidate("Bruno Mars - A sufficiently long… (Remix) [03:11]",1,request.metadata);assert.equal(inspectionCandidate(remix,request),false);
});
test("worker uses scoped document identities for equal message IDs in different chats",async()=>{
 const client={async getEntity(bot){return bot;},async getMessages(bot){return[message(bot==="primary"?"Finesse":"Other",bot==="primary"?"Bruno Mars":"Other Artist")];}};
 const backend=service(client);assert.equal((await backend.info("primary","42")).audio.metadata.title,"Finesse");assert.equal((await backend.info("fallback","42")).audio.metadata.title,"Other");assert.equal(backend.documents.size,2);
 await assert.rejects(backend.info("unknown","42"),/Unknown worker chat/);
});
test("verified recent original streams without triggering a bot search",async()=>{
 let sent=0;const backend=service({async getEntity(){return"peer";},async getMessages(){return[message()];},async sendMessage(){sent++;}});
 const result=await backend.resolve({reference:{provider:"deezer",id:"123"},metadata:{title:"Finesse",artists:["Bruno Mars"],durationMs:191000},botScopes:["primary"]});
 assert.equal(result.status,"ready");assert.equal(sent,0);
});
test("worker recognizes exact combined performer credits while refusing wrong guests",async()=>{
 let sent=0;const backend=service({async getEntity(){return"peer";},async getMessages(){return[message("INERTIA","SawanoHiroyuki[nZk], REI",199)];},async sendMessage(){sent++;}});
 const input={reference:{provider:"deezer",id:"3284976751"},metadata:{title:"INERTIA",artists:["SawanoHiroyuki[nZk]","Rei"],durationMs:199486},botScopes:["primary"]};
 const result=await backend.resolve(input);assert.equal(result.status,"ready");assert.equal(sent,0);
 assert.equal(assessAudioCandidate(input,{candidateId:"wrong",audioKind:"full",metadata:{...input.metadata,artists:["SawanoHiroyuki[nZk], Wrong Guest"]}}).acceptable,false);
});
test("source buttons retain remix tags and reject artist-only or wrong-version matches",()=>{
 const expected={title:"Finesse",artists:["Bruno Mars"],durationMs:191000};
 const original=buttonCandidate("Bruno Mars - Finesse [03:11] [320kbps]",0,expected);const remix=buttonCandidate("Bruno Mars - Finesse (Remix) [03:37] [320kbps]",1,expected);
 assert.equal(assessAudioCandidate({metadata:expected},original).acceptable,true);assert.equal(assessAudioCandidate({metadata:expected},remix).acceptable,false);
 assert.equal(buttonCandidate("Wrong Artist - Finesse [03:11]",2,expected),null);
});
test("worker refuses oversized source queue before any Telegram API calls",async()=>{
 const backend=service({});backend.queue.depth=6;
 const result=await backend.resolve({reference:{provider:"deezer",id:"123"},metadata:{title:"Finesse",artists:["Bruno Mars"],durationMs:191000},botScopes:["primary"]});assert.equal(result.reason,"audio-worker-busy");
});
test("fresh worker rejects malformed provider references instead of searching text",async()=>{
 const backend=service({});const result=await backend.resolve({reference:{provider:"deezer",id:"../bad"},metadata:{title:"Finesse",artists:["Bruno Mars"],durationMs:191000},botScopes:["primary"]});assert.equal(result.status,"unavailable");
});

test("scoped worker trims a suffix stream from Telegram's aligned byte offset",async()=>{
 const bytes=Buffer.alloc(10000);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 const client={async getEntity(){return"peer";},async getMessages(){return[message("Finesse","Bruno Mars",191,bytes.length)];},async *iterDownload(options){assert.equal(options.offset,8192);assert.equal(options.limit,1);assert.equal(options.requestSize,4096);yield bytes.subarray(options.offset);}};
 const backend=service(client);backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 const stream=await backend.stream("primary","42",9990,10);const parts=[];for await(const chunk of stream)parts.push(chunk);
 assert.deepEqual(Buffer.concat(parts),bytes.subarray(9990));
});

for(const length of [256*1024,2*1024*1024+17])test(`GramJS emits the opening 32 KiB of a ${length}-byte response while later bytes are pending`,async()=>{
 const {Api}=require("telegram"),{iterDownload}=require("telegram/client/downloads"),bigInt=require("big-integer");
 const bytes=Buffer.alloc(2*1024*1024+17);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 let release;const pending=new Promise(resolve=>{release=resolve;}),requests=[];
 const sender={dcId:1},client={_log:{info(){},debug(){},warn(){}},
  async getEntity(){return"peer";},async getMessages(){return[message("Finesse","Bruno Mars",191,bytes.length)];},
  async getSender(){return sender;},async invokeWithSender(request){
   assert.ok(request instanceof Api.upload.GetFile);
   const offset=request.offset.toJSNumber();requests.push({offset,length:request.limit});
   if(offset)await pending;
   return new Api.upload.File({bytes:bytes.subarray(offset,offset+request.limit)});
  },iterDownload(options){return iterDownload(this,options);}};
 const backend=service(client,{bigInt,api:{...api,InputDocumentFileLocation:Api.InputDocumentFileLocation}});
 const stream=await backend.stream("primary","42",0,length),iterator=stream[Symbol.asyncIterator](),parts=[];
 try{
  const first=await iterator.next();assert.equal(first.done,false);assert.equal(first.value.length,32*1024);parts.push(first.value);
  assert.deepEqual(first.value,bytes.subarray(0,32*1024));assert.deepEqual(requests[0],{offset:0,length:32*1024});
 }finally{release();}
 for(let next=await iterator.next();!next.done;next=await iterator.next())parts.push(next.value);
 assert.deepEqual(Buffer.concat(parts),bytes.subarray(0,length));
 let offset=0;for(const request of requests){assert.equal(request.offset,offset,"No already-emitted opening bytes are downloaded again");offset+=request.length;}
 assert.deepEqual(requests.slice(0,4),[{offset:0,length:32768},{offset:32768,length:32768},{offset:65536,length:65536},{offset:131072,length:131072}]);
 if(length>512*1024)assert.deepEqual(requests[5],{offset:512*1024,length:512*1024},"Bulk transfer keeps the large request size");
});

test("opening-prefix interruption resumes exact bytes and keeps the document retry bound",async()=>{
 const bytes=Buffer.alloc(800000);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 let reads=0,attempts=0;const offsets=[],sleeps=[];
 const backend=service({async getEntity(){return"peer";},async getMessages(){reads++;return[message("Finesse","Bruno Mars",191,bytes.length)];},
  async *iterDownload(options){
   offsets.push(options.offset);if(++attempts===2)throw Object.assign(new Error("Interrupted"),{code:"ECONNRESET"});
   for(let chunk=0;chunk<options.limit;chunk++){
    const offset=options.offset+chunk*options.requestSize,part=bytes.subarray(offset,offset+options.requestSize);if(!part.length)return;yield part;
   }
  }},{sleep:async ms=>{sleeps.push(ms);},api:{...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}}});
 const parts=[];for await(const chunk of await backend.stream("primary","42",0,bytes.length))parts.push(chunk);
 assert.deepEqual(Buffer.concat(parts),bytes);assert.deepEqual(offsets.slice(0,3),[0,32768,32768]);assert.equal(reads,2);assert.deepEqual(sleeps,[400]);
});

for(const {start,length,playback} of [...[159628,334168,75074].map(start=>({start,length:128*1024,playback:false})),{start:256*1024,length:256*1024,playback:true},{start:256*1024,length:1024*1024,playback:true}])test(`GramJS streams opening audio at ${start} before completing its ${length}-byte playback window`,async()=>{
 const {Api}=require("telegram"),{iterDownload}=require("telegram/client/downloads"),bigInt=require("big-integer");
 const bytes=Buffer.alloc(2*1024*1024+17);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 const deliveredPrefix=playback&&length>512*1024?576*1024:32*1024;
 const requests=[],sender={dcId:1};let release;
 const pending=new Promise(resolve=>{release=resolve;}),client={_log:{info(){},debug(){},warn(){}},
  async getEntity(){return"peer";},async getMessages(){return[message("Finesse","Bruno Mars",191,bytes.length)];},
  async getSender(){return sender;},async invokeWithSender(request){
   assert.ok(request instanceof Api.upload.GetFile);const offset=request.offset.toJSNumber();requests.push({offset,length:request.limit});
   if(offset>=start+deliveredPrefix)await pending;
   return new Api.upload.File({bytes:bytes.subarray(offset,offset+request.limit)});
  },iterDownload(options){return iterDownload(this,options);}};
 const backend=service(client,{bigInt,api:{...api,InputDocumentFileLocation:Api.InputDocumentFileLocation}});
 const stream=await backend.stream("primary","42",start,length,undefined,{playback}),iterator=stream[Symbol.asyncIterator](),parts=[];let received=0;
 try{
  while(received<deliveredPrefix){const next=await iterator.next();assert.equal(next.done,false);parts.push(next.value);received+=next.value.length;}
  assert.ok(received<length,"Earlier audio arrives while the window's later RPCs are held");
  assert.deepEqual(Buffer.concat(parts),bytes.subarray(start,start+received));assert.ok(requests[0].length<=32*1024);
 }finally{release();}
 for(let next=await iterator.next();!next.done;next=await iterator.next())parts.push(next.value);
 assert.deepEqual(Buffer.concat(parts),bytes.subarray(start,start+length));
 let offset=Math.floor(start/4096)*4096;for(const request of requests){assert.equal(request.offset,offset,"GramJS must not refetch previous media blocks to trim the tag offset");offset+=request.length;}
 if(playback)assert.ok(requests.every(request=>request.length<=64*1024),"Playback RPCs stay bounded after the opening instead of growing back to full chunks");
});

test("ordinary later 256 KiB durable chunks keep the single bulk request",async()=>{
 const bytes=Buffer.alloc(800000,7),requests=[];
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message("Finesse","Bruno Mars",191,bytes.length)];},
  async *iterDownload(options){requests.push({offset:options.offset,requestSize:options.requestSize,limit:options.limit});yield bytes.subarray(options.offset,options.offset+options.requestSize);}
 },{api:{...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}}});
 const parts=[];for await(const part of await backend.stream("primary","42",256*1024,256*1024))parts.push(part);
 assert.deepEqual(Buffer.concat(parts),bytes.subarray(256*1024,512*1024));assert.deepEqual(requests,[{offset:256*1024,requestSize:256*1024,limit:1}]);
});

test("GramJS sparse-window interruption resumes after the trimmed ID3 offset without replaying audio",async()=>{
 const {Api}=require("telegram"),{iterDownload}=require("telegram/client/downloads"),bigInt=require("big-integer");
 const bytes=Buffer.alloc(800000);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 const start=334168,length=128*1024,requests=[],sleeps=[],sender={dcId:1};let reads=0;
 const client={_log:{info(){},debug(){},warn(){}},async getEntity(){return"peer";},
  async getMessages(){reads++;return[message("Finesse","Bruno Mars",191,bytes.length)];},async getSender(){return sender;},
  async invokeWithSender(request){
   const offset=request.offset.toJSNumber();requests.push(offset);
   if(requests.length===2)throw Object.assign(new Error("Interrupted"),{code:"ECONNRESET"});
   return new Api.upload.File({bytes:bytes.subarray(offset,offset+request.limit)});
  },iterDownload(options){return iterDownload(this,options);}};
 const backend=service(client,{bigInt,sleep:async ms=>{sleeps.push(ms);},api:{...api,InputDocumentFileLocation:Api.InputDocumentFileLocation}});
 const parts=[];for await(const part of await backend.stream("primary","42",start,length))parts.push(part);
 assert.deepEqual(Buffer.concat(parts),bytes.subarray(start,start+length));assert.deepEqual(requests.slice(0,3),[331776,335872,335872]);
 assert.equal(reads,2);assert.deepEqual(sleeps,[400]);
});

test("scoped worker HEAD returns verified size without opening an audio transfer",async()=>{
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message()];},iterDownload(){throw new Error("HEAD must not transfer audio");}});
 let status,headers,ended=false;
 await backend.serve({method:"HEAD",headers:{range:"bytes=-10"}},{writeHead(code,value){status=code;headers=value;},end(){ended=true;}},"primary","42");
 assert.equal(status,200);assert.equal(headers["Content-Length"],"5000");assert.equal(headers["Content-Type"],"audio/mpeg");assert.equal(ended,true);
});

const originalInput=()=>({reference:{provider:"deezer",id:"123"},metadata:{title:"Finesse",artists:["Bruno Mars"],durationMs:191000},botScopes:["primary"]});
function clockOptions(){let at=10000;return{pollIntervalMs:20,now:()=>at,sleep:async ms=>{at+=ms;}};}

test("one duplicate resolve flight and warm cache do not send repeated bot searches",async()=>{
 let sent=0,queries=0;const backend=service({async getEntity(){return"peer";},async getMessages(_peer,options){queries++;return options.minId?[message()]:[];},async sendMessage(){sent++;return{id:1};}},clockOptions());
 const [first,second]=await Promise.all([backend.resolve(originalInput()),backend.resolve(originalInput())]);
 assert.equal(first.status,"ready");assert.equal(second.audio.fileId,first.audio.fileId);assert.equal(sent,1);
 const before=queries;assert.equal((await backend.resolve(originalInput())).status,"ready");assert.equal(queries,before);assert.equal(sent,1);
});

test("a wrong primary recording does not stop exact fallback-chat discovery",async()=>{
 const searched=[];const backend=service({async getEntity(bot){return bot;},async getMessages(bot,options){if(bot==="fallback")return[message()];return options.minId?[message("Finesse (Remix)","Bruno Mars",217)]:[];},async sendMessage(bot){searched.push(bot);return{id:1};}},clockOptions());
 const result=await backend.resolve({...originalInput(),botScopes:["primary","fallback"]});
 assert.equal(result.status,"ready");assert.equal(result.audio.chatScope,"fallback");assert.ok(searched.includes("primary"));
});

test("an unsupported catalogue link tries the exact alternate provider reference",async()=>{
 let query="";const sent=[];const backend=service({async getEntity(){return"peer";},async getMessages(_peer,options){if(!options.minId)return[];return query.includes("spotify")?[message()]:[{id:41,message:"Unsupported link"}];},async sendMessage(_peer,options){query=options.message;sent.push(query);return{id:1};}},clockOptions());
 const result=await backend.resolve({...originalInput(),references:[{provider:"spotify",id:"1234567890123456789012"}]});
 assert.equal(result.status,"ready");assert.deepEqual(sent,["https://www.deezer.com/track/123","https://open.spotify.com/track/1234567890123456789012"]);
});

test("native Japanese exact text can recover after a catalog link returns wrong audio",async()=>{
 let query="";const sent=[];const expected={title:"夜に駆ける",artists:["YOASOBI"],durationMs:261000};
 const backend=service({async getEntity(){return"peer";},async getMessages(_peer,options){if(!options.minId)return[];return[query.startsWith("https:")?message("群青","YOASOBI",261):message("夜に駆ける","YOASOBI",261)];},async sendMessage(_peer,options){query=options.message;sent.push(query);return{id:1};}},clockOptions());
 const result=await backend.resolve({...originalInput(),metadata:expected});assert.equal(result.status,"ready");assert.equal(result.audio.metadata.title,expected.title);assert.ok(sent.includes("夜に駆ける YOASOBI"));
});

test("final failure retains wrong-version evidence while rejecting every mismatch",async()=>{
 const backend=service({async getEntity(){return"peer";},async getMessages(_peer,options){return options.minId?[message("Finesse (Pink Panda Remix)","Bruno Mars",191)]:[];},async sendMessage(){return{id:1};}},clockOptions());
 const result=await backend.resolve(originalInput());assert.equal(result.status,"review");assert.ok(result.candidates[0].reasons.includes("version"));assert.equal(result.attempts.length,3);
});

test("bot search queries retain all native credits and requested named mix",()=>{
 const queries=searchQueries({title:"夜に駆ける",artists:["YOASOBI","宇多田ヒカル"],version:{kinds:["remix"],labels:["Ayase Remix"]}},[{provider:"deezer",id:"12"}]);
 assert.ok(queries.includes("夜に駆ける (Ayase Remix) YOASOBI 宇多田ヒカル"));assert.ok(queries.every(query=>!query.includes("undefined")));
});

test("button probes preserve combined credits, Unicode width and significant named versions",()=>{
 const expected={title:"INERTIA",artists:["SawanoHiroyuki[nZk]","Rei"],durationMs:199486};
 const candidate=buttonCandidate("１. SawanoHiroyuki[nZk], REI — ＩＮＥＲＴＩＡ [03:19] [320kbps]",1,expected);
 assert.equal(assessAudioCandidate({metadata:expected},candidate).acceptable,true);
 assert.equal(buttonCandidate("Wrong Primary - INERTIA [03:19]",0,expected),null);
 const remix=buttonCandidate("Bruno Mars — Finesse (Pink Panda Remix) [03:11]",0,originalInput().metadata);
 assert.ok(assessAudioCandidate(originalInput(),remix).reasons.includes("version"));
});

test("an exact button without duration is a probe and actual audio still proves duration",async()=>{
 class ReplyInlineMarkup{constructor(rows){this.rows=rows;}}
 class KeyboardButtonCallback{constructor(text){this.text=text;this.data=Buffer.from("exact");}}
 class GetBotCallbackAnswer{constructor(value){Object.assign(this,value);}}
 let clicked=false;const backend=service({async getEntity(){return"peer";},async sendMessage(){return{id:1};},async getMessages(_peer,options){if(!options.minId)return[];return clicked?[message()]:[{id:2,replyMarkup:new ReplyInlineMarkup([{buttons:[new KeyboardButtonCallback("Bruno Mars - Finesse [320kbps]")]}])}];},async invoke(){clicked=true;}},{...clockOptions(),api:{...api,ReplyInlineMarkup,KeyboardButtonCallback,messages:{GetBotCallbackAnswer}}});
 const result=await backend.resolve(originalInput());assert.equal(clicked,true);assert.equal(result.status,"ready");assert.equal(result.audio.metadata.durationMs,191000);
});

test("source metadata refuses voice, unknown MIME, zero duration and oversized files",()=>{
 const backend=service({});
 for(const change of [{mimeType:"application/octet-stream"},{size:121*1024*1024},{attributes:[new DocumentAttributeAudio({title:"Finesse",performer:"Bruno Mars",duration:0})]},{attributes:[new DocumentAttributeAudio({title:"Finesse",performer:"Bruno Mars",duration:191,voice:true})]}]){
  const value=message();Object.assign(value.media.document,change);assert.equal(backend.audio(value,"primary"),null);
 }
});

test("parallel info probes coalesce one scoped document lookup",async()=>{
 let read=0;const backend=service({async getEntity(){return"peer";},async getMessages(){read++;await Promise.resolve();return[message()];}});
 const values=await Promise.all([backend.info("primary","42"),backend.info("primary","42"),backend.info("primary","42")]);
 assert.equal(read,1);assert.equal(values[0].audio.fileId,values[2].audio.fileId);
});

test("expired file references resume after emitted bytes without replaying them",async()=>{
 const bytes=Buffer.alloc(12000,7);let downloads=0;
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message("Finesse","Bruno Mars",191,bytes.length)];},async *iterDownload(options){downloads++;if(downloads===1){yield bytes.subarray(options.offset,5000);throw new Error("FILE_REFERENCE_EXPIRED");}assert.equal(options.offset,4096);yield bytes.subarray(options.offset);}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 const stream=await backend.stream("primary","42",0,bytes.length);const chunks=[];for await(const chunk of stream)chunks.push(chunk);
 assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(downloads,2);
});

for(const interruption of ["socket","truncated","opening"])test(`transient ${interruption} failure resumes the exact verified suffix`,async()=>{
 const bytes=Buffer.alloc(12000);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 let downloads=0,reads=0;const offsets=[],sleeps=[];
 const backend=service({async getEntity(){return"peer";},async getMessages(){reads++;return[message("Finesse","Bruno Mars",191,bytes.length)];},iterDownload(options){
  const attempt=++downloads;offsets.push(options.offset);
  if(interruption==="opening"&&attempt===1)throw new Error("Not connected");
  return(async function*(){
   if(attempt===1){yield bytes.subarray(options.offset,5000);if(interruption==="socket")throw Object.assign(new Error("Transport failed"),{code:"ECONNRESET"});return;}
   yield bytes.subarray(options.offset);
  })();
 }},{sleep:async ms=>{sleeps.push(ms);}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 const chunks=[];for await(const chunk of await backend.stream("primary","42",123,10000))chunks.push(chunk);
 assert.deepEqual(Buffer.concat(chunks),bytes.subarray(123,10123));
 assert.deepEqual(offsets,interruption==="opening"?[0,0]:[0,4096]);assert.equal(reads,2);assert.deepEqual(sleeps,[400]);
});

test("transient transfer retries stop after three failed attempts without progress",async()=>{
 let downloads=0,reads=0;const sleeps=[];
 const backend=service({async getEntity(){return"peer";},async getMessages(){reads++;return[message()];},async *iterDownload(){downloads++;throw new Error("ETIMEDOUT");}},{sleep:async ms=>{sleeps.push(ms);}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 await assert.rejects(async()=>{for await(const chunk of await backend.stream("primary","42",0,5000))assert.ok(chunk);},/ETIMEDOUT/);
 assert.equal(downloads,3);assert.equal(reads,3);assert.deepEqual(sleeps,[400,800]);
});

test("transient recovery refuses a replaced document before opening its suffix",async()=>{
 let downloads=0,reads=0;
 const backend=service({async getEntity(){return"peer";},async getMessages(){const value=message("Finesse","Bruno Mars",191,10000);if(++reads>1)value.media.document.id=789;return[value];},async *iterDownload(){downloads++;yield Buffer.alloc(5000);throw new Error("socket closed");}},{sleep:async()=>{}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 await assert.rejects(async()=>{for await(const chunk of await backend.stream("primary","42",0,10000))assert.ok(chunk);},/Source file changed/);
 assert.equal(downloads,1);assert.equal(reads,2);
});

test("terminal transfer failures do not reconnect or retry",async()=>{
 for(const detail of ["AUTH_KEY_DUPLICATED","FILE_ID_INVALID","FLOOD_WAIT_30"]){
  let downloads=0,reads=0,fatal=0;const sleeps=[];
  const backend=service({async getEntity(){return"peer";},async getMessages(){reads++;return[message()];},async *iterDownload(){downloads++;throw new Error(detail);}},{onFatal:()=>{fatal++;},sleep:async ms=>{sleeps.push(ms);}});
  backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
  await assert.rejects(async()=>{for await(const chunk of await backend.stream("primary","42",0,5000))assert.ok(chunk);},error=>error.message===detail);
  assert.equal(downloads,1);assert.equal(reads,1);assert.deepEqual(sleeps,[]);assert.equal(fatal,detail==="AUTH_KEY_DUPLICATED"?1:0);
 }
});

test("caller disconnect during retry backoff cannot refresh or restart a transfer",async()=>{
 const {Writable}=require("node:stream"),{once}=require("node:events");
 let reads=0,downloads=0,backoffStarted,finishBackoff;
 const backoffEntered=new Promise(resolve=>{backoffStarted=resolve;}),backoffPending=new Promise(resolve=>{finishBackoff=resolve;});
 const backend=service({async getEntity(){return"peer";},async getMessages(){reads++;return[message("Finesse","Bruno Mars",191,10000)];},async *iterDownload(){downloads++;yield Buffer.alloc(4096,7);throw new Error("ECONNRESET");}},{sleep:async()=>{backoffStarted();await backoffPending;}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 const response=new Writable({write(_chunk,_encoding,done){done();}});response.writeHead=()=>{};
 const originalStream=backend.stream.bind(backend);let transfer;backend.stream=async(...args)=>{transfer=await originalStream(...args);return transfer;};
 await backend.serve({method:"GET",headers:{}},response,"primary","42");await backoffEntered;
 const closed=once(transfer,"close");response.destroy();await new Promise(resolve=>setImmediate(resolve));assert.equal(transfer.destroyed,true);
 finishBackoff();await closed;assert.equal(downloads,1);assert.equal(reads,1);
});

test("file-reference refresh rejects a replaced document before mixing its bytes",async()=>{
 let reads=0;const backend=service({async getEntity(){return"peer";},async getMessages(){const value=message("Finesse","Bruno Mars",191,10000);if(++reads>1)value.media.document.id=789;return[value];},async *iterDownload(){yield Buffer.alloc(5000);throw new Error("FILE_REFERENCE_EXPIRED");}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 const stream=await backend.stream("primary","42",0,10000);await assert.rejects(async()=>{for await(const chunk of stream)assert.ok(chunk.length);},/Source file changed/);
});

test("unknown configured fallback scopes do not disable a valid primary scope",async()=>{
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message()];}});
 assert.equal((await backend.resolve({...originalInput(),botScopes:["primary","not_deployed_bot"]})).status,"ready");
 assert.equal((await backend.resolve({...originalInput(),botScopes:["not_deployed_bot"]})).reason,"audio-worker-unknown-scope");
});

test("a stale document precondition rejects before any audio transfer",async()=>{
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message()];},iterDownload(){throw new Error("Must not transfer changed audio");}});
 let code,headers,ended=false;
 await backend.serve({method:"GET",headers:{range:"bytes=0-9","if-match":"\"old-document\"","if-range":"\"old-document\""}},{writeHead(status,value){code=status;headers=value;},end(){ended=true;}},"primary","42");
 assert.equal(code,412);assert.equal(ended,true);assert.equal(headers["Content-Length"],"0");assert.ok(/^"[a-f0-9]{64}"$/.test(headers.ETag));
});

test("serve refuses a concurrent source replacement after validating its ETag",async()=>{
 const {Writable}=require("node:stream"),{finished}=require("node:stream/promises");
 let fileId=123,downloads=0;const backend=service({async getEntity(){return"peer";},async getMessages(){const value=message();value.media.document.id=fileId;return[value];},async *iterDownload(){downloads++;yield Buffer.alloc(5000,9);}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 let etag;await backend.serve({method:"HEAD",headers:{}},{writeHead(_code,headers){etag=headers.ETag;},end(){}},"primary","42");
 const stream=backend.stream.bind(backend);
 backend.stream=async(...args)=>{fileId=789;await backend.info("primary","42",true);return stream(...args);};
 let headersSent=false;const response=new Writable({write(_chunk,_encoding,done){done();}});
 response.writeHead=()=>{headersSent=true;};
 await assert.rejects(async()=>{await backend.serve({method:"GET",headers:{range:"bytes=0-4999","if-match":etag}},response,"primary","42");await finished(response);},/Source file changed/);
 assert.equal(headersSent,false);assert.equal(downloads,0);
});

test("serve keeps exact conditional ranges when the same document's reference refreshes",async()=>{
 const {Writable}=require("node:stream"),{finished}=require("node:stream/promises");
 const bytes=Buffer.alloc(5000);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 let reference="old",downloads=0;const backend=service({async getEntity(){return"peer";},async getMessages(){const value=message();value.media.document.fileReference=Buffer.from(reference);return[value];},async *iterDownload(options){downloads++;assert.equal(options.file.id,123);assert.equal(options.file.fileReference.toString(),"fresh");yield bytes.subarray(options.offset);}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 let etag;await backend.serve({method:"HEAD",headers:{}},{writeHead(_code,headers){etag=headers.ETag;},end(){}},"primary","42");
 const stream=backend.stream.bind(backend);
 backend.stream=async(...args)=>{reference="fresh";await backend.info("primary","42",true);return stream(...args);};
 for(const [ifRange,status,expected]of [[etag,206,bytes.subarray(4990)],["\"older-document\"",200,bytes]]){
  const parts=[];let headers;const response=new Writable({write(chunk,_encoding,done){parts.push(Buffer.from(chunk));done();}});
  response.writeHead=(code,value)=>{assert.equal(code,status);headers=value;};
  await backend.serve({method:"GET",headers:{range:"bytes=-10","if-range":ifRange,"if-match":"\"other\", "+etag}},response,"primary","42");await finished(response);
  assert.equal(headers.ETag,etag);assert.equal(headers["Content-Length"],String(expected.length));assert.deepEqual(Buffer.concat(parts),expected);
  assert.equal(headers["Content-Range"],status===206?"bytes 4990-4999/5000":undefined);
 }
 assert.equal(downloads,2);
});

test("file-reference refresh rejects changed recording tags before resuming",async()=>{
 let reads=0,downloads=0;const backend=service({async getEntity(){return"peer";},async getMessages(){return[message(++reads===1?"Finesse":"Finesse (Remix)","Bruno Mars",191,10000)];},async *iterDownload(){downloads++;yield Buffer.alloc(5000);throw new Error("FILE_REFERENCE_EXPIRED");}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 const stream=await backend.stream("primary","42",0,10000);let received=0;
 await assert.rejects(async()=>{for await(const chunk of stream)received+=chunk.length;},/Source file changed/);
 assert.equal(received,5000);assert.equal(downloads,1);
});

test("a refreshed replacement document invalidates the successful resolve cache",async()=>{
 let fileId=123;const backend=service({async getEntity(){return"peer";},async getMessages(){const value=message();value.media.document.id=fileId;return[value];}});
 assert.equal((await backend.resolve(originalInput())).audio.fileId,"123");fileId=456;
 await backend.info("primary","42",true);
 assert.equal((await backend.resolve(originalInput())).audio.fileId,"456");
});

test("fatal session errors stop resolution and notify the existing socket owner",async()=>{
 let fatal=0;const backend=service({async getEntity(){throw new Error("AUTH_KEY_DUPLICATED");}},{onFatal:()=>fatal++});
 await assert.rejects(backend.resolve({...originalInput(),botScopes:["primary","fallback"]}),/AUTH_KEY_DUPLICATED/);assert.equal(fatal,1);
});

function nativeInput(){
 const reference={provider:"spotify",id:"1fPkUiufkRpzdYcBKXUP3s"},isrc={provider:"isrc",id:"JPB602501985"};
 return {reference,references:[reference,isrc],botScopes:["primary"],metadata:{title:"咆哮 - HOKO",artists:["TOMONARI SORA"],artistsComplete:true,durationMs:209766,verifiedAliases:[{references:[isrc],metadata:{title:"HOKO",artists:["友成空"],artistsComplete:true,durationMs:209000}}]}};
}

test("worker consumes authorized localized metadata using retained ISRC proof",async()=>{
 let sent=0;const backend=service({async getEntity(){return"peer";},async getMessages(){return[message("HOKO","友成空",209)];},async sendMessage(){sent++;return{id:1};}},clockOptions());
 const result=await backend.resolve(nativeInput());assert.equal(result.status,"ready");assert.equal(result.audio.metadata.title,"HOKO");assert.equal(sent,0);
});

test("worker does not coalesce requests whose authorized spelling evidence differs",async()=>{
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message("HOKO","友成空",209)];},async sendMessage(){return{id:1};}},clockOptions());
 const input=nativeInput();const [without,withProof]=await Promise.all([backend.resolve({...input,metadata:{...input.metadata,verifiedAliases:undefined}}),backend.resolve(input)]);
 assert.notEqual(without.status,"ready");assert.equal(withProof.status,"ready");
});

test("native search spellings are used only with shared authoritative identity",()=>{
 const input=nativeInput(),queries=searchQueries(input.metadata,[input.reference],input.references);
 assert.ok(queries.includes("HOKO 友成空"));
 assert.equal(searchQueries(input.metadata,[input.reference],[]).includes("HOKO 友成空"),false);
 const wrong=JSON.parse(JSON.stringify(input));wrong.metadata.verifiedAliases[0].references[0].id="JPB602501986";
 assert.equal(searchQueries(wrong.metadata,[input.reference],input.references).includes("HOKO 友成空"),false);
});

test("conflicting request proof never shares a successful localized resolution flight",async()=>{
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message("HOKO","友成空",209)];},async sendMessage(){return{id:1};}},clockOptions());
 const input=nativeInput(),wrong={...input,references:[input.reference,{provider:"isrc",id:"JPB602501986"}]};
 const [good,bad]=await Promise.all([backend.resolve(input),backend.resolve(wrong)]);assert.equal(good.status,"ready");assert.notEqual(bad.status,"ready");
});

test("malformed optional matching proof is discarded without failing the source request",async()=>{
 const backend=service({async getEntity(){return"peer";},async getMessages(){return[message()];}});
 const result=await backend.resolve({...originalInput(),references:[{provider:"musicbrainz",id:"not-a-uuid",scope:42},null]});assert.equal(result.status,"ready");
});

test("expired connection, peer and recent lookup results stop before further source work",async()=>{
 for(const stage of ["connection","peer","recent"]){
  let now=10000,peers=0,reads=0,sends=0;
  const backend=service({async getEntity(){peers++;if(stage==="peer")now=15000;return"peer";},async getMessages(){reads++;if(stage==="recent")now=15000;return[message()];},async sendMessage(){sends++;return{id:1};}},{now:()=>now,ensureConnected:async()=>{if(stage==="connection")now=15000;}});
  assert.equal((await backend.resolve({...originalInput(),deadlineMs:5000})).status,"unavailable",stage);
  assert.equal(peers,stage==="connection"?0:1,stage);assert.equal(reads,stage==="recent"?1:0,stage);assert.equal(sends,0,stage);
  assert.equal(backend.documents.size,0,stage);assert.equal(backend.resolved.size,0,stage);
 }
});

test("conversation deadlines fence the initial send, late send and expired poll sleep",async()=>{
 for(const stage of ["initial","send","sleep"]){
  let now=stage==="initial"?10100:10000,sends=0,reads=0;
  const backend=service({async sendMessage(){sends++;if(stage==="send")now=10100;return{id:1};},async getMessages(){reads++;return[message()];}},{now:()=>now,sleep:async()=>{now=10100;},pollIntervalMs:20});
  assert.equal((await backend.conversation("peer","primary","Finesse Bruno Mars",originalInput(),10100)).status,"unavailable",stage);
  assert.equal(sends,stage==="initial"?0:1,stage);assert.equal(reads,0,stage);assert.equal(backend.documents.size,0,stage);
 }
});

test("late poll results cannot accept audio or click returned selection buttons",async()=>{
 class ReplyInlineMarkup{constructor(rows){this.rows=rows;}}
 class KeyboardButtonCallback{constructor(text){this.text=text;this.data=Buffer.from("generated");}}
 class GetBotCallbackAnswer{constructor(value){Object.assign(this,value);}}
 let now=10000,reads=0,clicks=0;
 const backend=service({async sendMessage(){return{id:1};},async getMessages(){reads++;now=10100;return[message(),{id:2,replyMarkup:new ReplyInlineMarkup([{buttons:[new KeyboardButtonCallback("Bruno Mars - Finesse [03:11]")]}])}];},async invoke(){clicks++;}},{now:()=>now,sleep:async ms=>{now+=ms;},pollIntervalMs:20,api:{...api,ReplyInlineMarkup,KeyboardButtonCallback,messages:{GetBotCallbackAnswer}}});
 assert.equal((await backend.conversation("peer","primary","Finesse Bruno Mars",originalInput(),10100)).status,"unavailable");
 assert.equal(reads,1);assert.equal(clicks,0);assert.equal(backend.documents.size,0);assert.equal(backend.resolved.size,0);
});

test("late callback completion cannot start another poll after its conversation expires",async()=>{
 class ReplyInlineMarkup{constructor(rows){this.rows=rows;}}
 class KeyboardButtonCallback{constructor(text){this.text=text;this.data=Buffer.from("generated");}}
 class GetBotCallbackAnswer{constructor(value){Object.assign(this,value);}}
 let now=10000,reads=0,clicks=0;
 const backend=service({async sendMessage(){return{id:1};},async getMessages(){reads++;return[{id:2,replyMarkup:new ReplyInlineMarkup([{buttons:[new KeyboardButtonCallback("Bruno Mars - Finesse [03:11]")]}])}];},async invoke(){clicks++;now=10100;}},{now:()=>now,sleep:async ms=>{now+=ms;},pollIntervalMs:20,api:{...api,ReplyInlineMarkup,KeyboardButtonCallback,messages:{GetBotCallbackAnswer}}});
 assert.equal((await backend.conversation("peer","primary","Finesse Bruno Mars",originalInput(),10100)).status,"unavailable");
 assert.equal(reads,1);assert.equal(clicks,1);
});

test("a cancelled response cannot restart a download after pending reference refresh",async()=>{
 const {Writable}=require("node:stream"),{once}=require("node:events");
 let reads=0,downloads=0,refreshStarted,finishRefresh;
 const refreshEntered=new Promise(resolve=>{refreshStarted=resolve;}),refreshPending=new Promise(resolve=>{finishRefresh=resolve;});
 const backend=service({async getEntity(){return"peer";},async getMessages(){if(++reads>1){refreshStarted();await refreshPending;}return[message("Finesse","Bruno Mars",191,10000)];},async *iterDownload(){downloads++;if(downloads===1){yield Buffer.alloc(4096,7);throw new Error("FILE_REFERENCE_EXPIRED");}yield Buffer.alloc(10000,7);}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 const response=new Writable({write(_chunk,_encoding,done){done();}});response.writeHead=()=>{};
 const originalStream=backend.stream.bind(backend);let transfer;backend.stream=async(...args)=>{transfer=await originalStream(...args);return transfer;};
 await backend.serve({method:"GET",headers:{}},response,"primary","42");await refreshEntered;
 const closed=once(transfer,"close");response.destroy();await new Promise(resolve=>setImmediate(resolve));assert.equal(transfer.destroyed,true);
 finishRefresh();await closed;assert.equal(downloads,1);assert.equal(reads,2);
});

test("file-reference refresh retries stop after three failed download attempts",async()=>{
 let downloads=0,reads=0;
 const backend=service({async getEntity(){return"peer";},async getMessages(){reads++;return[message()];},async *iterDownload(){downloads++;throw new Error("FILE_REFERENCE_EXPIRED");}});
 backend.api={...api,InputDocumentFileLocation:class{constructor(value){Object.assign(this,value);}}};
 await assert.rejects(async()=>{for await(const chunk of await backend.stream("primary","42",0,5000))assert.ok(chunk);},/FILE_REFERENCE_EXPIRED/);
 assert.equal(downloads,3);assert.equal(reads,3);
});

test("a short coalesced caller expires without cancelling the longer source flight",async context=>{
 context.mock.timers.enable({apis:["Date","setTimeout"],now:10000});
 const {SerialQueue}=require("./serial-queue.cjs");const queue=new SerialQueue("primary");let reads=0,entered,release;
 const started=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const backend=service({async getEntity(){return"peer";},async getMessages(){reads++;entered();await pending;return[message()];}},{queue});
 const original=backend.resolve({...originalInput(),deadlineMs:45000});await started;
 const follower=backend.resolve({...originalInput(),deadlineMs:5000});
 context.mock.timers.tick(5000);const expired=await follower;
 assert.equal(expired.status,"unavailable");assert.equal(expired.reason,"audio-worker-timeout");assert.equal(expired.retryable,true);
 assert.equal(queue.active,true);assert.equal(backend.resolveFlights.size,1);assert.equal(backend.resolved.size,0);
 const joined=backend.resolve(originalInput());context.mock.timers.tick(1000);release();
 assert.equal((await original).status,"ready");assert.equal((await joined).status,"ready");assert.equal(reads,1);assert.equal(backend.resolveFlights.size,0);
 assert.equal((await backend.resolve(originalInput())).status,"ready");assert.equal(reads,1);
});

test("an initial caller timeout keeps the active chat until its late RPC settles",async context=>{
 context.mock.timers.enable({apis:["Date","setTimeout"],now:10000});
 const {SerialQueue}=require("./serial-queue.cjs");const queue=new SerialQueue("primary");let entered,release,queuedRan=false;
 const started=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const backend=service({async getEntity(){return"peer";},async getMessages(){entered();await pending;return[message()];}},{queue});
 const first=backend.resolve({...originalInput(),deadlineMs:5000});await started;
 const joined=backend.resolve({...originalInput(),deadlineMs:45000}),queued=queue.run(()=>{queuedRan=true;});
 context.mock.timers.tick(5000);assert.equal((await first).reason,"audio-worker-timeout");
 assert.equal(queue.active,true);assert.equal(queuedRan,false);assert.equal(backend.resolveFlights.size,1);
 release();assert.equal((await joined).status,"unavailable");await queued;
 assert.equal(queuedRan,true);assert.equal(backend.resolveFlights.size,0);assert.equal(backend.resolved.size,0);assert.equal(backend.documents.size,0);
});

test("a fatal RPC after caller expiration still notifies and clears its actual flight",async context=>{
 context.mock.timers.enable({apis:["Date","setTimeout"],now:10000});
 let entered,fail,fatals=0;
 const started=new Promise(resolve=>{entered=resolve;}),pending=new Promise((_resolve,reject)=>{fail=reject;});
 const backend=service({async getEntity(){entered();return pending;}},{onFatal:()=>fatals++});
 const caller=backend.resolve({...originalInput(),deadlineMs:5000});await started;
 const actual=[...backend.resolveFlights.values()][0],rejected=assert.rejects(actual,/AUTH_KEY_DUPLICATED/);
 context.mock.timers.tick(5000);assert.equal((await caller).reason,"audio-worker-timeout");assert.equal(backend.resolveFlights.size,1);
 fail(new Error("AUTH_KEY_DUPLICATED"));await rejected;assert.equal(fatals,1);assert.equal(backend.resolveFlights.size,0);
});
