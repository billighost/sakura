import { planMixes,type Candidate,type MixSpec,type ListeningContext } from "./planner";
export interface SituationalMixSpec extends MixSpec {
  name:string;description:string;situation:string;surfaces:readonly ("home"|"discover"|"downloads")[];rules:readonly string[];
}
const base={genres:[],size:14,minimum:4,maxPerArtist:2,maximumOverlap:0.2,surfaces:["home","discover","downloads"] as const};
/** These labels use published genres, exact version metadata or audible history.
 * Tempo, energy and inferred moods are deliberately not invented. */
export const SITUATIONAL_MIXES:readonly SituationalMixSpec[]=[
  {...base,id:"daily",kind:"daily",name:"Your daily canvas",description:"Familiar songs and new discoveries, selected from your preferences.",size:16,minimum:6,situation:"everyday",surfaces:["home","discover","downloads"],rules:["taste-affinity","artist-variety"]},
  {...base,id:"discover",kind:"discover",name:"Beyond the familiar",description:"Unheard songs from artists you have not listened to here.",size:16,minimum:6,situation:"discovery",surfaces:["home","discover"],rules:["unheard-recordings","unfamiliar-artists"]},
  {...base,id:"deep-cuts",kind:"deep-cuts",name:"Hidden brushstrokes",description:"Unheard songs from artists you already listen to.",size:12,minimum:5,situation:"familiar-artists",surfaces:["home","discover"],rules:["unheard-recordings","familiar-artists"]},
  {...base,id:"repeat",kind:"repeat",name:"Worth another listen",description:"Songs from your recorded listening history.",size:12,maxPerArtist:3,situation:"repeat",surfaces:["home","discover","downloads"],rules:["audible-history"]},
  {...base,id:"afrobeats",kind:"daily",name:"Afrobeats in bloom",description:"Afrobeats and Afro-pop, with a mix of artists.",situation:"afrobeats",rules:["catalog-genre"]},
  {...base,id:"japanese-pop",kind:"daily",name:"Tokyo paper lanterns",description:"J-pop and Japanese pop from the catalog.",situation:"japanese-pop",rules:["catalog-genre"]},
  {...base,id:"rnb-soul",kind:"daily",name:"Velvet voices",description:"R&B and soul, across familiar and new artists.",situation:"rnb-soul",rules:["catalog-genre"]},
  {...base,id:"jazz",kind:"daily",name:"Blue ink sessions",description:"Jazz, selected from the catalog.",situation:"jazz",rules:["catalog-genre"]},
  {...base,id:"hip-hop",kind:"daily",name:"Lines and rhythm",description:"Hip-hop and rap, with a mix of artists.",situation:"hip-hop",rules:["catalog-genre"]},
  {...base,id:"alternative",kind:"daily",name:"Outside the frame",description:"Alternative and indie music.",situation:"alternative",rules:["catalog-genre"]},
  {...base,id:"electronic",kind:"daily",name:"Electric pigments",description:"Electronic and dance music.",situation:"electronic",rules:["catalog-genre"]},
  {...base,id:"rock",kind:"daily",name:"Guitar sketches",description:"Rock and hard rock from the catalog.",situation:"rock",rules:["catalog-genre"]},
  {...base,id:"short-break",kind:"daily",name:"A small interlude",description:"A varied queue that fits within twenty minutes.",size:7,minimum:3,maximumDurationMs:1200000,situation:"short-break",rules:["verified-duration","twenty-minute-cap"]},
  {...base,id:"acoustic",kind:"daily",name:"Wood and strings",description:"Acoustic songs and acoustic versions.",situation:"acoustic",rules:["catalog-genre-or-acoustic-version"]},
  {...base,id:"instrumental",kind:"daily",name:"Space to think",description:"Instrumental songs and versions.",situation:"instrumental",rules:["instrumental-version-or-genre"]},
  {...base,id:"live",kind:"daily",name:"From the stage",description:"Live versions from the catalog.",situation:"live",rules:["verified-live-version"]},
  {...base,id:"favorites",kind:"daily",name:"Songs you kept",description:"Your liked songs, arranged across artists.",situation:"favorites",rules:["explicit-like"]},
  {...base,id:"forgotten",kind:"repeat",name:"Found in the margins",description:"Liked songs you have not played for more than a month.",situation:"forgotten-favorites",rules:["explicit-like","audible-history","thirty-day-gap"]},
  {...base,id:"recent-discoveries",kind:"repeat",name:"New leaves",description:"Songs you first played here in the last seven days.",situation:"recent-discoveries",rules:["first-audible-history","seven-day-window"]},
  {...base,id:"late-night",kind:"repeat",name:"After the lights",description:"Songs from your recorded listening between 10 pm and 4 am.",situation:"late-night-history",rules:["actual-local-listening-hours"]},
];
export interface SituationRecording {id:string;artists:readonly string[];genres?:readonly string[];durationMs?:number|null;metadata?:Record<string,unknown>;liked?:boolean;popularity?:number;version?:{kinds:readonly string[]};explicit?:boolean;coverUrl?:string|null}
export interface SituationHistory {audibleMs?:number;lastPlayedAt?:number;firstPlayedAt?:number;lateNight?:boolean}
const aliases:Record<string,readonly string[]>={
  afrobeats:["afrobeats","afrobeat","afro-pop","afropop","afro pop"],"japanese-pop":["j-pop","jpop","japanese pop","j pop"],
  "rnb-soul":["r&b","rnb","r&b/soul","r&b / soul","soul","rhythm and blues"],jazz:["jazz"],"hip-hop":["hip-hop","hip hop","rap","hip hop/rap","hip-hop/rap","rap/hip hop"],
  alternative:["alternative","indie","indie pop","indie rock","alternative rock"],electronic:["electronic","electronica","dance","dance & edm","edm"],rock:["rock","hard rock","classic rock"]
};
const normalized=(value:string)=>value.normalize("NFKC").trim().toLowerCase();
export function eligibleSituations(recording:SituationRecording,history:SituationHistory={},nowMs=Date.now()):string[]{
  const genres=(recording.genres||[]).map(normalized),version=(recording.metadata?.version||recording.version) as {kinds?:readonly string[]}|undefined,kinds=version?.kinds||[];
  const result=["daily","discover","deep-cuts","repeat"];
  for(const [id,matches] of Object.entries(aliases))if(genres.some(g=>matches.includes(g)))result.push(id);
  if(recording.durationMs&&recording.durationMs<=600000)result.push("short-break");
  if(kinds.includes("acoustic")||genres.includes("acoustic"))result.push("acoustic");
  if(kinds.includes("instrumental")||genres.includes("instrumental"))result.push("instrumental");
  if(kinds.includes("live"))result.push("live");
  if(recording.liked)result.push("favorites");
  if(recording.liked&&history.lastPlayedAt!==undefined&&nowMs-history.lastPlayedAt>=30*86400000)result.push("forgotten");
  if(history.firstPlayedAt!==undefined&&nowMs-history.firstPlayedAt<=7*86400000)result.push("recent-discoveries");
  if(history.lateNight)result.push("late-night");
  return result;
}
/** Pure browser planner: the input must be intersected with ready local blobs.
 * It never acquires songs or claims a remote recording is downloaded. */
