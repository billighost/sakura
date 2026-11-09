import {bloomWorld} from "./worlds/registry";

/** Saved with the listening snapshot. No clock or live randomness participates
 * in a Bloom's artwork, pace or words after its first creation. */
export interface BloomExperience {
 version:1;
 seed:number;
 composition:0|1|2|3;
 palette:0|1|2|3;
 tempo:0|1|2|3;
 copyVariant:number;
 opening:string;
 closing:string;
 finaleTitle:string;
}

function hash(value:string){
 let state=2166136261;
 for(let index=0;index<value.length;index++){state^=value.charCodeAt(index);state=Math.imul(state,16777619);}
 // Mix the final bits so adjacent period names do not share layout choices.
 state^=state>>>16;state=Math.imul(state,0x7feb352d);state^=state>>>15;state=Math.imul(state,0x846ca68b);state^=state>>>16;
 return state>>>0;
}

export function experienceFraction(seed:number,salt:string|number){return hash(`${seed}|${salt}`)/4294967296;}
export function experienceChoice<T>(values:readonly T[],seed:number,salt:string){return values[Math.floor(experienceFraction(seed,salt)*values.length)];}

const worldImages:Record<string,readonly [string,string,string,string]>={
 sakura:["an orchard waking in pink","a canopy of golden afterglow","a moonlit garden of ink","a shower of blossoms"],
 jungle:["a river opening into dawn","a forest alive with colour","a trail through painted leaves","a hidden bend in the river"],
 disco:["a room glowing in velvet","your own headline show","a dance floor of champagne light","a midnight curtain call"],
 japan:["a lantern procession","a book glowing after dark","a trail of paper lanterns","an illustrated festival of light"],
 china:["a landscape in flowing ink","a river beneath painted peaks","a scroll of drifting mist","a journey through brushwork"],
 korea:["a courtyard of musical keepsakes","a screen painted in jewel colours","a collection under golden light","a courtyard coming to life"],
 india:["a garden in jewel pigments","a folio of painted flowers","a monsoon garden in bloom","a pavilion in pearlescent light"],
 ocean:["a tide of luminous colour","a shoreline in moonlight","a sea opening into sunrise","a dance of painted currents"],
 cosmos:["a sky of paper constellations","a theatre of little orbits","an observatory full of colour","a handmade universe"],
 glass:["a garden made of light","a window of botanical colour","a prism of musical moments","a canopy of stained glass"],
};

/** Identity includes account, recap ID and its saved time zone. The opaque
 * numeric seed can be sent to the browser without exposing that identity. */
export function createBloomExperience(identity:string,worldId:string):BloomExperience{
 const world=bloomWorld(worldId),seed=hash(`sakura-bloom-experience-v1|${identity}|${world.id}`);
 const image=experienceChoice(worldImages[world.id],seed,"opening-image");
 const opening=experienceChoice([
  `Your music made ${image}. Step inside and meet the songs that shaped it.`,
  `You pressed play. Now watch it become ${image}. Your next favourite memory is waiting inside.`,
  `The music you chose became ${image}. Ready to see what your listening made?`,
  `The songs you lived with have a story to tell. Open ${image} and let your listening take the spotlight.`,
 ],seed,"opening-copy");
 const closing=experienceChoice([
  "Every song had a part. Together, they made a Bloom that belongs to you. Keep it, share it, or press play and feel it all again.",
  "Look what your listening made. One play at a time, your soundtrack became a world of its own. This is your music, in full bloom.",
  "Your listening took the spotlight. Save this moment and let the next song start a whole new story.",
  "One last look at the music that carried you here. Save your Bloom and keep a little of this story for another encore.",
 ],seed,"closing-copy");
 return {version:1,seed,composition:experienceChoice([0,1,2,3] as const,seed,"composition"),palette:experienceChoice([0,1,2,3] as const,seed,"palette"),tempo:experienceChoice([0,1,2,3] as const,seed,"tempo"),copyVariant:Math.floor(experienceFraction(seed,"copy")*16),opening,closing,finaleTitle:experienceChoice(["Look what your music made.","Your music, in full bloom.","A story only you could make.","Keep this little universe."],seed,"finale-title")};
}

/** Old snapshots intentionally receive no variation. This fallback supports
 * v4 fixtures and exports while production uses the experience saved by API. */
export function experienceForItem(item:{id?:string;timeZone:string;worldId?:string;version?:number;experience?:BloomExperience}){
 if(item.experience)return item.experience;
 if((item.version||1)<4||!item.id)return undefined;
 return createBloomExperience(`${item.id}|${item.timeZone}`,item.worldId||"sakura");
}
