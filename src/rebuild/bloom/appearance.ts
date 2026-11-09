import type {BloomRecap} from "./uiTypes";
import {discloseBloomListening} from "./listening";

/** A chapter uses its original disclosure frontier on every viewing, even
 * after completing the story or opening later chapters on another device. */
export function bloomSceneListening(recap:BloomRecap,index:number,begun:boolean,finished:boolean){
 if(!recap.experience||finished)return recap.listening;
 const chapters=begun?recap.chapters.slice(0,index+1):[];
 const kinds=new Set(chapters.filter(chapter=>chapter.revealed).flatMap(chapter=>[chapter.kind||"",chapter.id]));
 return discloseBloomListening(recap.listening,kinds);
}
