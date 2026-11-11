"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pushMusicUrl } from "./offlineNavigation";
import { useMusic } from "./MusicContext";
import { Icon } from "./Icon";
import { PlayerDialog } from "../player/Primitives";
import { topDialog as activeDialog } from "./dialogLifecycle";
import { PLAYBACK_SHORTCUTS, playbackDialogAllowsShortcuts, playbackShortcut, shortcutTargetIsInteractive } from "./playbackShortcuts";
import s from "./keyboard.module.css";

export function PlaybackKeyboard() {
  const music=useMusic(),router=useRouter(),latest=useRef(music),lastVolume=useRef(.8);
  const [open,setOpen]=useState(false);
  useEffect(()=>{latest.current=music;if(music.volume>0)lastVolume.current=music.volume;},[music]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(open)return;
      const p=latest.current;
      const topDialog=activeDialog();
      // Naming, sharing, confirmation, and preview dialogs retain native keys.
      if(topDialog&&!playbackDialogAllowsShortcuts(topDialog.dataset.dialogAppearance))return;
      const action=playbackShortcut(event,shortcutTargetIsInteractive(event.target));
      if(event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.code==="Space"||event.key===" ") && !shortcutTargetIsInteractive(event.target)){event.preventDefault();return;}
      if(!action||p.booting||!p.account)return;
      if(action==="search") { if(topDialog)return;event.preventDefault();pushMusicUrl(router,"/search");return; }
      if(action==="help") {event.preventDefault();setOpen(true);return;}
      if(!p.track)return;
      event.preventDefault();
      switch(action){
        case "play":p.togglePlay();break;
        case "previous":p.previous();break;
        case "next":p.next();break;
        case "seekBack":p.seek((p.getPlaybackPosition?.()??p.positionMs)-5000);break;
        case "seekForward":p.seek((p.getPlaybackPosition?.()??p.positionMs)+5000);break;
        case "volumeUp":p.setVolume(Math.min(1,p.volume+.05));break;
        case "volumeDown":p.setVolume(Math.max(0,p.volume-.05));break;
        case "mute":p.setVolume(p.volume>0?0:lastVolume.current);break;
        case "shuffle":p.setShuffle(!p.shuffle);break;
        case "repeat":p.setRepeat(p.repeat==="off"?"all":p.repeat==="all"?"one":"off");break;
        case "lyrics":p.openModal("lyrics");break;
        case "queue":p.openModal("queue");break;
        case "player":p.openModal("player");break;
      }
    };
    window.addEventListener("keydown",key);
    return()=>window.removeEventListener("keydown",key);
  },[open,router]);
  return <><button className={s.trigger} type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" aria-keyshortcuts="Shift+/" onClick={()=>setOpen(true)}><Icon name="keyboard" size={19}/></button>{open&&<PlayerDialog title="A few little shortcuts." subtitle="AT YOUR FINGERTIPS" onClose={()=>setOpen(false)}><p className={s.note}>Keep your place in the music.</p><dl className={s.shortcuts}>{PLAYBACK_SHORTCUTS.map(item=><div key={item.action}><dt>{item.label}</dt><dd><kbd>{item.keys}</kbd></dd></div>)}</dl><p className={s.footnote}>Space plays or pauses on lyric lines and transport controls; Enter activates the focused button. Forms, menus and sliders keep their native keys. Press Escape to close a listening window. On a song or collection, Shift + F10 opens its options.</p></PlayerDialog>}</>;
}
