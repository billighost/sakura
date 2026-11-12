import {sameBloomStory} from "./refresh";
import type {BloomRecap} from "./uiTypes";

export function bloomPreparationScope(story:BloomRecap){return JSON.stringify([story.id,story.version,story.timeZone,story.periodStart,story.periodEnd,story.worldId,story.summary,story.snapshotCreatedAt,story.experience,story.chapters.map(chapter=>chapter.id)]);}
export function requireBloomOpening(story:BloomRecap,now=Date.now()){
 const published=Date.parse(story.publishAt),expires=Date.parse(story.expiresAt);
 if(!Number.isFinite(published)||!Number.isFinite(expires)||story.status!=="archived"&&(now<published||now>=expires))throw new Error("This Bloom is outside its opening dates.");
}

/** A detail can bind an in-flight shelf request before its JSON has arrived. */
export class BloomPreparationIdentity {
 private expected?:BloomRecap;private loaded?:BloomRecap;
 constructor(expected?:BloomRecap){this.expected=expected;}
 expect(story:BloomRecap){
  if(this.expected&&!sameBloomStory(this.expected,story)||this.loaded&&!sameBloomStory(this.loaded,story))throw new Error("This Bloom has changed. Prepare its new story and soundtrack again.");
  this.expected=story;
 }
 accept(story:BloomRecap){this.check(story);this.loaded=story;}
 check(story:BloomRecap,expected?:BloomRecap){
  if(this.expected&&!sameBloomStory(this.expected,story)||this.loaded&&!sameBloomStory(this.loaded,story)||expected&&!sameBloomStory(expected,story))throw new Error("This Bloom has changed. Prepare its new story and soundtrack again.");
 }
}
