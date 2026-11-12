import type {BloomWorldId,BloomSceneKind} from "./worlds/types";
import type {BloomExperience} from "./experience";
export type BloomDesign=BloomWorldId|"herbarium"|"nocturne"|"risograph";
export type BloomPeriod="weekly"|"monthly"|"yearly";
export interface BloomItem {id:string;period:BloomPeriod;periodStart:string;periodEnd:string;publishAt:string;expiresAt:string;timeZone:string;status:"locked"|"available"|"expired"|"empty"|"archived";chapterCount:number;teaser?:string;worldId?:BloomDesign;version?:number;experience?:BloomExperience}
export type BloomShelfItem=Omit<BloomItem,"chapterCount">&{completed?:boolean;listening?:BloomListeningProfile};
export interface BloomRankedRecording {rank:number;audibleMs:number;plays:number;recording:Record<string,unknown>}
export interface BloomArtistInsight {key:string;name:string;artistId:string|null;imageUrl:string|null;audibleMs:number;recordings:BloomRankedRecording[];recordingCount?:number}
export interface BloomComparison {title:string;detail:string;reference:string;referenceUrl?:string;approximate:boolean}
export type BloomListeningSource="home"|"discover"|"search"|"playlist"|"mix"|"album"|"artist"|"track"|"library"|"collection"|"downloads"|"favorites"|"profile"|"bloom"|"queue"|"direct";
/** Optional fields are disclosed as the corresponding listening chapters open.
 * Old archived stories have no profile and keep their original artwork. */
export interface BloomListeningProfile {
 timeZone:string;
 audibleMs?:number;activeDays?:number;recordingCount?:number;artistCount?:number;
 peakHour?:number|null;
 hourBands?:{id:"dawn"|"day"|"evening"|"night";audibleMs:number;share:number}[];
 genres?:{name:string;audibleMs:number;share:number}[];genreCount?:number;unknownGenreMs?:number;
 returningRecordingCount?:number;returningArtistCount?:number;
 discoveredRecordingCount?:number;discoveredArtistCount?:number;
 averageActiveDayMs?:number;repeatListeningShare?:number;discoveryListeningShare?:number;
 peakDay?:{date:string;audibleMs:number};
 longestStreak?:{days:number;startDate:string;endDate:string};
 months?:{month:string;audibleMs:number}[];weekendListeningShare?:number;
 listeningIdentity?:{name:string;detail:string};
 sources?:{id:BloomListeningSource;name:string;audibleMs:number;share:number}[];unknownSourceMs?:number;
 comparison?:{periodLabel:string;audibleMs:number;changeMs:number;sharedRecordingCount:number;sharedArtistCount:number}|null;
}
export interface BloomChapter {id:string;title:string;prompt:string;stat:{label:string;value:number|string;unit:string}|null;relatedRecording:Record<string,unknown>|null;revealed:boolean;kind?:BloomSceneKind;detail?:string|null;recordings?:BloomRankedRecording[];artists?:BloomArtistInsight[];comparison?:BloomComparison|null}
export interface BloomRecap extends BloomItem {summary:{audibleMs:number;playCount:number;recordingCount:number;activeDays:number};chapters:BloomChapter[];snapshotCreatedAt?:string;listening?:BloomListeningProfile;completed?:boolean;completedAt?:string|null}
/** A private staging response, warmed for an available story before entry. Preparation
 * never changes its persisted reveal frontier or completion state. */
export interface BloomPreparedStory {story:BloomRecap;chapters:Omit<BloomChapter,"revealed">[];listening?:BloomListeningProfile}
export const bloomDesigns:{id:BloomDesign;name:string;description:string}[]=[
 {id:"herbarium",name:"The listening herbarium",description:"Pressed petals, botanical ink, and the pages of a secret listening journal."},
 {id:"nocturne",name:"A nocturne in bloom",description:"Your music becomes a constellation. Quiet celestial forms reveal its hidden gravity."},
 {id:"risograph",name:"Petal press",description:"Bold pigments, misregistered ink, and a playful collection of printed listening moments."},
];
export function bloomDate(value:string,timeZone="Africa/Lagos"){return new Date(value).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric",timeZone});}
