export type PlaybackShortcut = "search" | "help" | "play" | "previous" | "next" | "seekBack" | "seekForward" | "volumeUp" | "volumeDown" | "mute" | "shuffle" | "repeat" | "lyrics" | "queue" | "player";

export const PLAYBACK_SHORTCUTS: readonly {action: PlaybackShortcut; keys: string; label: string}[] = [
  {action:"play",keys:"Space",label:"Play or pause"},
  {action:"previous",keys:"Shift + ←",label:"Previous song"},
  {action:"next",keys:"Shift + →",label:"Next song"},
  {action:"seekBack",keys:"← / →",label:"Seek back or forward five seconds"},
  {action:"volumeUp",keys:"↑ / ↓",label:"Raise or lower volume"},
  {action:"mute",keys:"M",label:"Mute or unmute"},
  {action:"shuffle",keys:"S",label:"Shuffle"},
  {action:"repeat",keys:"R",label:"Change repeat mode"},
  {action:"lyrics",keys:"L",label:"Open lyrics"},
  {action:"queue",keys:"Q",label:"Open queue"},
  {action:"player",keys:"F",label:"Open the listening room"},
  {action:"search",keys:"Ctrl / ⌘ + K",label:"Find music"},
  {action:"help",keys:"?",label:"Show keyboard shortcuts"},
];

/** Native controls keep their own keyboard behavior, including custom listboxes. */
export function shortcutTargetIsInteractive(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  const element = target instanceof HTMLElement ? target : null;
  if (target.closest('[data-playback-shortcuts="listening"]') && !target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="menu"],[role="listbox"],[data-playback-shortcuts="off"]')) return false;
  return !!(element?.isContentEditable || target.closest('input,textarea,select,option,button,summary,a[href],audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[data-playback-shortcuts="off"],[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="option"],[role="menu"],[role="menuitem"],[role="slider"],[role="spinbutton"],[role="switch"],[role="tab"],[role="checkbox"],[role="radio"],[role="tree"],[role="treeitem"],[role="grid"],[role="gridcell"]'));
}

/** Destructive, sharing, and form dialogs keep full ownership of their keys. */
export function playbackDialogAllowsShortcuts(appearance: string | undefined): boolean {
  return appearance === "player" || appearance === "lyrics" || appearance === "queue";
}

export function playbackShortcut(event: {key:string;code?:string;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;shiftKey?:boolean;repeat?:boolean;isComposing?:boolean;defaultPrevented?:boolean}, interactive = false): PlaybackShortcut | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) return key === "k" && !event.shiftKey && !event.repeat ? "search" : null;
  if (interactive) return null;
  let action: PlaybackShortcut | null = null;
  if (event.key === "?" || event.shiftKey && event.code === "Slash") action = "help";
  else if (event.key === "ArrowLeft") action = event.shiftKey ? "previous" : "seekBack";
  else if (event.key === "ArrowRight") action = event.shiftKey ? "next" : "seekForward";
  else if (!event.shiftKey) {
    if (event.key === "ArrowUp") action = "volumeUp";
    else if (event.key === "ArrowDown") action = "volumeDown";
    else if (event.code === "Space" || event.key === " ") action = "play";
    else action = ({m:"mute",s:"shuffle",r:"repeat",l:"lyrics",q:"queue",f:"player"} as Record<string,PlaybackShortcut>)[key] || null;
  }
  if (event.repeat && action && !["seekBack","seekForward","volumeUp","volumeDown"].includes(action)) return null;
  return action;
}
