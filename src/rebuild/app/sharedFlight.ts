/** Share work without letting one consumer cancel work another still needs. */
export class SharedFlight<T> {
 private flights=new Map<string,{controller:AbortController;promise:Promise<T>;users:number}>();
 run(key:string,signal:AbortSignal,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  signal.throwIfAborted();
  let flight=this.flights.get(key);
  if(!flight||flight.controller.signal.aborted){
   const controller=new AbortController();
   const entry:{controller:AbortController;promise:Promise<T>;users:number}={controller,promise:Promise.resolve(undefined as T),users:0};
   entry.promise=Promise.resolve().then(()=>work(controller.signal)).finally(()=>{if(this.flights.get(key)===entry)this.flights.delete(key);});
   // A caller can leave before the provider observes its abort.
   void entry.promise.catch(()=>{});
   this.flights.set(key,entry);flight=entry;
  }
  const entry=flight;entry.users++;
  return new Promise<T>((resolve,reject)=>{
   let settled=false;
   const finish=(callback:()=>void)=>{if(settled)return;settled=true;signal.removeEventListener("abort",abort);entry.controller.signal.removeEventListener("abort",providerAbort);entry.users--;if(entry.users===0)entry.controller.abort(new DOMException("No active consumers","AbortError"));callback();};
   const abort=()=>finish(()=>reject(signal.reason??new DOMException("Canceled","AbortError")));
   const providerAbort=()=>finish(()=>reject(entry.controller.signal.reason??new DOMException("Canceled","AbortError")));
   signal.addEventListener("abort",abort,{once:true});
   entry.controller.signal.addEventListener("abort",providerAbort,{once:true});
   entry.promise.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
   if(signal.aborted)abort();
  });
 }
 clear(){for(const entry of this.flights.values())entry.controller.abort(new DOMException("Account changed","AbortError"));this.flights.clear();}
}
