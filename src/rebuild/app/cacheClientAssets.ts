/** Let a replacement worker retain modules used by an older, still-open tab. */
export function clientStaticAssets():{assets:string[];assetsComplete:boolean}{
 if(typeof document==="undefined"||typeof location==="undefined")return {assets:[],assetsComplete:false};
 const assets=new Set<string>();let complete=document.readyState!=="loading";
 const add=(value:string)=>{try{const url=new URL(value,location.href);if(url.origin===location.origin&&url.pathname.startsWith("/_next/static/")){if(assets.size<512)assets.add(url.pathname);else complete=false;}}catch{complete=false;}};
 for(const element of document.querySelectorAll<HTMLScriptElement|HTMLLinkElement>("script[src],link[href]"))add(element instanceof HTMLScriptElement?element.src:element.href);
 try{const entries=performance.getEntriesByType("resource");if(entries.length>=250)complete=false;for(const entry of entries)add(entry.name);}catch{complete=false;}
 return {assets:[...assets],assetsComplete:complete};
}

/** Wait until the controlling worker has durably stored lazy module responses. */
export function waitForClientAssetCache(timeoutMs=15000):Promise<void>{
 const worker=typeof navigator!=="undefined"?navigator.serviceWorker?.controller:null;
 if(!worker)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel();let settled=false;
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);channel.port1.close();channel.port2.close();if(error)reject(error);else resolve();};
  const timer=setTimeout(()=>finish(new Error("Offline assets were not saved in time.")),timeoutMs);
  channel.port1.onmessage=event=>finish(event.data?.status==="ready"?undefined:new Error("Offline assets could not be saved."));
  channel.port1.onmessageerror=()=>finish(new Error("Offline asset confirmation was interrupted."));
  try{worker.postMessage({type:"sakura-assets-ready"},[channel.port2]);}catch(error){finish(error instanceof Error?error:new Error("Offline asset confirmation failed."));}
 });
}
