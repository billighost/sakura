"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { SongMenuAnchor } from "./TrackActions";
import { holdMoved } from "./gestureIntent";
import s from "./touch.module.css";

const nativeControlSelector = 'input,textarea,select,option,audio,video,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="option"],[role="slider"],[role="spinbutton"],[role="switch"],[role="checkbox"],[role="radio"]';

function ownsNativeGesture(target: EventTarget | null) {
  return target instanceof Element && ((target instanceof HTMLElement && target.isContentEditable) || !!target.closest(nativeControlSelector));
}

function ownsButtonGesture(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const button = target.closest("button");
  return !!button && !/^(Play|Pause) /.test(button.getAttribute("aria-label") || "");
}

/** Long press opens options; movement cancels the hold so ordinary scrolling wins. */
export function SongGesture({children,className,onOptions,id,label,entity="song"}:{children:ReactNode;className:string;onOptions:(anchor:SongMenuAnchor)=>void;id:string;label?:string;entity?:"song"|"collection"}){
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const surface=useRef<HTMLDivElement>(null);
  const press=useRef<{x:number;y:number;id:number}|null>(null);
  const suppress=useRef(0);
  function cancel(){if(timer.current)clearTimeout(timer.current);timer.current=null;press.current=null;if(surface.current)delete surface.current.dataset.pressPhase;}
  useEffect(()=>{
    function abort(){cancel();}
    function secondaryPointer(event:PointerEvent){if(!event.isPrimary)cancel();}
    document.addEventListener("scroll",abort,true);window.addEventListener("blur",abort);document.addEventListener("visibilitychange",abort);
    document.addEventListener("pointerdown",secondaryPointer,true);
    return()=>{if(timer.current)clearTimeout(timer.current);document.removeEventListener("scroll",abort,true);window.removeEventListener("blur",abort);document.removeEventListener("visibilitychange",abort);document.removeEventListener("pointerdown",secondaryPointer,true);};
  },[]);
  return <div ref={surface} className={`${className} ${s.contextSurface}`} title="Hold or right-click for options (Shift+F10)" aria-keyshortcuts="Shift+F10" data-song-id={entity==="song"?id:undefined} data-collection-id={entity==="collection"?id:undefined} data-options-label={label||undefined} onPointerDown={event=>{
    if(event.isPrimary&&event.pointerType==="mouse")suppress.current=0;
    if(!event.isPrimary||event.pointerType==="mouse"||event.button!==0)return;
    if(press.current){cancel();return;}
    if(ownsNativeGesture(event.target)||ownsButtonGesture(event.target))return;
    cancel();press.current={x:event.clientX,y:event.clientY,id:event.pointerId};const origin=press.current;
    event.currentTarget.dataset.pressPhase="pending";
    timer.current=setTimeout(()=>{suppress.current=Date.now()+1000;onOptions({left:origin.x,top:origin.y,width:0,height:0});if(navigator.vibrate)navigator.vibrate(12);cancel();},460);
  }} onPointerMove={event=>{if(press.current&&(press.current.id!==event.pointerId||holdMoved(event.clientX-press.current.x,event.clientY-press.current.y)))cancel();}} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onClickCapture={event=>{if(event.detail>0&&Date.now()<suppress.current){event.preventDefault();event.stopPropagation();}}} onContextMenu={event=>{
    if(event.shiftKey||ownsNativeGesture(event.target)||ownsButtonGesture(event.target)){cancel();return;}
    event.preventDefault();cancel();
    if(Date.now()<suppress.current)return;
    onOptions({left:event.clientX,top:event.clientY,width:0,height:0});
  }} onKeyDown={event=>{
    if(event.key!=="ContextMenu"&&!(event.shiftKey&&event.key==="F10"))return;
    if(ownsNativeGesture(event.target)||ownsButtonGesture(event.target)){cancel();return;}
    event.preventDefault();event.stopPropagation();cancel();
    // Some browsers dispatch a native contextmenu after the keyboard command as well.
    suppress.current=Date.now()+500;
    const focused=event.target instanceof HTMLElement?event.target:event.currentTarget,rect=focused.getBoundingClientRect();
    onOptions({left:rect.left,top:rect.top,width:rect.width,height:rect.height});
  }} onKeyUp={event=>{
    if(event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10")){event.preventDefault();event.stopPropagation();}
  }}>{children}</div>;
}
