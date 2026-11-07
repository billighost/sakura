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
 if(minutes>=60){const journeys=Math.floor(minutes/60),rest=Math.floor(minutes-journeys*60);return {title:`A soundtrack for ${journeys===1?"a one-hour journey":`${journeys} one-hour journeys`}.`,detail:`${journeys} journeys of exactly an hour${rest?`, plus another ${rest} minutes`:""}. Your music could have travelled all that way with you.`,reference:"An illustrative journey defined as 60 minutes. This does not describe an actual flight or your travel history.",approximate:false};}
 if(minutes>=10){const breaks=Math.floor(minutes/10);return {title:`${breaks} little escapes.`,detail:`Enough music for ${breaks} ten-minute breaks${Math.floor(minutes-breaks*10)?`, and ${Math.floor(minutes-breaks*10)} minutes more`:""}.`,reference:"A break is defined here as ten minutes; only the listening duration is measured.",approximate:false};}
 return {title:"A little world in a few moments.",detail:`${listeningDuration(ms)} of music, enough to make an ordinary moment your own.`,reference:"Calculated from audible listening time recorded in Sakura.",approximate:false};
}
