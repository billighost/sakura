import {measureApiStage} from "./performance";

export type CatalogWorkPriority="foreground"|"background";
interface Task {priority:CatalogWorkPriority;signal?:AbortSignal;run:()=>Promise<void>;cancel:()=>void}

/** Optional catalog requests share admission across accounts. Two slots stay
 * available to foreground catalog work; playback uses its existing direct path. */
export class CatalogWorkQueue {
  private active=0;private background=0;private pending:Task[]=[];
  constructor(private readonly concurrency=4,private readonly backgroundConcurrency=2,private readonly capacity=128){}
  snapshot(){return {active:this.active,background:this.background,queued:this.pending.length};}
  run<T>(operation:()=>Promise<T>,priority:CatalogWorkPriority="background",signal?:AbortSignal):Promise<T>{
    signal?.throwIfAborted();
    return new Promise<T>((resolve,reject)=>{
      const task:Task={priority,signal,run:async()=>{try{resolve(await operation());}catch(error){reject(error);}},cancel:()=>{const index=this.pending.indexOf(task);if(index<0)return;this.pending.splice(index,1);signal?.removeEventListener("abort",task.cancel);reject(signal?.reason||new DOMException("Catalog work canceled","AbortError"));}};
      if(this.available(task))this.start(task);
      else if(this.pending.length>=this.capacity)reject(new Error("Catalog work queue is full"));
      else {this.pending.push(task);signal?.addEventListener("abort",task.cancel,{once:true});}
    });
  }
  private available(task:Task){return this.active<this.concurrency&&(task.priority==="foreground"||this.background<this.backgroundConcurrency);}
  private start(task:Task){
    task.signal?.removeEventListener("abort",task.cancel);this.active++;if(task.priority==="background")this.background++;
    // run absorbs operation failure. The completion promise is owned here and
    // always releases admission before selecting the next queued consumer.
    void task.run().finally(()=>{this.active--;if(task.priority==="background")this.background--;this.drain();});
  }
  private drain(){
    while(this.active<this.concurrency){
      let index=this.pending.findIndex(task=>task.priority==="foreground"&&this.available(task));
      if(index<0)index=this.pending.findIndex(task=>this.available(task));if(index<0)return;
      this.start(this.pending.splice(index,1)[0]);
    }
  }
}

const runtime=globalThis as typeof globalThis&{sakuraCatalogWork?:CatalogWorkQueue};
const queue=runtime.sakuraCatalogWork??=new CatalogWorkQueue();
export function catalogWork<T>(operation:()=>Promise<T>,priority:CatalogWorkPriority="background",signal?:AbortSignal){return measureApiStage("catalog_work",()=>queue.run(operation,priority,signal));}
export function catalogWorkPressure(){return queue.snapshot();}
