/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS worker tests use Node's native runner. */
const assert=require("node:assert/strict"),{test}=require("node:test");
const {RebuildAudioService,buttonCandidate}=require("./service.cjs");
const {assessAudioCandidate}=require("./core/matching.js");
class Document{constructor(value){Object.assign(this,value);}}
class DocumentAttributeAudio{constructor(value){Object.assign(this,value);}}
const api={Document,DocumentAttributeAudio};
function message(title="Finesse",artist="Bruno Mars",duration=191,size=5000){return{id:42,media:{document:new Document({id:123,accessHash:456,fileReference:Buffer.from("ref"),dcId:1,size,mimeType:"audio/mpeg",attributes:[new DocumentAttributeAudio({title,performer:artist,duration})]})}};}
function service(client){return new RebuildAudioService({telegram:()=>client,api,bigInt:Number,bots:["primary","fallback"],queue:{depth:0,run:operation=>operation()}});}
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
 const client={async getEntity(){return"peer";},async getMessages(){return[message("Finesse","Bruno Mars",191,bytes.length)];},async *iterDownload(options){assert.equal(options.offset,8192);assert.equal(options.limit,1);yield bytes.subarray(options.offset);}};
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
