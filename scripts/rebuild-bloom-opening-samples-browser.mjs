import assert from "node:assert/strict";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import ts from "typescript";
import {chromium} from "@playwright/test";

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on("pageerror",error=>errors.push(error.message));
const source=async(name,globalName)=>{const raw=await readFile(resolve(`src/rebuild/bloom/${name}.ts`),"utf8");const code=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText;return `(()=>{const exports={};${code}\nwindow.${globalName}=exports;})();`;};
const script=(await source("openingSamples","OpeningSamples"))+(await source("openingAudio","OpeningAudio"));
try{
 await page.setContent('<button id="sound">Start opening</button>');
 await page.addScriptTag({content:script});
 const measurements=await page.evaluate(async()=>{
  const api=window.OpeningSamples;
  const NativeWorker=window.Worker,create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  let workerCount=0;const urls=new Set();
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.owned=true;workerCount++;}terminate(){if(this.owned){this.owned=false;workerCount--;}super.terminate();}};
  URL.createObjectURL=value=>{const url=create(value);urls.add(url);return url;};URL.revokeObjectURL=url=>{urls.delete(url);revoke(url);};
  const cpu=[];
  for(let seed=1;seed<=5;seed++){const start=performance.now();api.generateOpeningSamples(seed,48000);cpu.push(performance.now()-start);}
  const tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(entry=>entry.duration)));
  observer.observe({type:"longtask"});
  await new Promise(resolve=>setTimeout(resolve,50));tasks.length=0;
  const cold=[],warm=[],cache=new api.OpeningSampleCache();let maxTimerDelay=0,last=performance.now();
  const timer=setInterval(()=>{const now=performance.now();maxTimerDelay=Math.max(maxTimerDelay,now-last);last=now;},8);
  for(let seed=101;seed<=105;seed++){let start=performance.now();const samples=await cache.prepare(seed,48000,new AbortController().signal);cold.push(performance.now()-start);start=performance.now();const second=await cache.prepare(seed,48000,new AbortController().signal);warm.push(performance.now()-start);if(samples!==second)throw new Error("Warm preparation did not reuse its buffers");}
  clearInterval(timer);await new Promise(resolve=>setTimeout(resolve,50));observer.disconnect();
  const controller=new AbortController(),cancelCache=new api.OpeningSampleCache();
  const pending=cancelCache.prepare(999,48000,controller.signal).then(()=>"resolved",error=>error.name);
  controller.abort(new DOMException("Story closed","AbortError"));
  const cancelResult=await pending;await new Promise(resolve=>setTimeout(resolve,0));
  const cancelledResources={workers:workerCount,urls:urls.size};
  window.Worker=class{constructor(){throw new Error("Workers blocked");}};
  const fallbackController=new AbortController(),fallback=api.prepareOpeningSampleData(111,48000,fallbackController.signal).then(()=>"resolved",error=>error.name);
  setTimeout(()=>fallbackController.abort(new DOMException("Fallback closed","AbortError")),0);
  const fallbackResult=await fallback;window.Worker=NativeWorker;
  window.openingSamples=await cache.prepare(105,48000,new AbortController().signal);
  return {scope:"Isolated real Chromium sample generation/cache/worker lifecycle; excludes account/provider work and full React opening",cpuSynchronousMs:cpu,workerColdCompletionMs:cold,warmReuseMs:warm,workerLongTasksMs:tasks,maxUITimerIntervalMs:maxTimerDelay,cancelResult,fallbackResult,cancelledResources,cache:cache.snapshot()};
 });
 assert.equal(measurements.cancelResult,"AbortError");assert.equal(measurements.fallbackResult,"AbortError");
 assert.deepEqual(measurements.cancelledResources,{workers:0,urls:0});assert.ok(measurements.cache.bytes<=8*1024*1024);assert.ok(measurements.cache.retained<=4);
 // Exercise real gesture-bound context resume and prepared graph scheduling.
 await page.evaluate(()=>{document.querySelector("#sound").onclick=()=>{
  const context=new AudioContext();window.openingContext=context;
  window.openingResult=context.resume().then(async()=>{
   const samples=context.sampleRate===48000?window.openingSamples:await window.OpeningSamples.prepareOpeningSampleData(105,context.sampleRate,new AbortController().signal);
   let profile;const phases=[];
   for(const name of ["createGain","createConvolver","createOscillator","createBiquadFilter","createStereoPanner","createBufferSource","createPeriodicWave","createBuffer"]){
    const original=context[name].bind(context);
    context[name]=(...args)=>{const started=performance.now(),result=original(...args);profile[name]=(profile[name]||0)+performance.now()-started;profile[`${name}Count`]=(profile[`${name}Count`]||0)+1;
     if(name==="createConvolver"){const descriptor=Object.getOwnPropertyDescriptor(ConvolverNode.prototype,"buffer");Object.defineProperty(result,"buffer",{get(){return descriptor.get.call(this);},set(value){const start=performance.now();descriptor.set.call(this,value);profile.convolverBufferSetMs=(profile.convolverBufferSetMs||0)+performance.now()-start;}});}
     if(name==="createBuffer"){const channel=result.getChannelData.bind(result);result.getChannelData=index=>{const data=channel(index),set=data.set.bind(data);data.set=(...values)=>{const start=performance.now();const output=set(...values);profile.sampleCopyMs=(profile.sampleCopyMs||0)+performance.now()-start;return output;};return data;};}
     return result;
    };
   }
   for(let run=0;run<6;run++){profile={};const start=performance.now();const score=window.OpeningAudio.bloomOpeningScore("sakura",105);const scorePerformance=window.OpeningAudio.playBloomOpening(context,score,samples);phases.push({graphMs:performance.now()-start,profile:{...profile}});scorePerformance.dispose();await new Promise(resolve=>setTimeout(resolve,0));}
   await context.close();const warm=phases.slice(1).map(phase=>phase.graphMs).sort((a,b)=>a-b);
   return {sampleRate:context.sampleRate,coldGraphMs:phases[0].graphMs,warmGraphMedianMs:warm[Math.floor(warm.length/2)],phases,closed:context.state==="closed"};
  });
 };});
 await page.locator("#sound").click();const graph=await page.evaluate(()=>window.openingResult);assert.equal(graph.closed,true);assert.deepEqual(errors,[]);
 const report={...measurements,graph,pageErrors:errors};await mkdir(resolve(".local/bloom-opening-samples"),{recursive:true});await writeFile(resolve(".local/bloom-opening-samples/report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
}finally{await browser.close();}
