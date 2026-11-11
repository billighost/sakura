import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
// Execute the real coordinator with deterministic storage and transport, so
// request ordering and browser-close recovery can be tested without a server.
const compiled=ts.transpileModule(await readFile('src/rebuild/app/listeningSync.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
export function setup(options={}){
 const mirror=new Map(),disk=new Map(),restored=[],requests=[],timers=new Map(),storageErrors=[];let remote=null,stamp=1000,elapsed=0,serverTime=undefined,offline=false,holdGet=null,holdPut=null,nextTimer=0,blockedMirror=options.blockedMirror,blockedDisk=options.blockedDisk;
 const exports={};const localStorage={get length(){return mirror.size;},key:index=>[...mirror.keys()][index]||null,getItem:key=>mirror.get(key)||null,removeItem:key=>mirror.delete(key),setItem:(key,value)=>{if(blockedMirror)throw new Error('Storage unavailable');mirror.set(key,value);}};
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const transport=async(path,init={},options={})=>{
  requests.push({path,init,options});if(offline)throw new Error('offline');if(init.signal?.aborted)throw new DOMException('aborted','AbortError');
  if(!init.method){if(holdGet){const hold=holdGet;holdGet=null;return hold;}return {session:clone(remote),serverTime};}
  if(holdPut){const hold=holdPut;holdPut=null;return hold;}
  const sent=JSON.parse(init.body);if(sent.revision!==(remote?.revision||0))return {accepted:false,session:clone(remote),serverTime};
  const updatedAt=serverTime??++stamp,choiceAt=sent.explicit===false?(remote?.choiceAt??remote?.updatedAt??updatedAt):Math.max(remote?.choiceAt??0,Math.min(sent.intentAt??updatedAt,updatedAt));
  remote={state:sent.state,revision:sent.revision+1,deviceId:sent.deviceId,updatedAt,choiceAt};return {accepted:true,session:clone(remote),serverTime};
 };
 vm.runInNewContext(compiled,{exports,require:path=>path==='./offline'?{localRead:async(account,name)=>clone(disk.get(name==='listening-session'?account:account+':'+name)),localWriteOrdered:async(account,name,draft,field='savedAt')=>{if(blockedDisk)throw new Error('Storage unavailable');const key=name==='listening-session'?account:account+':'+name,old=disk.get(key);if(!old||(draft[field]||0)>(old[field]||0)||(draft[field]||0)===(old[field]||0)&&(draft.savedAt||0)>=(old.savedAt||0))disk.set(key,clone(draft));},localDelete:async(account,name)=>disk.delete(account+':'+name),localEntries:async(account,prefix)=>[...disk].filter(([key])=>key.startsWith(account+':'+prefix)).map(([key,value])=>({name:key.slice(account.length+1),value:clone(value)}))}:path==='./sessionState'?{localId:randomUUID}:{requestJson:transport},localStorage,crypto:{randomUUID},AbortController,DOMException,Date:{now:()=>++stamp},performance:options.monotonic?{now:()=>elapsed}:undefined,setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const deviceId=randomUUID(),sync=new exports.ListeningSync('account-a',deviceId,value=>restored.push(clone(value)),error=>storageErrors.push(error));
 return {sync,deviceId,mirror,disk,restored,requests,storageErrors,storageAvailable(){blockedMirror=false;blockedDisk=false;},writerIdentity:exports.deviceIdentity,get remote(){return remote;},set remote(value){remote=value;},offline(value){offline=value;},now(value){stamp=value;},elapsed(value){elapsed=value;},serverTime(value){serverTime=value;},hold(value){holdGet=value;},holdPut(value){holdPut=value;},newSync(writerId=deviceId){return new exports.ListeningSync('account-a',writerId,value=>restored.push(clone(value)));}};
}
