import assert from "node:assert/strict";
import { test } from "node:test";
import { playbackDialogAllowsShortcuts, playbackShortcut } from "../src/rebuild/app/playbackShortcuts";

test("playback shortcuts distinguish song changes, seeking, and system combinations",()=>{
  assert.equal(playbackShortcut({key:"ArrowRight",shiftKey:true}),"next");
  assert.equal(playbackShortcut({key:"ArrowLeft"}),"seekBack");
  assert.equal(playbackShortcut({key:"ArrowUp"}),"volumeUp");
  assert.equal(playbackShortcut({key:"k",metaKey:true},true),"search");
  assert.equal(playbackShortcut({key:"k",ctrlKey:true},true),"search");
  assert.equal(playbackShortcut({key:"l",metaKey:true}),null);
  assert.equal(playbackShortcut({key:"ArrowLeft",altKey:true}),null);
  assert.equal(playbackShortcut({key:"?",shiftKey:true}),"help");
  assert.equal(playbackShortcut({key:"/",code:"Slash",shiftKey:true}),"help");
});
test("typing, native controls, IME and handled keys cannot trigger playback",()=>{
  for(const key of [" ","m","s","r","f","l","q","ArrowLeft","ArrowRight","?"])
    assert.equal(playbackShortcut({key},true),null,key);
  assert.equal(playbackShortcut({key:"l",isComposing:true}),null);
  assert.equal(playbackShortcut({key:" ",defaultPrevented:true}),null);
});
test("holding a key repeats only continuous seek and volume adjustments",()=>{
  assert.equal(playbackShortcut({key:"ArrowRight",repeat:true}),"seekForward");
  assert.equal(playbackShortcut({key:"ArrowDown",repeat:true}),"volumeDown");
  for(const key of [" ","m","s","r","f","l","q","?"])
    assert.equal(playbackShortcut({key,repeat:true}),null,key);
  assert.equal(playbackShortcut({key:"ArrowRight",shiftKey:true,repeat:true}),null);
});
test("confirmation and form dialogs own every key while listening views allow playback",()=>{
  for(const appearance of [undefined,"","note","share"])
    assert.equal(playbackDialogAllowsShortcuts(appearance),false,String(appearance));
  for(const appearance of ["player","lyrics","queue"])
    assert.equal(playbackDialogAllowsShortcuts(appearance),true,appearance);
});
