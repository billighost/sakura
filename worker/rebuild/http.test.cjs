/* eslint-disable @typescript-eslint/no-require-imports -- Actual worker HTTP handler runs with mocked Telegram and sockets. */
const assert=require("node:assert/strict"),{test}=require("node:test");
const {readFileSync}=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {Readable,Writable}=require("node:stream"),{finished}=require("node:stream/promises"),{createHash}=require("node:crypto");
const {RebuildAudioService}=require("./service.cjs");
class Document{constructor(value){Object.assign(this,value);}}
class DocumentAttributeAudio{constructor(value){Object.assign(this,value);}}
class InputDocumentFileLocation{constructor(value){Object.assign(this,value);}}
const api={Document,DocumentAttributeAudio,InputDocumentFileLocation};

function fixture(measure=false,size=5000){
 const bytes=Buffer.alloc(size);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;
 const state={fileId:123,downloads:0,handler:null,requests:[]};
 class TelegramWorkerClient{
  constructor(){
   this.botQueue={depth:0,run:operation=>operation()};
   this.client={async getEntity(){return"primary";},async getMessages(){return[{id:42,media:{document:new Document({id:state.fileId,accessHash:456,fileReference:Buffer.from("generated"),dcId:1,size:bytes.length,mimeType:"audio/mpeg",attributes:[new DocumentAttributeAudio({title:"Generated track",performer:"Generated artist",duration:191})]})}}];},async *iterDownload(options){state.downloads++;state.requests.push({offset:options.offset,length:options.requestSize});for(let chunk=0;chunk<options.limit;chunk++){const offset=options.offset+chunk*options.requestSize,part=bytes.subarray(offset,offset+options.requestSize);if(!part.length)return;yield part;}}};
  }
  queueFor(){return this.botQueue;}
  async _ensureConnected(){}
  async start(){}
  health(){return{ok:true};}
 }
 const mocks={
  dotenv:{config(){}},"node:http":{createServer(handler){state.handler=handler;return{listen(){},close(){}};}},
  "./telegram":{TelegramWorkerClient,DEFAULT_BOT:"primary"},"./rebuild/service.cjs":{RebuildAudioService},"telegram/tl":{Api:api},"big-integer":Number,
  "./rebuild/performance.cjs":require("./performance.cjs"),
 };
 vm.runInNewContext(readFileSync(path.join(__dirname,"../index.js"),"utf8"),{
  require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),
  process:{env:{WORKER_SECRET:"generated-worker-secret-for-tests",TELEGRAM_API_ID:"1",TELEGRAM_API_HASH:"generated",TELEGRAM_SESSION_STRING:"generated",SAKURA_PERFORMANCE_LOG:measure?"1":"0"},on(){},exit(){throw new Error("Worker unexpectedly exited");}},
  console:{log(){},warn(){},error(){}},Buffer,URL,URLSearchParams,setTimeout,clearTimeout,
 },{filename:"worker/index.js"});
 async function request(method,url,headers={},body){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{method,url,headers:{host:"worker.example.test",...headers},aborted:false});
  const parts=[];const res=new Writable({write(chunk,_encoding,done){parts.push(Buffer.from(chunk));done();}});
  res.writeHead=(status,value)=>{res.statusCode=status;res.headers=value;res.headersSent=true;};
  await state.handler(req,res);await finished(res);
  return{status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)};
 }
 return{state,bytes,request,bearer:{authorization:"Bearer generated-worker-secret-for-tests"},tag:'"'+createHash("sha256").update(JSON.stringify(["primary","42","123",bytes.length,"audio/mpeg"])).digest("hex")+'"'};
}

