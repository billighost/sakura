import {bloomPreparationScope} from "./preparationIdentity";
import {discloseBloomListening} from "./listening";
import type {BloomPreparedStory,BloomRecap} from "./uiTypes";

export interface BloomDisclosureReceipt {
 receipt:"sakura-bloom-disclosure-v1";
 scope:string;
 revealedChapters:string[];
 completed:boolean;
 completedAt?:string|null;
}

/** Older consumers and a changed snapshot receive the full authoritative view. */
export function bloomDisclosureReply(recap:BloomRecap,requestedScope:unknown):BloomRecap|BloomDisclosureReceipt {
 const scope=bloomPreparationScope(recap);
 if(requestedScope!==scope)return recap;
 return {receipt:"sakura-bloom-disclosure-v1",scope,revealedChapters:recap.chapters.filter(chapter=>chapter.revealed).map(chapter=>chapter.id),completed:Boolean(recap.completed),completedAt:recap.completedAt};
}

export function applyBloomDisclosureReply(prepared:BloomPreparedStory,reply:BloomRecap|BloomDisclosureReceipt):BloomRecap {
 if(!("receipt" in reply))return reply;
 if(reply.receipt!=="sakura-bloom-disclosure-v1"||reply.scope!==bloomPreparationScope(prepared.story)||!Array.isArray(reply.revealedChapters)||reply.revealedChapters.length>prepared.chapters.length||typeof reply.completed!=="boolean")throw new Error("This Bloom's saved story has changed. Refresh to continue.");
 const frontier=reply.revealedChapters.length;
 if(reply.revealedChapters.some((id,index)=>id!==prepared.chapters[index]?.id)||reply.completed&&frontier!==prepared.chapters.length||prepared.story.chapters.some((chapter,index)=>chapter.revealed&&index>=frontier)||reply.completedAt!==undefined&&reply.completedAt!==null&&(typeof reply.completedAt!=="string"||!Number.isFinite(Date.parse(reply.completedAt))))throw new Error("This Bloom's reveal receipt could not be verified. Refresh to continue.");
 const chapters=prepared.chapters.map((chapter,index)=>index<frontier?{...chapter,revealed:true}:prepared.story.chapters[index]);
 const kinds=new Set(chapters.filter(chapter=>chapter.revealed).flatMap(chapter=>[chapter.kind||"",chapter.id]));
 return {...prepared.story,chapters,listening:discloseBloomListening(prepared.listening,kinds,reply.completed),completed:reply.completed,completedAt:reply.completedAt};
}
