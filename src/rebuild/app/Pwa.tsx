"use client";
import { useEffect } from "react";
export function Pwa() {
 useEffect(()=>{
  const theme=()=>{const color=document.documentElement.dataset.inkTheme==="dark"?"#18241f":"#f5f5ee";for(const element of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))element.content=color;};
  theme();const observer=new MutationObserver(theme);observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-ink-theme"]});return()=>observer.disconnect();
 },[]);
 useEffect(() => {
  if (!("serviceWorker" in navigator)) return;
  if(process.env.NODE_ENV!=="production"){
   void navigator.serviceWorker.getRegistrations().then(list=>Promise.all(list.filter(item=>[item.active,item.waiting,item.installing].some(worker=>worker&&new URL(worker.scriptURL).pathname==="/sw.js")).map(item=>item.unregister()))).catch(()=>{});
   return;
  }
  let live=true,registration:ServiceWorkerRegistration|undefined;
  const warm=()=>navigator.serviceWorker.controller?.postMessage({type:"sakura-warm-shell"});
  const refresh=()=>{if(navigator.onLine&&document.visibilityState==="visible")void registration?.update().catch(()=>{});};
  navigator.serviceWorker.addEventListener("controllerchange",warm);
  window.addEventListener("online",refresh);document.addEventListener("visibilitychange",refresh);
  void navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).then(value=>{
   if(!live)return;registration=value;warm();
  }).catch(()=>{if(live)window.dispatchEvent(new CustomEvent("sakura-pwa-status",{detail:{ready:false}}));});
  return()=>{live=false;navigator.serviceWorker.removeEventListener("controllerchange",warm);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",refresh);};
 }, []);
 return null;
}
