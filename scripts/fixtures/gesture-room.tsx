"use client";
import { useState } from "react";
import { SongGesture } from "@/rebuild/app/SongGesture";
import { CollectionGesture } from "@/rebuild/app/CollectionGesture";
import { useSongSwipe } from "@/rebuild/app/useSongSwipe";
import { PlayerDialog } from "@/rebuild/player/Primitives";

export default function GestureRoom() {
  const [options, setOptions] = useState(0), [clicks, setClicks] = useState(0), [song, setSong] = useState(0);
  const [note, setNote] = useState(false), [inner, setInner] = useState(false), [locked, setLocked] = useState(false), [closes, setCloses] = useState(0);
  const swipe = useSongSwipe({ onNext: () => setSong(value => value + 1), onPrevious: () => setSong(value => value - 1) });
  return <div style={{padding:30}}>
    <h1>Gesture verification</h1>
    <SongGesture id="gesture-fixture" className="gesture-row" onOptions={() => setOptions(value => value + 1)}><a href="#fixture" onClick={event => {event.preventDefault();setClicks(value => value + 1);}} style={{display:"block",padding:28}}>A song with options</a><button aria-label="Like fixture song" onClick={() => setClicks(value => value + 1)}><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"/></svg></button><input aria-label="Gesture typing field" defaultValue="ordinary typing"/></SongGesture>
    <p data-options>{options}</p><p data-clicks>{clicks}</p>
    <CollectionGesture kind="album" id="gesture-collection" title="Gesture collection"><a href="#collection" onClick={event => event.preventDefault()} style={{display:"block",padding:28}}>Gesture collection</a></CollectionGesture>
    <button {...swipe.bind} style={{...swipe.style,width:300,height:140,display:"block"}} data-swipe-surface onClick={() => setClicks(value => value + 1)}>Turn the record</button><p data-song>{song}</p>
    <button onClick={() => {setLocked(false);setNote(true);}}>Open gesture note</button><button onClick={() => {setLocked(true);setNote(true);}}>Open locked note</button><p data-closes>{closes}</p>
    {note && <PlayerDialog title="Gesture note" onClose={() => {setNote(false);setCloses(value => value + 1);}} closeDisabled={locked}>
      <p tabIndex={0} data-note-focus>Gesture note keyboard boundary</p>
      <button onClick={() => setInner(true)}>Open inner note</button><button onClick={() => setLocked(false)}>Unlock note</button>
      <div data-scroll-fixture style={{height:240,overflowY:"auto"}}>{Array.from({length:30},(_,i) => <p key={i} style={{padding:10}}>Words on paper {i}</p>)}</div>
    </PlayerDialog>}
    {inner && <PlayerDialog title="Inner gesture note" onClose={() => setInner(false)}><p>The inner note keeps the outer note open.</p></PlayerDialog>}
    <div style={{height:800}}/>
  </div>;
}
