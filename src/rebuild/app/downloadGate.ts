/** Bound batch transfers while keeping one cancellable job per recording. */
export class DownloadGate {
 private active=0;
 private waiting:Array<{signal:AbortSignal;start:()=>void;cancel:()=>void}>=[];
 constructor(private limit=3){}
 acquire(signal:AbortSignal):Promise<()=>void>{
  if(signal.aborted)return Promise.reject(new DOMException("Canceled","AbortError"));
  return new Promise((resolve,reject)=>{
   const task={signal,start:()=>{signal.removeEventListener("abort",task.cancel);this.active++;let released=false;resolve(()=>{if(released)return;released=true;this.active--;this.pump();});},cancel:()=>{this.waiting=this.waiting.filter(item=>item!==task);signal.removeEventListener("abort",task.cancel);reject(new DOMException("Canceled","AbortError"));}};
   signal.addEventListener("abort",task.cancel,{once:true});this.waiting.push(task);this.pump();
  });
 }
 private pump(){while(this.active<this.limit&&this.waiting.length){const task=this.waiting.shift()!;if(task.signal.aborted)task.cancel();else task.start();}}
}
