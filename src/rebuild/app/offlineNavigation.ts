/** Music pages fetch their account data on the client. Keep that same renderer
 * available when a Server Component navigation cannot reach the server. */
const routeEvent="sakura-local-navigation";
let shellMode=false;
let pendingNavigation:{href:string;replace:boolean;at:number}|null=null;
const listeners=new Set<()=>void>();
export function musicRoute(pathname:string):string[]|null{
 const route=pathname.split("/").filter(Boolean).map(part=>{try{return decodeURIComponent(part);}catch{return part;}});
 if(route.length===1&&["home","discover","search","library","liked","downloads","offline","profile","settings","onboarding","import","bloom"].includes(route[0]))return route;
 if(route.length===2&&(route[0]==="library"&&route[1]==="downloaded"||["artist","album","playlist","mix","track","bloom"].includes(route[0])))return route;
 return null;
}
function changed(){for(const listener of listeners)listener();window.dispatchEvent(new Event(routeEvent));}
export function localRouteSnapshot(){return typeof window!=="undefined"&&shellMode?window.location.pathname:"";}
export function subscribeLocalRoute(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function enterOfflineShell(){if(!shellMode){
 shellMode=true;
 const pending=pendingNavigation;pendingNavigation=null;
 if(pending&&Date.now()-pending.at<30000&&new URL(pending.href,location.href).href!==location.href)window.history[pending.replace?"replaceState":"pushState"](null,"",pending.href);
 else window.history.replaceState(null,"",window.location.href);
 changed();
}}
export function offlineShellActive(){return shellMode||typeof navigator!=="undefined"&&!navigator.onLine;}
export function replaceMusicUrl(router:{replace:(href:string,options?:{scroll?:boolean})=>void},href:string,options?:{scroll?:boolean}){
 if(offlineShellActive()&&musicRoute(new URL(href,location.href).pathname)){
  pendingNavigation=null;enterOfflineShell();window.history.replaceState(null,"",href);changed();
 }else{pendingNavigation={href,replace:true,at:Date.now()};router.replace(href,options);}
}
export function pushMusicUrl(router:{push:(href:string,options?:{scroll?:boolean})=>void},href:string,options?:{scroll?:boolean}){
 if(offlineShellActive()&&musicRoute(new URL(href,location.href).pathname)){
  pendingNavigation=null;enterOfflineShell();window.history.pushState(null,"",href);changed();
 }else{pendingNavigation={href,replace:false,at:Date.now()};router.push(href,options);}
}
export function installOfflineNavigation(isOffline:()=>boolean){
 const click=(event:MouseEvent)=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
  const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>("a[href]"):null;
  if(!anchor||anchor.hasAttribute("download")||anchor.target&&anchor.target!=="_self")return;
  const target=new URL(anchor.href,location.href);
  if(target.origin!==location.origin||!musicRoute(target.pathname))return;
  if(!(shellMode||isOffline()||!navigator.onLine)){pendingNavigation={href:target.pathname+target.search+target.hash,replace:false,at:Date.now()};return;}
  // Let same-page fragments keep their existing scroll/focus behavior.
  if(target.pathname===location.pathname&&target.search===location.search&&target.hash)return;
  event.preventDefault();event.stopPropagation();pendingNavigation=null;enterOfflineShell();
  if(target.href!==location.href)window.history.pushState(null,"",target.pathname+target.search+target.hash);
  changed();
 };
 const pop=()=>{if(shellMode)changed();};
 document.addEventListener("click",click,true);window.addEventListener("popstate",pop);
 return()=>{document.removeEventListener("click",click,true);window.removeEventListener("popstate",pop);};
}
export function rememberMusicRoute(pathname:string){
 if(pendingNavigation&&typeof location!=="undefined"&&new URL(pendingNavigation.href,location.href).pathname===pathname)pendingNavigation=null;
 if(typeof navigator==="undefined"||!("serviceWorker" in navigator)||!navigator.onLine||!musicRoute(pathname))return;
 navigator.serviceWorker.controller?.postMessage({type:"sakura-cache-route",path:pathname});
}