test("actual scoped signed HTTP playback pins its file before HEAD or range bytes",async()=>{
 const {state,bytes,request,bearer,tag}=fixture();
 const minted=await request("POST","/v2/sign-audio",bearer,{chatScope:"primary",messageId:"42",documentTag:tag});
 assert.equal(minted.status,200);const signed=JSON.parse(minted.bytes.toString());assert.equal(new URL(signed.path,"https://worker.example.test").searchParams.get("documentTag"),tag);
 const head=await request("HEAD",signed.path);assert.equal(head.status,200);assert.equal(head.headers.ETag,tag);assert.equal(state.downloads,0);
 const audio=await request("GET",signed.path,{range:"bytes=-10"});assert.equal(audio.status,206);assert.deepEqual(audio.bytes,bytes.subarray(4990));assert.equal(state.downloads,1);
 state.fileId=789;assert.equal((await request("POST","/v2/audio-info",bearer,{chatScope:"primary",messageId:"42",refresh:true})).status,200);
 for(const method of ["HEAD","GET"]){const changed=await request(method,signed.path,{range:"bytes=-10"});assert.equal(changed.status,412);assert.equal(changed.bytes.length,0);}
 assert.equal(state.downloads,1);
});
test("numeric worker diagnostics remain private and count exact delivered range bytes",async()=>{
 const {request,bearer,tag}=fixture(true);
 const denied=await request("POST","/v2/capabilities",{},{});assert.equal(denied.status,401);
 const signed=JSON.parse((await request("POST","/v2/sign-audio",bearer,{chatScope:"primary",messageId:"42",documentTag:tag})).bytes.toString());
 await request("GET",signed.path,{range:"bytes=-10"});
 const capabilities=JSON.parse((await request("POST","/v2/capabilities",bearer,{})).bytes.toString());
 assert.deepEqual(capabilities.performance.counters,{transfer_bytes:10});
 assert.ok(!JSON.stringify(capabilities.performance).includes("primary"));
 const disabled=fixture();assert.equal(JSON.parse((await disabled.request("POST","/v2/capabilities",disabled.bearer,{})).bytes.toString()).performance,undefined);
});

test("actual scoped signed HTTP rejects document tag tampering and conflicting client preconditions",async()=>{
 const {state,request,bearer,tag}=fixture();
 const signed=JSON.parse((await request("POST","/v2/sign-audio",bearer,{chatScope:"primary",messageId:"42",documentTag:tag})).bytes.toString());
 for(const mode of ["replace","remove","duplicate"]){
  const url=new URL(signed.path,"https://worker.example.test");
  if(mode==="replace")url.searchParams.set("documentTag",'"'+"a".repeat(64)+'"');
  if(mode==="remove")url.searchParams.delete("documentTag");
  if(mode==="duplicate")url.searchParams.append("documentTag",tag);
  assert.equal((await request("GET",url.pathname+url.search)).status,401);
 }
 assert.equal((await request("GET",signed.path,{"if-match":"\"other-file\""})).status,412);assert.equal(state.downloads,0);
 assert.equal((await request("POST","/v2/sign-audio",bearer,{chatScope:"primary",messageId:"42",documentTag:"invalid"})).status,400);
});

test("signed worker playback hint streams later ranges early while ordinary downloads keep bulk requests",async()=>{
 const {state,bytes,request,bearer,tag}=fixture(false,800000);
 const signed=JSON.parse((await request("POST","/v2/sign-audio",bearer,{chatScope:"primary",messageId:"42",documentTag:tag})).bytes.toString());
 const range="bytes=262144-524287",expected=bytes.subarray(262144,524288);
 const normal=await request("GET",signed.path,{range});assert.equal(normal.status,206);assert.deepEqual(normal.bytes,expected);
 assert.deepEqual(state.requests,[{offset:262144,length:262144}]);state.requests.length=0;
 const playing=await request("GET",signed.path,{range,"x-sakura-playback":"1"});assert.equal(playing.status,206);assert.deepEqual(playing.bytes,expected);
 assert.deepEqual(state.requests,[{offset:262144,length:32768},{offset:294912,length:32768},{offset:327680,length:65536},{offset:393216,length:65536},{offset:458752,length:65536}]);state.requests.length=0;
 await request("GET",signed.path,{range,"x-sakura-playback":"true"});assert.deepEqual(state.requests,[{offset:262144,length:262144}]);state.requests.length=0;
 const native=await request("GET",signed.path,{range,"sec-fetch-dest":"audio"});assert.equal(native.status,206);assert.deepEqual(native.bytes,expected);assert.equal(state.requests[0].length,32768);
 const options=await request("OPTIONS",signed.path,{"access-control-request-headers":"X-Sakura-Playback"});
 assert.equal(options.status,204);assert.match(options.headers["Access-Control-Allow-Headers"],/X-Sakura-Playback/);
});
