"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { SongMenuAnchor } from "./TrackActions";

/** Long press opens options; movement cancels the hold so ordinary scrolling wins. */
export function SongGesture({children,className,onOptions,id}:{children:ReactNode;className:string;onOptions:(anchor:SongMenuAnchor)=>void;id:string}){
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const press=useRef<{x:number;y:number}|null>(null);
  const suppress=useRef(0);
  function cancel(){if(timer.current)clearTimeout(timer.current);timer.current=null;press.current=null;}
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  return <div className={className} data-song-id={id} onPointerDown={event=>{
    if(event.pointerType==="mouse"||event.button!==0)return;
    const button=(event.target as HTMLElement).closest("button");
    if(button&&!button.getAttribute("aria-label")?.startsWith("Play "))return;
    cancel();press.current={x:event.clientX,y:event.clientY};const origin=press.current;
    timer.current=setTimeout(()=>{suppress.current=Date.now()+1000;onOptions({left:origin.x,top:origin.y,width:0,height:0});if(navigator.vibrate)navigator.vibrate(12);cancel();},460);
  }} onPointerMove={event=>{if(press.current&&Math.hypot(event.clientX-press.current.x,event.clientY-press.current.y)>9)cancel();}} onPointerUp={cancel} onPointerCancel={cancel} onClickCapture={event=>{if(Date.now()<suppress.current){event.preventDefault();event.stopPropagation();}}} onContextMenu={event=>{if(event.shiftKey)return;event.preventDefault();cancel();onOptions({left:event.clientX,top:event.clientY,width:0,height:0});}}>{children}</div>;
}
