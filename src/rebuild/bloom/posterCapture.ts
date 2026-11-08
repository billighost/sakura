import {createElement} from "react";
import {createRoot} from "react-dom/client";
import {BloomPoster} from "./BloomPoster";
import type {BloomDesign,BloomRecap} from "./uiTypes";
import type {BloomQuality} from "./worlds/types";

const properties=["display","position","inset","top","right","bottom","left","z-index","width","height","min-width","min-height","max-width","max-height","box-sizing","margin","padding","overflow","overflow-x","overflow-y","border","border-radius","outline","outline-offset","background","background-color","background-image","background-size","background-position","opacity","color","font-size","font-weight","font-style","font-family","line-height","letter-spacing","text-align","text-transform","text-decoration","text-wrap","white-space","overflow-wrap","word-break","vertical-align","box-shadow","text-shadow","transform","transform-origin","clip-path","filter","isolation","mix-blend-mode","object-fit","object-position","aspect-ratio","flex","flex-direction","flex-wrap","align-items","align-self","justify-content","justify-self","gap","grid-template-columns","grid-template-rows","grid-column","grid-row","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","stop-color","stop-opacity","flood-color","flood-opacity","color-interpolation-filters","paint-order","vector-effect","visibility"];
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
function dataUrl(blob:Blob){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});}
const svgProperties=["display","visibility","opacity","color","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","stop-color","stop-opacity","flood-color","flood-opacity","filter","clip-path","transform","transform-origin","transform-box","paint-order","vector-effect"];
function copyStyles(style:CSSStyleDeclaration,svgLeaf=false){return (svgLeaf?svgProperties:properties).map(property=>`${property}:${style.getPropertyValue(property).replace(/url\(["']?[^)"']*#([^)"]+)["']?\)/g,"url(#$1)")}`).join(";");}

/** Capture a separately composed, fully static theme poster; all resources are inline. */
export async function exportCinematicBloom(recap:BloomRecap,design:BloomDesign,theme:"light"|"dark",demo:boolean,quality:BloomQuality){
 const width=540,height=960,host=document.createElement("div");
 host.style.cssText=`position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;--font-fraunces:Georgia;--font-inter:Arial`;
 host.inert=true;host.setAttribute("aria-hidden","true");document.body.append(host);
 const root=createRoot(host);
 try{
  root.render(createElement(BloomPoster,{recap,design,theme,demo,quality}));
  const deadline=performance.now()+15000;
  while(!host.querySelector('[data-view="poster"]')){if(performance.now()>deadline)throw new Error("The illustrated poster could not load. Please try again.");await frame();}
  await document.fonts.ready;await frame();await frame();
  await Promise.all([...host.querySelectorAll("img")].map(image=>Promise.race([image.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,8000))])));
  await frame();
  const original=host.firstElementChild!;
  // A poster has a fixed page, unlike the scrolling story. Preserve full titles
  // and the closing line when a world's composition or long credits need room.
  const content=original.querySelector<HTMLElement>(".bloom-content");
  if(content){
   const page=original.getBoundingClientRect(),box=content.getBoundingClientRect();
   const availableHeight=Math.max(1,height-24-(box.top-page.top));
   const scale=Math.min(1,availableHeight/Math.max(1,box.height));
   if(scale<1){content.style.transformOrigin="top center";content.style.transform=`scale(${scale})`;await frame();}
  }
  const cloned=original.cloneNode(true) as HTMLElement;
  const originals=[original,...original.querySelectorAll("*")],copies=[cloned,...cloned.querySelectorAll("*")];
  const pseudoStyles:string[]=[];
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
    const response=await fetch(source.currentSrc||source.src,{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error("The song artwork could not be saved. Please try again.");
    copy.src=await dataUrl(await response.blob());copy.removeAttribute("srcset");copy.removeAttribute("loading");
   }
  }
  // Keep multilingual metadata legible without external font resources in the SVG.
  cloned.style.fontFamily="Arial, sans-serif";
  const serialized=new XMLSerializer().serializeToString(cloned);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width*2}" height="${height*2}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml"><style>${pseudoStyles.join("")}</style>${serialized}</div></foreignObject></svg>`;
  const image=new Image();image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;await image.decode();
  const canvas=document.createElement("canvas");canvas.width=width*2;canvas.height=height*2;
  const context=canvas.getContext("2d");if(!context)throw new Error("Image export is unavailable.");context.drawImage(image,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("The poster could not be saved.")),"image/png"));
  return new File([blob],`sakura-bloom-${recap.id}-${design}.png`,{type:"image/png"});
 }finally{root.unmount();host.remove();}
}
