import type {BloomComparison} from "./uiTypes";

export function listeningDuration(ms:number):string{
 if(ms<=0||!Number.isFinite(ms))return "0 sec";
 if(ms<60000)return `${Math.max(1,Math.floor(ms/1000))} sec`;
 const minutes=Math.floor(ms/60000),hours=Math.floor(minutes/60),rest=minutes%60;
 return hours?`${hours} h${rest?` ${rest} min`:""}`:`${minutes} min`;
}

/** Defined durations avoid presenting variable flight times as exact facts. */
export function listeningComparison(ms:number):BloomComparison{
 const minutes=ms/60000;
 if(minutes>=216){const films=Math.floor(minutes/108),remainder=Math.floor(minutes-films*108);return {title:`A whole ${films===2?"double feature":`${films}-film marathon`}.`,detail:`That is ${films} films of 108 minutes each${remainder?`, with ${remainder} minutes to spare`:", back to back"}.`,reference:"An illustrative film duration of 108 minutes; calculated from your audible listening time.",approximate:false};}
 if(minutes>=60){const hours=Math.floor(minutes/60),rest=Math.floor(minutes-hours*60);return {title:`${hours} one-hour intervals.`,detail:`${hours} intervals of exactly an hour${rest?`, plus another ${rest} minutes`:""}.`,reference:"An hour is defined as 60 minutes. This is a duration comparison, rather than a record of other activities.",approximate:false};}
 if(minutes>=10){const intervals=Math.floor(minutes/10);return {title:`${intervals} ten-minute intervals.`,detail:`${intervals} intervals of ten minutes${Math.floor(minutes-intervals*10)?`, and ${Math.floor(minutes-intervals*10)} minutes more`:""}.`,reference:"Each interval is defined as ten minutes; only the listening duration is measured.",approximate:false};}
 return {title:"A shorter listening measure.",detail:`${listeningDuration(ms)} of recorded listening.`,reference:"Calculated from listening time recorded in Sakura.",approximate:false};
}
