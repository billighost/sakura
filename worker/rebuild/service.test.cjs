/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS worker tests use Node's native runner. */
const assert=require("node:assert/strict"),{test}=require("node:test");
const {RebuildAudioService,buttonCandidate,searchQueries}=require("./service.cjs");
const {assessAudioCandidate}=require("./core/matching.js");
class Document{constructor(value){Object.assign(this,value);}}
class DocumentAttributeAudio{constructor(value){Object.assign(this,value);}}
const api={Document,DocumentAttributeAudio};
function message(title="Finesse",artist="Bruno Mars",duration=191,size=5000){return{id:42,media:{document:new Document({id:123,accessHash:456,fileReference:Buffer.from("ref"),dcId:1,size,mimeType:"audio/mpeg",attributes:[new DocumentAttributeAudio({title,performer:artist,duration})]})}};}
function service(client,options={}){return new RebuildAudioService({telegram:()=>client,api,bigInt:Number,bots:["primary","fallback"],queue:{depth:0,run:operation=>operation()},...options});}
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
 await backend.serve({method:"GET",headers:{"if-match":"\"old-document\""}},{writeHead(status,value){code=status;headers=value;},end(){ended=true;}},"primary","42");
 assert.equal(code,412);assert.equal(ended,true);assert.equal(headers["Content-Length"],"0");assert.ok(/^"[a-f0-9]{64}"$/.test(headers.ETag));
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
