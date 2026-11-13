import assert from "node:assert/strict";
import {test} from "node:test";
import vm from "node:vm";
import {generateOpeningSamples, generateOpeningSamplesYielded, OpeningSampleCache, openingSampleWorkerSource, type OpeningSamples} from "../src/rebuild/bloom/openingSamples";
import {bloomOpeningScore, playBloomOpening} from "../src/rebuild/bloom/openingAudio";

function originalSamples(seed: number, sampleRate: number) {
 const fraction=(seed: number,index: number)=>{const value=Math.sin((seed%100000+index*77.71)*12.9898)*43758.5453;return value-Math.floor(value);};
 const impulse=[new Float32Array(Math.floor(sampleRate*2.5)),new Float32Array(Math.floor(sampleRate*2.5))];
 for(let channel=0;channel<2;channel++){const data=impulse[channel];let previous=0;for(let index=0;index<data.length;index++){previous=previous*.32+(fraction(seed+channel*19,index+1)*2-1)*.68;data[index]=previous*Math.pow(1-index/data.length,2.5)*.45;}}
 const noise=new Float32Array(sampleRate*2);
 for(let index=0;index<noise.length;index++)noise[index]=(fraction(seed,index+997)*2-1)*.22;
 return {impulse,noise};
}
const bytes=(array: Float32Array)=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function same(actual: OpeningSamples, expected: {impulse: Float32Array[]; noise: Float32Array}) {assert.deepEqual(bytes(actual.impulse[0]),bytes(expected.impulse[0]));assert.deepEqual(bytes(actual.impulse[1]),bytes(expected.impulse[1]));assert.deepEqual(bytes(actual.noise),bytes(expected.noise));}

test("worker and cooperative opening samples preserve the original samples byte for byte",async()=>{
 for(const [seed,rate] of [[0,8000],[452,44100],[4294967295,48000]]){
  const expected=originalSamples(seed,rate),generated=generateOpeningSamples(seed,rate);
  same(generated,expected);
  let transferred: OpeningSamples|undefined;
  const self={onmessage: undefined as unknown as (event: {data: {seed: number; sampleRate: number}})=>void, postMessage:(value: OpeningSamples)=>{transferred=value;}};
  vm.runInNewContext(openingSampleWorkerSource(),{self,Float32Array});
  self.onmessage({data:{seed,sampleRate:rate}});
  assert.equal(transferred?.version,1);same(transferred!,expected);
  same(await generateOpeningSamplesYielded(seed,rate,new AbortController().signal),expected);
 }
});

test("cooperative preparation yields immediately and stops at cancellation boundaries",async()=>{
 const controller=new AbortController();let timerRan=false;
 const timer=setTimeout(()=>{timerRan=true;controller.abort(new DOMException("Viewing closed","AbortError"));},0);
 await assert.rejects(generateOpeningSamplesYielded(12,48000,controller.signal),{name:"AbortError"});
 clearTimeout(timer);assert.equal(timerRan,true);
 assert.throws(()=>generateOpeningSamples(0,384000),/Unsupported/);
});

test("sample cache shares one active generator and independent subscribers",async()=>{
 let starts=0,finish!:(value: OpeningSamples)=>void,underlying: AbortSignal|undefined;
 const cache=new OpeningSampleCache(async(_seed,_rate,signal)=>{starts++;underlying=signal;return new Promise(resolve=>{finish=resolve;});});
 const a=new AbortController(),b=new AbortController();
 const first=cache.prepare(5,8000,a.signal),second=cache.prepare(5,8000,b.signal);
 assert.equal(starts,1);a.abort(new DOMException("First closed","AbortError"));await assert.rejects(first,{name:"AbortError"});assert.equal(underlying?.aborted,false);
 finish(generateOpeningSamples(5,8000));const value=await second;
 assert.equal(await cache.prepare(5,8000,new AbortController().signal),value);assert.equal(starts,1);
});

test("all departing owners cancel active work and queued admission allocates no samples",async()=>{
 let starts=0;const signals: AbortSignal[]=[];
 const cache=new OpeningSampleCache(async(_seed,_rate,signal)=>{starts++;signals.push(signal);return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));},1000000,4,2);
 const a=new AbortController(),b=new AbortController();
 const first=cache.prepare(1,8000,a.signal),second=cache.prepare(2,8000,b.signal);
 await assert.rejects(cache.prepare(3,8000,new AbortController().signal),/busy/);
 assert.equal(starts,1);assert.equal(cache.snapshot().queued,1);
 b.abort();await assert.rejects(second,{name:"AbortError"});assert.equal(starts,1);
 a.abort();await assert.rejects(first,{name:"AbortError"});assert.equal(signals[0].aborted,true);
 await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(cache.snapshot(),{retained:0,bytes:0,pending:0,active:0,queued:0});
});

test("retained buffers obey byte and entry budgets with stable warm reuse",async()=>{
 let calls=0;const cache=new OpeningSampleCache(async(seed,rate)=>{calls++;return generateOpeningSamples(seed,rate);},300000,4);
 await cache.prepare(1,8000,new AbortController().signal);await cache.prepare(2,8000,new AbortController().signal);
 assert.equal(cache.snapshot().retained,1);assert.ok(cache.snapshot().bytes<=300000);
 await cache.prepare(2,8000,new AbortController().signal);assert.equal(calls,2);
 await cache.prepare(1,8000,new AbortController().signal);assert.equal(calls,3);
});

test("graph scheduling consumes prepared buffers and does not regenerate their samples",()=>{
 const sampleRate=8000,samples=generateOpeningSamples(44,sampleRate),buffers: Float32Array[][]=[];
 const parameter={value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelAndHoldAtTime(){}};
 const node=()=>({gain:{...parameter},frequency:{...parameter},pan:{...parameter},Q:{...parameter},connect(){},disconnect(){},setPeriodicWave(){},start(){},stop(){}});
 const context={sampleRate,currentTime:0,destination:{},createGain:node,createConvolver:node,createOscillator:node,createBiquadFilter:node,createStereoPanner:node,createBufferSource:node,createPeriodicWave:()=>({}),createBuffer:(channels: number,length: number)=>{const data=Array.from({length:channels},()=>new Float32Array(length));buffers.push(data);return {getChannelData:(index: number)=>data[index]};}} as unknown as AudioContext;
 const result=playBloomOpening(context,bloomOpeningScore("sakura",44),samples);
 same({version:1,seed:44,sampleRate,impulse:buffers[0] as [Float32Array,Float32Array],noise:buffers[1][0]},samples);
 result.fade();result.dispose();result.dispose();
 assert.throws(()=>playBloomOpening({...context,sampleRate:16000} as AudioContext,bloomOpeningScore("sakura",44),samples),/do not match/);
});
