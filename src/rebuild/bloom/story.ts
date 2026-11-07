import type {BloomChapter,BloomRecap} from "./uiTypes";
import type {BloomSceneKind} from "./worlds/types";
export function chapterScene(chapter:BloomChapter|undefined):BloomSceneKind{
 if(chapter?.kind)return chapter.kind;
 const legacy:Record<string,BloomSceneKind>={"listening-time":"time","top-song":"song-winner","top-artist":"artist","song-count":"breadth","listening-days":"days","discoveries":"discoveries","returning-songs":"returns","catalog-genre":"genres"};return legacy[chapter?.id||""]||"pattern";
}
export function chapterHold(chapter:BloomChapter|undefined){return chapter?.kind==="artist-songs"||chapter?.kind==="songs"?16000:chapter?.kind==="song-winner"||chapter?.kind==="artist"?15000:11500;}
export function resumeBloomIndex(recap:BloomRecap,saved:number){const first=recap.chapters.findIndex(chapter=>!chapter.revealed);const frontier=first<0?Math.max(0,recap.chapters.length-1):first;return Math.max(0,Math.min(Number.isSafeInteger(saved)?saved:0,frontier));}