export function planOfflineMixes(recordings:readonly SituationRecording[],options:{seed?:string;nowMs?:number;history?:ReadonlyMap<string,SituationHistory>;explicitContent?:boolean}={}){
  const nowMs=options.nowMs??Date.now(),history=options.history||new Map<string,SituationHistory>();
  const cards=[...new Map(recordings.filter(r=>options.explicitContent!==false||(r.explicit!==true&&r.metadata?.explicit!=="explicit")).map(r=>[r.id,r])).values()];
  const candidates:Candidate[]=cards.map(r=>({recordingId:r.id,artistId:`credit:${normalized(r.artists[0]||r.id)}`,genres:r.genres||[],durationMs:r.durationMs,
    popularity:r.popularity,affinity:(r.liked?1:0)+Math.min(.5,Number(history.get(r.id)?.audibleMs||0)/3600000),eligibleMixIds:eligibleSituations(r,history.get(r.id),nowMs)}));
  const context:ListeningContext={seed:options.seed||`offline:${new Date(nowMs).toISOString().slice(0,10)}`,nowMs,
    heardRecordings:new Set(cards.filter(r=>Number(history.get(r.id)?.audibleMs)>=30000).map(r=>r.id)),
    familiarArtists:new Set(candidates.filter(c=>cards.find(r=>r.id===c.recordingId)?.liked||Number(history.get(c.recordingId)?.audibleMs)>=30000).map(c=>c.artistId)),
    blockedRecordings:new Set(),blockedArtists:new Set(),snoozedUntil:new Map(),recentPlays:new Map(),recentWindowMs:0};
  const specs=SITUATIONAL_MIXES.filter(spec=>spec.surfaces.includes("downloads")),planned=planMixes(specs,candidates,context),byId=new Map(cards.map(r=>[r.id,r]));
  return planned.map((mix,i)=>({...specs[i],...mix,id:`offline:${mix.id}`,slot:mix.id,offline:true,
    name:mix.id==="daily"?"Your offline mix":specs[i].name,
    description:mix.id==="daily"?"A mix made from songs downloaded on this device.":specs[i].description,
    trackCount:mix.recordingIds.length,coverUrls:mix.recordingIds.slice(0,4).flatMap(id=>{const cover=byId.get(id)?.coverUrl||byId.get(id)?.metadata?.coverUrl;return typeof cover==="string"?[cover]:[];}),
    playability:mix.status==="ready"?"ready":"unavailable"}));
}
