type Entry<T> = {controller:AbortController;promise:Promise<T>;consumers:number;complete:boolean};

/** Share a public provider read while keeping each consumer's cancellation local.
 * Unobserved work is evicted immediately, even if an upstream ignores abort.
 * The registry is bounded; overflow reads run independently rather than evicting
 * work that another active caller still needs. Never use this for mutations. */
export class ProviderFlight<T> {
  private readonly entries=new Map<string,Entry<T>>();
  constructor(private readonly capacity=400){}

  run(key:string,signal:AbortSignal|undefined,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    signal?.throwIfAborted();
    let entry=this.entries.get(key);
    if(!entry||entry.controller.signal.aborted){
      const created:Entry<T>={controller:new AbortController(),promise:Promise.resolve(undefined as T),consumers:0,complete:false};
      created.promise=Promise.resolve().then(()=>{
        created.controller.signal.throwIfAborted();
        return work(created.controller.signal);
      }).finally(()=>{
        created.complete=true;
        if(this.entries.get(key)===created)this.entries.delete(key);
      });
      void created.promise.catch(()=>{});
      if(this.entries.size<this.capacity)this.entries.set(key,created);
      entry=created;
    }
    const active=entry;active.consumers++;
    return new Promise<T>((resolve,reject)=>{
      let settled=false;
      const finish=(callback:()=>void)=>{
        if(settled)return;
        settled=true;signal?.removeEventListener("abort",abort);active.consumers--;
        if(active.consumers===0&&!active.complete){
          if(this.entries.get(key)===active)this.entries.delete(key);
          active.controller.abort(new DOMException("No active provider consumers","AbortError"));
        }
        callback();
      };
      const abort=()=>finish(()=>reject(signal?.reason??new DOMException("Canceled","AbortError")));
      signal?.addEventListener("abort",abort,{once:true});
      active.promise.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
      if(signal?.aborted)abort();
    });
  }
}
