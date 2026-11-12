/** Exact greedy sequencing, indexed by artist and normalized genre set.
 * Only artists whose spacing penalty changes are rescored after a pick. */
export interface SequenceCandidate<T> { item:T;key:string;genres:string[];score:number }

interface Indexed { heapIndex:number }
class Heap<T extends Indexed> {
  readonly values:T[]=[];
  constructor(private readonly before:(a:T,b:T)=>boolean) {}
  peek(){return this.values[0];}
  second(){const a=this.values[1],b=this.values[2];return !a?b:!b||this.before(a,b)?a:b;}
  insert(value:T){value.heapIndex=this.values.length;this.values.push(value);this.up(value.heapIndex);}
  remove(value:T){
    const index=value.heapIndex;if(index<0)return;
    const tail=this.values.pop()!;value.heapIndex=-1;
    if(tail===value)return;
    this.values[index]=tail;tail.heapIndex=index;this.fix(tail);
  }
  fix(value:T){if(!this.up(value.heapIndex))this.down(value.heapIndex);}
  private swap(a:number,b:number){const first=this.values[a];this.values[a]=this.values[b];this.values[b]=first;this.values[a].heapIndex=a;first.heapIndex=b;}
  private up(start:number){let index=start;while(index>0){const parent=(index-1)>>1;if(!this.before(this.values[index],this.values[parent]))break;this.swap(index,parent);index=parent;}return index!==start;}
  private down(start:number){let index=start;while(true){const left=index*2+1,right=left+1;let best=index;
    if(left<this.values.length&&this.before(this.values[left],this.values[best]))best=left;
    if(right<this.values.length&&this.before(this.values[right],this.values[best]))best=right;
    if(best===index)return;this.swap(index,best);index=best;
  }}
}

interface Entry<T> extends SequenceCandidate<T> { position:number;consumed:boolean;runEnd:number }
interface Group<T> extends Indexed {
  key:string;entries:Entry<T>[];offset:number;candidate:Entry<T>;bucket?:ScoreBucket<T>;signature:Signature<T>;
}
interface ScoreBucket<T> extends Indexed { score:number;groups:Heap<Group<T>> }
interface Signature<T> extends Indexed {
  genres:Set<string>;shared:boolean;score:number;candidate?:Group<T>;
  buckets:Heap<ScoreBucket<T>>;byScore:Map<number,ScoreBucket<T>>;
}

