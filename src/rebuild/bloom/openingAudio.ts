import type {BloomDesign} from "./uiTypes";
import type {BloomWorldId} from "./worlds/types";

type Instrument="pluck"|"flute"|"bell"|"string"|"felt";
export type OpeningNote={at:number;midi:number;duration:number;gain:number;pan:number;instrument:Instrument};
export type OpeningScore={world:BloomWorldId;duration:number;notes:OpeningNote[];texture:"paper"|"water"|"air"|"shimmer";textureAt:number[]};
type Arrangement={root:number;beat:number;scale:number[];melody:number[];chords:number[][];voice:Instrument;texture:OpeningScore["texture"]};

// Original miniature compositions. Phrases ascend as the world opens, then
// resolve into a suspended, quiet final chord. No downloaded audio is needed.
const arrangements:Record<BloomWorldId,Arrangement>={
 sakura:{root:62,beat:.66,scale:[0,2,4,7,9],melody:[0,2,3,4,2,1,3,2,4,5,3,2,1,0],chords:[[0,7,14],[2,9,16],[4,11,19],[0,7,16]],voice:"felt",texture:"air"},
 jungle:{root:57,beat:.71,scale:[0,3,5,7,10],melody:[0,3,2,4,3,1,2,0,3,5,4,2,1,0],chords:[[0,7,15],[5,12,19],[3,10,17],[0,7,17]],voice:"flute",texture:"water"},
 disco:{root:60,beat:.48,scale:[0,2,4,7,9],melody:[2,4,3,2,0,1,3,4,2,5,4,3,2,0],chords:[[0,7,11,16],[5,12,16,21],[2,9,12,17],[0,7,14,21]],voice:"felt",texture:"shimmer"},
 japan:{root:62,beat:.77,scale:[0,2,3,7,8],melody:[0,2,3,2,1,0,3,4,3,2,5,3,1,0],chords:[[0,7,14],[3,10,17],[5,12,19],[0,7,15]],voice:"pluck",texture:"paper"},
 china:{root:60,beat:.72,scale:[0,2,4,7,9],melody:[0,1,3,2,4,3,2,0,3,4,5,3,2,0],chords:[[0,7,16],[5,12,21],[2,9,16],[0,7,14]],voice:"pluck",texture:"paper"},
 korea:{root:63,beat:.74,scale:[0,2,5,7,9],melody:[0,2,1,3,4,2,3,1,4,5,3,2,1,0],chords:[[0,7,14],[5,12,19],[2,9,17],[0,7,17]],voice:"pluck",texture:"paper"},
 india:{root:57,beat:.68,scale:[0,2,4,7,11],melody:[0,1,2,4,3,2,1,3,4,5,4,2,1,0],chords:[[0,7,12],[4,11,19],[2,9,16],[0,7,14]],voice:"flute",texture:"water"},
 ocean:{root:58,beat:.91,scale:[0,2,5,7,9],melody:[0,3,2,1,4,3,2,5,4,2,1,0],chords:[[0,7,14],[5,12,21],[2,9,17],[0,7,17]],voice:"bell",texture:"water"},
 cosmos:{root:59,beat:.81,scale:[0,2,4,6,9],melody:[0,2,4,3,1,5,4,2,3,6,4,2,1,0],chords:[[0,7,14],[4,11,18],[2,9,16],[0,6,14]],voice:"bell",texture:"air"},
 glass:{root:64,beat:.67,scale:[0,2,4,7,9],melody:[0,3,1,4,2,5,3,2,4,6,5,3,2,0],chords:[[0,7,16],[4,11,19],[2,9,16],[0,7,21]],voice:"bell",texture:"shimmer"},
};

function resolveWorld(world:BloomDesign):BloomWorldId{return world==="herbarium"?"sakura":world==="nocturne"?"cosmos":world==="risograph"?"glass":world;}
function fraction(seed:number,index:number){const value=Math.sin((seed%100000+index*77.71)*12.9898)*43758.5453;return value-Math.floor(value);}
export function bloomOpeningScore(design:BloomDesign,seed=0):OpeningScore{
 const world=resolveWorld(design),arrangement=arrangements[world],notes:OpeningNote[]=[],duration=18;
 const transpose=seed?[-2,0,2][Math.floor(fraction(seed,1)*3)]:0,root=arrangement.root+transpose;
 const pitch=(degree:number)=>root+arrangement.scale[degree%arrangement.scale.length]+12*Math.floor(degree/arrangement.scale.length);
 arrangement.chords.forEach((chord,chordIndex)=>{
  const at=.12+chordIndex*3.9;
  chord.forEach((interval,index)=>notes.push({at:at+index*.055,midi:root-12+interval,duration:5.6,gain:.018,pan:(index/(chord.length-1)-.5)*.7,instrument:"string"}));
  // Arpeggios interleave between the main phrase and its reverberant answer.
  for(let index=0;index<4;index++)notes.push({at:at+.42+index*arrangement.beat,midi:root+chord[index%chord.length],duration:2.4,gain:.039,pan:Math.sin(index+chordIndex)*.52,instrument:world==="disco"?"felt":"pluck"});
 });
 arrangement.melody.forEach((degree,index)=>{
  const at=1.0+index*arrangement.beat;
  notes.push({at,midi:pitch(degree),duration:arrangement.voice==="flute"?1.4:2.8,gain:arrangement.voice==="bell"?.043:.061,pan:Math.sin(index*.73)*.3,instrument:arrangement.voice});
  if(index===3||index===7||index===11)notes.push({at:at+.28,midi:pitch(degree)+12,duration:3.2,gain:.02,pan:.62,instrument:"bell"});
 });
 notes.push({at:14.2,midi:root+12,duration:3.7,gain:.039,pan:0,instrument:arrangement.voice});
 return {world,duration,notes:notes.filter(note=>note.at+note.duration<=duration+.1),texture:arrangement.texture,textureAt:world==="china"?[.2,1.6,2.7,4.2,5.5]:[.3,2.3,4.8]};
}

