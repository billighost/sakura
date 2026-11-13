/** A rejected request never needs to retain its complete body in memory. */
export class RequestBodyError extends Error {
  constructor(readonly status:number,message:string){super(message);this.name="RequestBodyError";}
}

export async function readBoundedRequestText(request:Request,maximum:number,timeoutMs=5000):Promise<string>{
  if(!Number.isSafeInteger(maximum)||maximum<1)throw new Error("Invalid request body limit");
  request.signal.throwIfAborted();
  const declared=request.headers.get("content-length");
  if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>maximum){
    await request.body?.cancel().catch(()=>{});throw new RequestBodyError(413,"Request is too large");
  }
  const reader=request.body?.getReader();
  if(!reader)throw new RequestBodyError(400,"Request body is missing");
  let timer:ReturnType<typeof setTimeout>|undefined;
  let cancel:()=>void=()=>{};
  const interrupted=new Promise<never>((_resolve,reject)=>{
    cancel=()=>{void reader.cancel().catch(()=>{});reject(request.signal.reason??new DOMException("Canceled","AbortError"));};
    request.signal.addEventListener("abort",cancel,{once:true});
    timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new RequestBodyError(408,"Request body timed out"));},timeoutMs);
  });
  try{
    const read=async()=>{
      const parts:Uint8Array[]=[];let length=0;
      while(true){
        const {value,done}=await reader.read();if(done)break;
        length+=value.byteLength;
        if(length>maximum){await reader.cancel();throw new RequestBodyError(413,"Request is too large");}
        parts.push(value);
      }
      const bytes=new Uint8Array(length);let offset=0;
      for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
      return new TextDecoder().decode(bytes);
    };
    if(request.signal.aborted)cancel();
    return await Promise.race([read(),interrupted]);
  }finally{clearTimeout(timer);request.signal.removeEventListener("abort",cancel);reader.releaseLock();}
}
