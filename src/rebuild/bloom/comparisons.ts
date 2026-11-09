import type {BloomComparison} from "./uiTypes";
import {experienceChoice,type BloomExperience} from "./experience";

export function listeningDuration(ms:number):string{
 if(ms<=0||!Number.isFinite(ms))return "0 sec";
 if(ms<60000)return `${Math.max(1,Math.floor(ms/1000))} sec`;
 const minutes=Math.floor(ms/60000),hours=Math.floor(minutes/60),rest=minutes%60;
 return hours?`${hours} h${rest?` ${rest} min`:""}`:`${minutes} min`;
}

/** Defined durations avoid presenting variable flight times as exact facts. */
export function listeningComparison(ms:number,experience?:Pick<BloomExperience,"seed">):BloomComparison{
 if(experience&&Number.isFinite(ms)&&ms>0){
  const measures=[
   {minutes:108,singular:"feature film",plural:"feature films",image:"A little film festival",reference:"Illustrative feature films of exactly 108 minutes each."},
   {minutes:45,singular:"album",plural:"albums",image:"A stack of album-sized moments",reference:"Illustrative albums of exactly 45 minutes each."},
   {minutes:30,singular:"sunset stroll",plural:"sunset strolls",image:"Take the scenic route",reference:"Illustrative sunset strolls of exactly 30 minutes each."},
   {minutes:25,singular:"focus session",plural:"focus sessions",image:"Enough music to settle into",reference:"Illustrative focus sessions of exactly 25 minutes each."},
   {minutes:90,singular:"concert set",plural:"concert sets",image:"Your own imaginary festival",reference:"Illustrative concert sets of exactly 90 minutes each."},
   {minutes:24,singular:"short episode",plural:"short episodes",image:"A soundtrack with room for another episode",reference:"Illustrative short episodes of exactly 24 minutes each."},
   {minutes:10,singular:"tea break",plural:"tea breaks",image:"Little breaks, a big soundtrack",reference:"Illustrative tea breaks of exactly ten minutes each."},
   {minutes:3,singular:"three-minute song",plural:"three-minute songs",image:"One more song, then another",reference:"Illustrative songs of exactly three minutes each."},
  ];
  // Keep larger Blooms on longer comparisons; a year should not become an
  // enormous count of tea breaks simply because a seed chose a tiny unit.
  const minimum=ms>=216*60000?24:ms>=60*60000?10:3;
  const eligible=measures.filter(measure=>measure.minutes>=minimum&&measure.minutes*60000<=ms);
  if(eligible.length){
   const measure=experienceChoice(eligible,experience.seed,"duration-comparison"),unit=measure.minutes*60000,count=Math.floor(ms/unit),remainder=ms-count*unit;
   return {title:`${measure.image}.`,detail:`Picture ${count} ${count===1?measure.singular:measure.plural} of ${measure.minutes} minutes each${remainder>=1000?`, with ${listeningDuration(remainder)} left for an encore`:", back to back"}.`,reference:`${measure.reference} Calculated from your audible listening time.`,approximate:false};
  }
 }
 const minutes=ms/60000;
 if(minutes>=216){const films=Math.floor(minutes/108),remainder=Math.floor(minutes-films*108);return {title:`A whole ${films===2?"double feature":`${films}-film marathon`}.`,detail:`That is ${films} films of 108 minutes each${remainder?`, with ${remainder} minutes to spare`:", back to back"}.`,reference:"An illustrative film duration of 108 minutes; calculated from your audible listening time.",approximate:false};}
 if(minutes>=60){const hours=Math.floor(minutes/60),rest=Math.floor(minutes-hours*60);return {title:`${hours} one-hour intervals.`,detail:`${hours} intervals of exactly an hour${rest?`, plus another ${rest} minutes`:""}.`,reference:"An hour is defined as 60 minutes. This is a duration comparison, rather than a record of other activities.",approximate:false};}
 if(minutes>=10){const intervals=Math.floor(minutes/10);return {title:`${intervals} ten-minute intervals.`,detail:`${intervals} intervals of ten minutes${Math.floor(minutes-intervals*10)?`, and ${Math.floor(minutes-intervals*10)} minutes more`:""}.`,reference:"Each interval is defined as ten minutes; only the listening duration is measured.",approximate:false};}
 return {title:"A shorter listening measure.",detail:`${listeningDuration(ms)} of recorded listening.`,reference:"Calculated from listening time recorded in Sakura.",approximate:false};
}
