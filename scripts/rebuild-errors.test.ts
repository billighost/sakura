import assert from "node:assert/strict";
import {test} from "node:test";
import {readJsonResponse,requestJson,responseIssue,UserFacingError,userIssue,userMessage} from "../src/rebuild/app/errors";
test("the same connection text retains its recovery action in each context",()=>{const save=userMessage(new Error("network unavailable"),"save");const download=userMessage(new Error("network unavailable"),"download");assert.match(userIssue(save,"save").title,/change/);assert.match(userIssue(download,"download").title,/download/);assert.equal(userIssue(save,"save").action,"Save again");});
test("empty, truncated and HTML server responses recover without exposing parser or server internals",async()=>{
 for(const [status,body] of [[503,""],[502,"<html>upstream postgres://private connection failed</html>"],[200,'{"profile":']] as const){
  await assert.rejects(()=>readJsonResponse(new Response(body,{status})),(error:unknown)=>{
   assert.ok(error instanceof UserFacingError);assert.equal(error.issue.kind,"connection");assert.ok(error.issue.href);assert.doesNotMatch(error.message,/JSON|postgres|upstream|Unexpected|private/);return true;
  });
 }
});
test("untrusted API error text never becomes user-facing copy",async()=>{
 await assert.rejects(()=>readJsonResponse(new Response(JSON.stringify({error:"SQL failed using secret-token on C:/Users/account"}),{status:500})),(e:unknown)=>{assert.ok(e instanceof UserFacingError);assert.doesNotMatch(e.message,/SQL|secret|Users/);return true;});
 const issue=userIssue(new SyntaxError("Unexpected end of JSON input"));assert.equal(issue.kind,"connection");assert.equal(issue.action,"Reconnect");assert.equal(issue.href,"/library/downloaded");
});
test("account conflicts, uncertain recordings and expired recaps give different useful next steps",()=>{
 assert.equal(responseIssue(409,{},"account").kind,"validation");
 assert.equal(responseIssue(409,{status:"review",reason:"ambiguous-audio"},"playback").href,"/search");
 assert.equal(responseIssue(401,{}).href,"/login");
 assert.equal(responseIssue(423,{}).href,"/bloom");
 assert.equal(responseIssue(410,{}).href,"/bloom");
 assert.match(responseIssue(404,{},"lyrics").title,/lyrics/);
});
test("missing audio has an availability recovery while an identity mismatch stays a version review",()=>{
 assert.equal(responseIssue(503,{reason:"no-ready-audio"},"download").kind,"missing");
 assert.equal(responseIssue(409,{status:"review",reason:"asset-mismatch"},"download").kind,"version");
});
test("network rejection is normalized while explicit caller cancellation stays cancelable",async t=>{
 t.mock.method(globalThis,"fetch",async()=>{throw new TypeError("Failed to fetch internal-host");});
 await assert.rejects(()=>requestJson("https://fixture.invalid",{},{context:"save"}),e=>e instanceof UserFacingError&&!e.message.includes("internal-host"));
 const c=new AbortController();c.abort();await assert.rejects(()=>requestJson("https://fixture.invalid",{signal:c.signal}),e=>e instanceof TypeError);
});
test("a stalled request expires with a recoverable failure",async t=>{
 t.mock.method(globalThis,"fetch",async(_url:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{init.signal!.addEventListener("abort",()=>reject(init.signal!.reason),{once:true});}));
 // The extra timer keeps Node alive while AbortSignal's unref'ed timer expires.
 const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(()=>requestJson("https://fixture.invalid",{},{timeoutMs:5}),e=>e instanceof UserFacingError&&e.issue.kind==="connection");}finally{clearTimeout(keepAlive);}
});
