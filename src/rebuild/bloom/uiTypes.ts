export type BloomDesign="herbarium"|"nocturne"|"risograph";
export type BloomPeriod="weekly"|"monthly"|"yearly";
export interface BloomItem {id:string;period:BloomPeriod;periodStart:string;periodEnd:string;publishAt:string;expiresAt:string;timeZone:string;status:"locked"|"available"|"expired"|"empty"|"archived";chapterCount:number;teaser?:string}
export interface BloomChapter {id:string;title:string;prompt:string;stat:{label:string;value:number|string;unit:string}|null;relatedRecording:Record<string,unknown>|null;revealed:boolean}
export interface BloomRecap extends BloomItem {summary:{audibleMs:number;playCount:number;recordingCount:number;activeDays:number};chapters:BloomChapter[];completed?:boolean;completedAt?:string|null}
export const bloomDesigns:{id:BloomDesign;name:string;description:string}[]=[
 {id:"herbarium",name:"The listening herbarium",description:"Pressed petals, botanical ink, and the pages of a secret listening journal."},
 {id:"nocturne",name:"A nocturne in bloom",description:"Your music becomes a constellation. Quiet celestial forms reveal its hidden gravity."},
 {id:"risograph",name:"Petal press",description:"Bold pigments, misregistered ink, and a playful collection of printed listening moments."},
];
export function bloomDate(value:string,timeZone="Africa/Lagos"){return new Date(value).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric",timeZone});}
