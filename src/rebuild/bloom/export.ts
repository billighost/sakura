import type {BloomDesign,BloomRecap} from "./uiTypes";
import type {BloomQuality} from "./worlds/types";
export async function exportBloomCard(recap:BloomRecap,design:BloomDesign,theme:"light"|"dark",demo=false,_liveCanvas?:HTMLElement,quality:BloomQuality=5){
 if(!["herbarium","nocturne","risograph"].includes(design)){
  const {exportCinematicBloom}=await import("./posterCapture");
  return exportCinematicBloom(recap,design,theme,demo,quality);
 }
 return exportLegacyBloomCard(recap,design,theme,demo);
}
async function exportLegacyBloomCard(recap:BloomRecap,design:BloomDesign,theme:"light"|"dark",demo=false){
 const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=1920;const context=canvas.getContext("2d");if(!context)throw new Error("Canvas unavailable");const ctx=context;
 await document.fonts.ready;
 const colors=design==="herbarium"?(theme==="dark"?["#172922","#e6e7cb","#c39b97"]:["#f3f1dc","#344e3d","#bc7a86"]):design==="nocturne"?(theme==="dark"?["#10182c","#ece6f5","#c6a7ed"]:["#e8e5f0","#26213f","#77609b"]):(theme==="dark"?["#261d34","#fbded0","#f38d69"]:["#f8d5b6","#37214d","#ef6946"]);
 const [bg,ink,accent]=colors;ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1920);
 if(design==="herbarium"){ctx.save();ctx.translate(850,380);ctx.rotate(.2);ctx.globalAlpha=.3;for(let i=0;i<8;i++){ctx.rotate(Math.PI/4);ctx.beginPath();ctx.ellipse(0,-130,80,190,0,0,Math.PI*2);ctx.fillStyle=accent;ctx.fill();}ctx.restore();ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(1020,120);ctx.bezierCurveTo(700,300,1100,650,620,1750);ctx.stroke();for(let i=0;i<4;i++){ctx.save();ctx.translate(1000-i*65,700+i*220);ctx.rotate(i%2?.5:-.6);ctx.globalAlpha=.16;ctx.fillStyle=accent;ctx.beginPath();ctx.ellipse(0,0,40,130,0,0,Math.PI*2);ctx.fill();ctx.restore();}}
 else if(design==="nocturne"){ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.globalAlpha=.4;for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(850,370,160+i*45,230+i*20,i*.55,0,Math.PI*2);ctx.stroke();}ctx.fillStyle=accent;for(let i=0;i<75;i++){ctx.beginPath();ctx.arc((i*193+37)%1080,(i*137+19)%1920,i%8===0?3:1,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
 else{ctx.save();ctx.globalAlpha=.18;ctx.fillStyle=accent;ctx.translate(850,370);ctx.rotate(-.15);ctx.fillRect(-250,-250,500,530);ctx.fillStyle=ink;ctx.beginPath();ctx.arc(90,250,210,0,Math.PI*2);ctx.fill();ctx.restore();ctx.save();ctx.translate(850,380);ctx.globalAlpha=.6;ctx.fillStyle=accent;for(let i=0;i<5;i++){ctx.rotate(Math.PI*2/5);ctx.beginPath();ctx.ellipse(0,-80,70,140,0,0,Math.PI*2);ctx.fill();}ctx.restore();ctx.strokeStyle=ink;ctx.globalAlpha=.4;for(const [x,y]of [[45,40],[1035,1880]]){ctx.beginPath();ctx.moveTo(x-14,y);ctx.lineTo(x+14,y);ctx.moveTo(x,y-14);ctx.lineTo(x,y+14);ctx.stroke();}ctx.globalAlpha=1;}
 const body=getComputedStyle(document.body);const serif=body.getPropertyValue("--font-fraunces").trim()||"Georgia";const sans=body.getPropertyValue("--font-inter").trim()||"Arial";
 ctx.fillStyle=ink;ctx.font=`44px ${serif}`;ctx.fillText("sakura bloom",80,100);ctx.font=`20px ${sans}`;ctx.fillText(`${recap.period.toUpperCase()} · ${recap.id.replace(/^(weekly|monthly|yearly)-/,"")}`,80,146);
 ctx.font=`88px ${serif}`;ctx.fillText("This season",80,310);ctx.fillText("in music.",80,410);
 function lines(value:string,width:number,font:string){ctx.font=font;const result:string[]=[];let line="";for(const {segment}of new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(value)){if(line&&ctx.measureText(line+segment).width>width){result.push(line.trim());line=segment.trimStart();}else line+=segment;}if(line)result.push(line.trim());return result;}
 const chapters=recap.chapters.filter(c=>c.stat).slice(0,8);const height=Math.min(200,1200/Math.max(1,chapters.length));let y=560;
 for(const chapter of chapters){const stat=chapter.stat!;const value=`${stat.value}${stat.unit?" "+stat.unit:""}`;let size=54;let valueLines=lines(value,900,`${size}px ${serif}`);while(valueLines.length>2&&size>20){size-=2;valueLines=lines(value,900,`${size}px ${serif}`);}ctx.fillStyle=ink;ctx.font=`${size}px ${serif}`;let baseline=y;for(const line of valueLines.slice(0,2)){ctx.fillText(line,80,baseline);baseline+=size+6;}ctx.fillStyle=accent;ctx.font=`24px ${sans}`;for(const line of lines(stat.label,880,`24px ${sans}`).slice(0,2)){ctx.fillText(line,80,baseline);baseline+=29;}ctx.strokeStyle=accent;ctx.globalAlpha=.25;ctx.beginPath();ctx.moveTo(80,y+height-26);ctx.lineTo(930,y+height-26);ctx.stroke();ctx.globalAlpha=1;y+=height;}
 ctx.fillStyle=ink;ctx.font=`italic 27px ${serif}`;ctx.fillText("The songs and artists in your listening story.",80,1840);
 if(demo){ctx.font=`18px ${sans}`;ctx.fillStyle=accent;ctx.fillText("DESIGN PREVIEW · SAMPLE LISTENING",80,1880);}
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Image unavailable")),"image/png"));return new File([blob],`sakura-bloom-${recap.id}.png`,{type:"image/png"});
}
