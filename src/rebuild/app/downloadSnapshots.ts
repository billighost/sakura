import type {DownloadEntry} from "./types";

export type DownloadSnapshot=Readonly<Record<string,DownloadEntry>>;
const empty:DownloadSnapshot=Object.freeze({});
const membershipFields=["track","status","totalBytes","error","operationId","sha256","requested","mode"] as const;
const sameEntry=(a:DownloadEntry|undefined,b:DownloadEntry)=>!!a&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(key=>Object.is(a[key as keyof DownloadEntry],b[key as keyof DownloadEntry]));
const sameMembership=(a:DownloadEntry|undefined,b:DownloadEntry)=>!!a&&membershipFields.every(key=>Object.is(a[key],b[key]));

/** Immutable keyed snapshots keep byte progress local to its actual consumers. */
export class DownloadSnapshots {
 private snapshot:DownloadSnapshot=empty;
 private membership:DownloadSnapshot=empty;
 private listeners=new Set<()=>void>();
 private membershipListeners=new Set<()=>void>();
 private entryListeners=new Map<string,Set<()=>void>>();
 getSnapshot=()=>this.snapshot;
 getServerSnapshot=()=>empty;
 getMembershipSnapshot=()=>this.membership;
 getEntry=(id:string)=>this.snapshot[id];
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 subscribeMembership=(listener:()=>void)=>{this.membershipListeners.add(listener);return()=>{this.membershipListeners.delete(listener);};};
 subscribeEntry=(id:string,listener:()=>void)=>{let listeners=this.entryListeners.get(id);if(!listeners){listeners=new Set();this.entryListeners.set(id,listeners);}listeners.add(listener);return()=>{listeners!.delete(listener);if(!listeners!.size)this.entryListeners.delete(id);};};
 publish(entries:Record<string,DownloadEntry>){
  const next:Record<string,DownloadEntry>={},membership:Record<string,DownloadEntry>={},changed:string[]=[];let membershipChanged=false;
  for(const [id,entry]of Object.entries(entries)){
   next[id]=sameEntry(this.snapshot[id],entry)?this.snapshot[id]:Object.freeze({...entry});
   if(next[id]!==this.snapshot[id])changed.push(id);
   membership[id]=sameMembership(this.membership[id],next[id])?this.membership[id]:next[id];
   if(membership[id]!==this.membership[id])membershipChanged=true;
  }
  for(const id of Object.keys(this.snapshot))if(!(id in next)){changed.push(id);membershipChanged=true;}
  if(!changed.length)return;
  this.snapshot=Object.freeze(next);if(membershipChanged)this.membership=Object.freeze(membership);
  for(const id of changed)for(const listener of this.entryListeners.get(id)||[])listener();
  for(const listener of this.listeners)listener();
  if(membershipChanged)for(const listener of this.membershipListeners)listener();
 }
 clear(){this.publish({});}
}
