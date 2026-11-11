import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, webkit } from "@playwright/test";

const base=process.env.SAKURA_TEST_URL||"http://localhost:3012",checks=[];
await fs.mkdir(".local/lyric-publish",{recursive:true});
for(const [name,type,options] of [["chrome",chromium,{channel:"chrome"}],["webkit",webkit,{}]]){
  const browser=await type.launch({...options,headless:true});
  try{
    const page=await browser.newPage();await page.goto(base+"/login",{waitUntil:"domcontentloaded"});
    const result=await page.evaluate(async()=>{
      const solved=await new Promise((resolve,reject)=>{
        const worker=new Worker("/lyric-publish-worker.js"),timer=setTimeout(()=>{worker.terminate();reject(new Error("Worker did not solve"));},15000);
        worker.onerror=error=>{clearTimeout(timer);worker.terminate();reject(new Error(error.message));};
        worker.onmessage=event=>{if(event.data.type==="complete"){clearTimeout(timer);worker.terminate();resolve(event.data.token);}else if(event.data.type==="error"){clearTimeout(timer);worker.terminate();reject(new Error(event.data.reason));}};
        worker.postMessage({prefix:"sakuraBrowserProof",target:"000fffff"+"f".repeat(56),maximumMs:10000});
      });
      const [prefix,nonce]=solved.split(":"),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(prefix+nonce)))).map(value=>value.toString(16).padStart(2,"0")).join("");
      let pulses=0;const interval=setInterval(()=>pulses++,25);
      const expired=await new Promise((resolve,reject)=>{
        const worker=new Worker("/lyric-publish-worker.js"),timer=setTimeout(()=>{worker.terminate();reject(new Error("Worker did not expire"));},10000);
        worker.onerror=error=>{clearTimeout(timer);worker.terminate();reject(new Error(error.message));};
        worker.onmessage=event=>{if(event.data.type==="error"){clearTimeout(timer);worker.terminate();resolve(event.data.reason);}else if(event.data.type==="complete"){clearTimeout(timer);worker.terminate();reject(new Error("Unexpected zero digest"));}};
        worker.postMessage({prefix:"sakuraCancellation",target:"0".repeat(64),maximumMs:1000});
      });clearInterval(interval);
      return {solved,digest,pulses,expired};
    });
    assert.ok(result.digest<="000fffff"+"f".repeat(56));assert.equal(result.expired,"expired");assert.ok(result.pulses>=10,`${name} main thread stayed responsive while solving`);
    checks.push({browser:name,checks:["Worker solves official decimal nonce protocol","WebCrypto independently verifies proof","Main UI event loop remains responsive","Bounded expired challenge stops"],...result});
  }finally{await browser.close();}
}
await fs.writeFile(".local/lyric-publish/report.json",JSON.stringify({checks},null,2));console.log(JSON.stringify({checks},null,2));
