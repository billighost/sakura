import {readingEngine,type ReadingLanguage} from "../lyrics/language";
import type {PlayerLyricLine,PlayerLyrics} from "./useLyrics";

export type ReadingGuides=Partial<Record<ReadingLanguage,{engine:string;texts:string[];lines:Pick<PlayerLyricLine,"romanized"|"readingEngine"|"readingReviewNeeded">[]}>>;

/** Pronunciation belongs to text; changing its timing does not need another reading request. */
export function matchingReadingGuide(guides:ReadingGuides|undefined,lyrics:PlayerLyrics,language:ReadingLanguage){
 const guide=guides?.[language];
 return guide&&guide.engine===readingEngine(language)&&guide.texts.length===lyrics.lines.length&&guide.texts.every((text,index)=>text===lyrics.lines[index].text)&&guide.lines.length===lyrics.lines.length&&guide.lines.every((line,index)=>!lyrics.lines[index].text.trim()||typeof line.romanized==="string"&&line.readingEngine===guide.engine)?guide:undefined;
}

export function rememberReadingGuides(previous:ReadingGuides|undefined,lyrics:PlayerLyrics):ReadingGuides{
 const guides:ReadingGuides={};
 for(const language of Object.keys(previous||{}) as ReadingLanguage[]){const guide=matchingReadingGuide(previous,lyrics,language);if(guide)guides[language]=guide;}
 const language=lyrics.readingLanguage;
 if(language&&lyrics.lines.every(line=>!line.text.trim()||typeof line.romanized==="string"&&line.readingEngine===readingEngine(language))){
  guides[language]={engine:readingEngine(language),texts:lyrics.lines.map(line=>line.text),lines:lyrics.lines.map(({romanized,readingEngine,readingReviewNeeded})=>({romanized,readingEngine,readingReviewNeeded}))};
 }
 return guides;
}

export function chooseReadingLanguage(lyrics:PlayerLyrics,language:ReadingLanguage,guides?:ReadingGuides):PlayerLyrics{
 const guide=matchingReadingGuide(guides,lyrics,language);
 return {...lyrics,readingLanguage:language,lines:lyrics.lines.map((line,index)=>{
  const {romanized,readingEngine,readingReviewNeeded,...text}=line;void romanized;void readingEngine;void readingReviewNeeded;
  return guide?{...text,...guide.lines[index]}:text;
 })};
}
