/** Media movement counts as listening only while sound is actually playing. */
export function audibleIncrement(input:{mediaDeltaMs:number;wallDeltaMs:number;playing:boolean;paused:boolean;seeking:boolean;privateSession:boolean;learnFromListening?:boolean;muted?:boolean;volume?:number}) {
 const {mediaDeltaMs:delta,wallDeltaMs:elapsed}=input;
 if(!input.playing||input.paused||input.seeking||input.privateSession||input.learnFromListening===false||input.muted||input.volume!==undefined&&(!Number.isFinite(input.volume)||input.volume<=0)||!Number.isFinite(delta)||!Number.isFinite(elapsed)||delta<=0||elapsed<0)return 0;
 // A seek can move the media clock, but cannot create audible time.
 return delta<=elapsed*1.15+300?delta:0;
}

export function listeningOutcome(input:{naturalEnd:boolean;explicitSkip:boolean;audibleMs:number;durationMs:number}) {
 const completed=input.naturalEnd&&input.durationMs>0&&input.audibleMs>=input.durationMs*.8;
 return {completed,skipped:input.explicitSkip&&!completed,finished:true};
}

export function listeningTimeFallsInPeriod(occurredAt:string|undefined,period:"week"|"month"|"all",cutoffMs=Date.now()) {
 if(period==="all"||!occurredAt)return true;
 const time=Date.parse(occurredAt),days=period==="week"?7:30;
 return !Number.isFinite(time)||time>=cutoffMs-days*86400000&&time<=cutoffMs;
}
