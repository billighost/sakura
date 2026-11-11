import {createElement} from "react";
import {createRoot} from "react-dom/client";
import {BloomPoster} from "./BloomPoster";
import type {BloomDesign,BloomRecap} from "./uiTypes";
import type {BloomQuality} from "./worlds/types";
import {checkExportCanceled,exportCheckpoint,yieldExport} from "../player/exportWork";

const properties=["display","position","inset","top","right","bottom","left","z-index","width","height","min-width","min-height","max-width","max-height","box-sizing","margin","padding","overflow","overflow-x","overflow-y","border","border-radius","outline","outline-offset","background","background-color","background-image","background-size","background-position","opacity","color","font-size","font-weight","font-style","font-family","line-height","letter-spacing","text-align","text-transform","text-decoration","text-wrap","white-space","overflow-wrap","word-break","vertical-align","box-shadow","text-shadow","transform","translate","scale","rotate","transform-origin","clip-path","filter","isolation","mix-blend-mode","object-fit","object-position","aspect-ratio","flex","flex-direction","flex-wrap","align-items","align-self","justify-content","justify-self","gap","grid-template-columns","grid-template-rows","grid-column","grid-row","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","stop-color","stop-opacity","flood-color","flood-opacity","color-interpolation-filters","paint-order","vector-effect","visibility"];
const frame=(signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 checkExportCanceled(signal);
 const clean=()=>signal?.removeEventListener("abort",canceled);
 const id=requestAnimationFrame(()=>{clean();resolve();});
 const canceled=()=>{cancelAnimationFrame(id);clean();reject(new DOMException("Canceled","AbortError"));};
 signal?.addEventListener("abort",canceled,{once:true});
});
const decodedImage=(image:HTMLImageElement,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 checkExportCanceled(signal);
 const clean=()=>{clearTimeout(timer);signal?.removeEventListener("abort",canceled);};
 const done=()=>{clean();resolve();};
 const canceled=()=>{clean();reject(new DOMException("Canceled","AbortError"));};
 const timer=setTimeout(done,8000);
 signal?.addEventListener("abort",canceled,{once:true});
 void image.decode().catch(()=>{}).finally(done);
});
function dataUrl(blob:Blob){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});}
const svgProperties=["display","visibility","opacity","color","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","stop-color","stop-opacity","flood-color","flood-opacity","filter","clip-path","transform","translate","scale","rotate","transform-origin","transform-box","paint-order","vector-effect"];
function copyStyles(style:CSSStyleDeclaration,svgLeaf=false){return (svgLeaf?svgProperties:properties).map(property=>`${property}:${style.getPropertyValue(property).replace(/url\(["']?[^)"']*#([^)"]+)["']?\)/g,"url(#$1)")}`).join(";");}

/** Capture a separately composed, fully static theme poster; all resources are inline. */
export async function exportCinematicBloom(recap:BloomRecap,design:BloomDesign,theme:"light"|"dark",demo:boolean,quality:BloomQuality,signal?:AbortSignal){
 await yieldExport(signal);
 const width=540,height=960,host=document.createElement("div");
 host.style.cssText=`position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;--font-fraunces:Georgia;--font-inter:Arial`;
 host.inert=true;host.setAttribute("aria-hidden","true");document.body.append(host);
 const root=createRoot(host);
 try{
  root.render(createElement(BloomPoster,{recap,design,theme,demo,quality}));
  const deadline=performance.now()+15000;
  while(!host.querySelector('[data-view="poster"]')){if(performance.now()>deadline)throw new Error("The illustrated poster could not load. Please try again.");await frame(signal);}
  await document.fonts.ready;await frame(signal);await frame(signal);
  await Promise.all([...host.querySelectorAll("img")].map(image=>decodedImage(image,signal)));
  await frame(signal);
  const original=host.firstElementChild!;
  // A poster has a fixed page, unlike the scrolling story. Preserve full titles
  // and the closing line when a world's composition or long credits need room.
  const content=original.querySelector<HTMLElement>(".bloom-content");
  if(content){
   const page=original.getBoundingClientRect(),box=content.getBoundingClientRect();
   const availableHeight=Math.max(1,height-24-(box.top-page.top));
   const scale=Math.min(1,availableHeight/Math.max(1,box.height));
   if(scale<1){content.style.transformOrigin="top center";content.style.transform=`scale(${scale})`;await frame(signal);}
  }
  const cloned=original.cloneNode(true) as HTMLElement;
  const originals=[original,...original.querySelectorAll("*")],copies=[cloned,...cloned.querySelectorAll("*")];
  const pseudoStyles:string[]=[];
  const checkpoint=exportCheckpoint(signal);
  const imageCopies:Array<{copy:HTMLImageElement;url:string}>=[];
  for(let index=0;index<originals.length;index++){
   const source=originals[index],copy=copies[index];
   if(!(copy instanceof HTMLElement||copy instanceof SVGElement))continue;
   copy.setAttribute("style",copyStyles(getComputedStyle(source),source instanceof SVGElement&&source.tagName.toLowerCase()!=="svg"));
   copy.style.setProperty("animation","none");copy.style.setProperty("transition","none");
   copy.setAttribute("data-poster-node",String(index));
   if(source instanceof HTMLElement)for(const pseudo of ["::before","::after"]){
    const style=getComputedStyle(source,pseudo);
    if(style.content!=="none"&&style.content!=="normal")pseudoStyles.push(`[data-poster-node="${index}"]${pseudo}{${copyStyles(style)};content:${style.content}}`);
   }
   if(source instanceof HTMLImageElement&&copy instanceof HTMLImageElement){
    imageCopies.push({copy,url:source.currentSrc||source.src});
   }
   await checkpoint();
  }
  const imageFlights=new Map<string,Promise<string>>();
  for(let start=0;start<imageCopies.length;start+=4)await Promise.all(imageCopies.slice(start,start+4).map(async({copy,url})=>{
   let flight=imageFlights.get(url);
   if(!flight){flight=(async()=>{
    const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener("abort",cancel,{once:true});
    const timer=setTimeout(cancel,8000);if(signal?.aborted)cancel();
    try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error("The song artwork could not be saved. Please try again.");return await dataUrl(await response.blob());}
    finally{clearTimeout(timer);signal?.removeEventListener("abort",cancel);}
   })();imageFlights.set(url,flight);}
   copy.src=await flight;copy.removeAttribute("srcset");copy.removeAttribute("loading");
  }));
  await yieldExport(signal);
  // Keep multilingual metadata legible without external font resources in the SVG.
  cloned.style.fontFamily="Arial, sans-serif";
  const serialized=new XMLSerializer().serializeToString(cloned);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width*2}" height="${height*2}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml"><style>${pseudoStyles.join("")}</style>${serialized}</div></foreignObject></svg>`;
  const image=new Image();image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;await image.decode();
  const canvas=document.createElement("canvas");canvas.width=width*2;canvas.height=height*2;
  try{
   checkExportCanceled(signal);
   const context=canvas.getContext("2d");if(!context)throw new Error("Image export is unavailable.");context.drawImage(image,0,0);
   await yieldExport(signal);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("The poster could not be saved.")),"image/png"));
   checkExportCanceled(signal);return new File([blob],`sakura-bloom-${recap.id}-${design}.png`,{type:"image/png"});
  }finally{canvas.width=0;canvas.height=0;image.src="";}
 }finally{root.unmount();host.remove();}
}