export interface OpeningPerformance {fade:(seconds?:number)=>void;dispose:()=>void;endsAt:number}

/** Schedule an entire short score in sample time, without JS polling timers. */
export function playBloomOpening(context:AudioContext,score:OpeningScore,seed=0):OpeningPerformance{
 const nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[],start=context.currentTime+.045;
 const own=<T extends AudioNode>(node:T)=>{nodes.push(node);return node;};
 const master=own(context.createGain());master.gain.setValueAtTime(0,context.currentTime);master.gain.linearRampToValueAtTime(1.85,start+.85);master.gain.setValueAtTime(1.85,start+score.duration-1.3);master.gain.linearRampToValueAtTime(0,start+score.duration);master.connect(context.destination);
 const dry=own(context.createGain());dry.gain.value=.88;dry.connect(master);
 const reverb=own(context.createConvolver()),wet=own(context.createGain());wet.gain.value=.24;reverb.connect(wet);wet.connect(master);
 const impulse=context.createBuffer(2,Math.floor(context.sampleRate*2.5),context.sampleRate);
 for(let channel=0;channel<2;channel++){
  const data=impulse.getChannelData(channel);let previous=0;
  for(let index=0;index<data.length;index++){previous=previous*.32+(fraction(seed+channel*19,index+1)*2-1)*.68;data[index]=previous*Math.pow(1-index/data.length,2.5)*.45;}
 }reverb.buffer=impulse;
 const harmonics:Record<Instrument,number[]>={pluck:[0,1,.44,.19,.09,.04],flute:[0,1,.14,.065,.025],bell:[0,1,.38,.13,.04],string:[0,1,.34,.17,.065,.025],felt:[0,1,.48,.21,.095,.04]};
 const waves=Object.fromEntries(Object.entries(harmonics).map(([voice,values])=>[voice,context.createPeriodicWave(new Float32Array(values.length),new Float32Array(values),{disableNormalization:false})])) as Record<Instrument,PeriodicWave>;
 for(const note of score.notes){
  const oscillator=own(context.createOscillator()),envelope=own(context.createGain()),filter=own(context.createBiquadFilter()),pan=own(context.createStereoPanner());sources.push(oscillator);
  const at=start+note.at,end=at+note.duration,attack=note.instrument==="string"?.65:note.instrument==="flute"?.15:.016;
  oscillator.setPeriodicWave(waves[note.instrument]);oscillator.frequency.setValueAtTime(440*Math.pow(2,(note.midi-69)/12),at);
  if(note.instrument==="pluck")oscillator.frequency.exponentialRampToValueAtTime(440*Math.pow(2,(note.midi-69)/12)*.999,end);
  envelope.gain.setValueAtTime(0,at);envelope.gain.linearRampToValueAtTime(note.gain,at+attack);
  if(note.instrument==="string"||note.instrument==="flute"){envelope.gain.setValueAtTime(note.gain*.72,at+Math.max(attack,note.duration*.56));envelope.gain.linearRampToValueAtTime(0,end);}
  else{envelope.gain.exponentialRampToValueAtTime(.0001,end-.03);envelope.gain.linearRampToValueAtTime(0,end);}
  filter.type="lowpass";filter.frequency.value=note.instrument==="bell"?4600:note.instrument==="flute"?2300:3200;filter.Q.value=.38;
  pan.pan.value=note.pan;oscillator.connect(filter);filter.connect(envelope);envelope.connect(pan);pan.connect(dry);pan.connect(reverb);oscillator.start(at);oscillator.stop(end+.025);
 }
 // A band-limited, softly enveloped texture gives pages, tides and light their
 // own physical sound without an abrupt noise transient.
 const noise=context.createBuffer(1,context.sampleRate*2,context.sampleRate),data=noise.getChannelData(0);
 for(let index=0;index<data.length;index++)data[index]=(fraction(seed,index+997)*2-1)*.22;
 for(const [index,offset] of score.textureAt.entries()){
  const source=own(context.createBufferSource()),filter=own(context.createBiquadFilter()),envelope=own(context.createGain()),pan=own(context.createStereoPanner());sources.push(source);
  source.buffer=noise;filter.type="bandpass";filter.Q.value=score.texture==="paper"?.7:.35;
  filter.frequency.setValueAtTime(score.texture==="water"?350:score.texture==="paper"?1700:2600,start+offset);filter.frequency.exponentialRampToValueAtTime(score.texture==="water"?650:700,start+offset+1.1);
  envelope.gain.setValueAtTime(0,start+offset);envelope.gain.linearRampToValueAtTime(score.texture==="paper"?.055:.038,start+offset+.16);envelope.gain.linearRampToValueAtTime(0,start+offset+1.15);pan.pan.value=index%2?.38:-.38;
  source.connect(filter);filter.connect(envelope);envelope.connect(pan);pan.connect(dry);pan.connect(reverb);source.start(start+offset);source.stop(start+offset+1.25);
 }
 let disposed=false;
 return {endsAt:start+score.duration,fade(seconds=.6){if(disposed)return;const now=context.currentTime;master.gain.cancelAndHoldAtTime(now);master.gain.linearRampToValueAtTime(0,now+seconds);},dispose(){if(disposed)return;disposed=true;for(const source of sources)try{source.stop();}catch{}for(const node of nodes)try{node.disconnect();}catch{}reverb.buffer=null;}};
}