export function sequenceCandidates<T>(candidates:readonly SequenceCandidate<T>[],variety:number,limit:number):T[]{
  const signatures=new Map<string,Signature<T>>(),artists=new Map<string,Group<T>[]>(),genreSignatures=new Map<string,Set<Signature<T>>>();
  const remaining=new Map<string,number>(),counts=new Map<string,number>();
  const ready=new Heap<Signature<T>>((a,b)=>a.score>b.score||a.score===b.score&&a.candidate!.candidate.position<b.candidate!.candidate.position);
  const lastArtists:string[]=[];let previousKey:string|undefined,previousGenres=new Set<string>();
  for(let position=0;position<candidates.length;position++){
    const choice=candidates[position],genres=[...new Set(choice.genres)].sort(),signatureKey=JSON.stringify(genres);
    let signature=signatures.get(signatureKey);
    if(!signature){
      signature={genres:new Set(genres),shared:false,score:0,heapIndex:-1,byScore:new Map(),buckets:new Heap((a,b)=>a.score>b.score)};
      signatures.set(signatureKey,signature);
      for(const genre of genres){let index=genreSignatures.get(genre);if(!index){index=new Set();genreSignatures.set(genre,index);}index.add(signature);}
    }
    let artist=artists.get(choice.key);if(!artist){artist=[];artists.set(choice.key,artist);}
    let group=artist.find(group=>group.signature===signature);
    const entry={...choice,position,consumed:false,runEnd:0};
    if(!group){group={key:choice.key,entries:[],offset:0,candidate:entry,signature,heapIndex:-1};artist.push(group);}
    group.entries.push(entry);remaining.set(choice.key,(remaining.get(choice.key)||0)+1);
  }
  const detach=(group:Group<T>)=>{
    const bucket=group.bucket;if(!bucket)return;
    bucket.groups.remove(group);group.bucket=undefined;
    if(!bucket.groups.values.length){group.signature.buckets.remove(bucket);group.signature.byScore.delete(bucket.score);}
  };
  const refreshGroup=(group:Group<T>)=>{
    detach(group);
    while(group.offset<group.entries.length&&group.entries[group.offset].consumed)group.offset++;
    if(group.offset===group.entries.length)return;
    const alternate=variety>=.5&&previousKey!==undefined&&(remaining.size>1||!remaining.has(previousKey));
    if(alternate&&group.key===previousKey)return;
    const adjacent=group.key===previousKey,seen=lastArtists.includes(group.key),count=counts.get(group.key)||0;
    const score=(entry:Entry<T>)=>entry.score-(adjacent?1.2+variety*2:0)-(seen?variety*.8:0)-Math.log1p(count)*variety*.65;
    let candidate=group.entries[group.offset];const baseline=score(candidate);
    // Subtraction can round unequal inputs to the same score. Preserve the
    // original input-order tie rule even for nearly equal floating point values.
    for(let index=candidate.runEnd;index<group.entries.length;){
      const next=group.entries[index];if(next.consumed){index++;continue;}if(score(next)!==baseline)break;
      if(next.position<candidate.position)candidate=next;
      index=next.runEnd;
    }
    group.candidate=candidate;
    let bucket=group.signature.byScore.get(baseline);
    if(!bucket){bucket={score:baseline,heapIndex:-1,groups:new Heap((a,b)=>a.candidate.position<b.candidate.position)};
      group.signature.byScore.set(baseline,bucket);group.signature.buckets.insert(bucket);}
    bucket.groups.insert(group);group.bucket=bucket;
  };
  const refreshSignature=(signature:Signature<T>)=>{
    const first=signature.buckets.peek();
    if(!first){ready.remove(signature);signature.candidate=undefined;return;}
    const bonus=signature.shared?.13:0,score=first.score+bonus;
    let candidate=first.groups.peek()!;
    // Adding the genre bonus may round distinct baseline scores to a tie.
    // Equal baseline scores already have an input-order heap of their own.
    const second=signature.buckets.second();
    if(second&&second.score+bonus===score){
      const tied:ScoreBucket<T>[]=[];
      while(signature.buckets.peek()&&signature.buckets.peek()!.score+bonus===score){
        const bucket=signature.buckets.peek()!,next=bucket.groups.peek()!;
        if(next.candidate.position<candidate.candidate.position)candidate=next;
        signature.buckets.remove(bucket);tied.push(bucket);
      }
      for(const bucket of tied)signature.buckets.insert(bucket);
    }
    signature.score=score;signature.candidate=candidate;
    if(signature.heapIndex<0)ready.insert(signature);else ready.fix(signature);
  };
  for(const groups of artists.values())for(const group of groups){
    group.entries.sort((a,b)=>b.score-a.score||a.position-b.position);
    for(let start=0;start<group.entries.length;){let end=start+1;while(end<group.entries.length&&group.entries[end].score===group.entries[start].score)end++;
      for(let index=start;index<end;index++)group.entries[index].runEnd=end;start=end;
    }
    refreshGroup(group);
  }
  for(const signature of signatures.values())refreshSignature(signature);
  const ordered:T[]=[];
  while(ordered.length<limit&&ready.values.length){
    const selected=ready.peek()!.candidate!,entry=selected.candidate;
    ordered.push(entry.item);entry.consumed=true;
    const affectedArtists=new Set([...lastArtists,entry.key,...(previousKey===undefined?[]:[previousKey])]);
    const oldGenres=previousGenres;
    remaining.set(entry.key,remaining.get(entry.key)!-1);if(!remaining.get(entry.key))remaining.delete(entry.key);
    counts.set(entry.key,(counts.get(entry.key)||0)+1);previousKey=entry.key;previousGenres=new Set(entry.genres);
    lastArtists.push(entry.key);if(lastArtists.length>3)lastArtists.shift();
    const affectedSignatures=new Set<Signature<T>>();
    for(const key of affectedArtists)for(const group of artists.get(key)||[]){refreshGroup(group);affectedSignatures.add(group.signature);}
    const genreChanges=new Set<Signature<T>>();
    for(const genre of new Set([...oldGenres,...previousGenres]))for(const signature of genreSignatures.get(genre)||[])genreChanges.add(signature);
    for(const signature of genreChanges){
      const shared=[...signature.genres].some(genre=>previousGenres.has(genre));
      if(shared!==signature.shared){signature.shared=shared;affectedSignatures.add(signature);}
    }
    for(const signature of affectedSignatures)refreshSignature(signature);
  }
  return ordered;
}
