import assert from "node:assert/strict";
import {test} from "node:test";
import {rankSearchArtists,type SearchArtistCandidate} from "../src/rebuild/recommendations/searchArtists";
import type {ListeningEvidence,TasteTrack} from "../src/rebuild/recommendations/personalization";
const now=Date.UTC(2026,10,8,12),artist=(id:string,name=id):SearchArtistCandidate=>({id,name,reference:{provider:"deezer",id}});
const song=(id:string,artistId:string,genres:string[]=[]):TasteTrack=>({id,artists:[artistId],artistId,genres,artistCredits:[{artistId,name:artistId,role:"primary",reference:{provider:"deezer",id:artistId}}]});
const listen=(recordingId:string,audibleMs:number,playCount=1,lastPlayedAt=now):ListeningEvidence=>({recordingId,audibleMs,playCount,completedCount:0,skippedCount:0,lastPlayedAt});

test("Search artists use audible time and return visits rather than the old fixed names",()=>{
 const artists=[artist("short"),artist("return"),artist("long")],tracks=[song("s","short"),song("r","return"),song("l","long")];
 const result=rankSearchArtists(artists,tracks,{history:[listen("s",5000),listen("r",600000,6),listen("l",1200000)],nowMs:now});
 assert.equal(result[0].id,"long");assert.equal(result[1].id,"return");assert.equal(result[1].reason,"From songs you heard again");assert.equal(result[2].reason,"From your recorded listening");
});
test("pausing learning removes observed influence while retaining deliberate choices and likes",()=>{
 const artists=[artist("heard"),artist("saved"),artist("chosen")],tracks=[song("h","heard"),song("s","saved"),song("c","chosen")];
 const result=rankSearchArtists(artists,tracks,{settings:{learnFromListening:false,seedArtistSelections:[{name:"chosen",reference:{provider:"deezer",id:"chosen"}}]},history:[listen("h",30000000,100)],likedIds:["s"],nowMs:now});
 assert.deepEqual(result.slice(0,2).map(row=>row.id),["chosen","saved"]);assert.equal(result.find(row=>row.id==="heard")?.source,"catalog");
});
test("recording and artist exclusions remove recommendation evidence and expire honestly",()=>{
 const artists=[artist("blocked"),artist("other")],tracks=[song("b","blocked",["Jazz"]),song("o","other",["Jazz"])],history=[listen("b",1000000,5)];
 const excluded=rankSearchArtists(artists,tracks,{history,feedback:[{target:"recording",targetId:"b",kind:"snooze",expiresAt:now+1}],nowMs:now});
 assert.deepEqual(excluded.map(row=>row.id),["other"]);assert.equal(excluded[0].source,"catalog","Excluded genre evidence must not personalize another artist");
 const expired=rankSearchArtists(artists,tracks,{history,feedback:[{target:"artist",targetId:"blocked",kind:"snooze",expiresAt:now-1}],nowMs:now});
 assert.equal(expired[0].id,"blocked");assert.equal(expired[0].source,"listening");
});
test("same-name artist identities remain separate and exact seeds win the display choice",()=>{
 const artists=[artist("wrong","Same Name"),artist("chosen","Same Name")],tracks=[song("w","wrong"),song("c","chosen")];
 const chosen=rankSearchArtists(artists,tracks,{settings:{seedArtists:["Same Name"],seedArtistSelections:[{name:"Same Name",reference:{provider:"deezer",id:"chosen"}}]},nowMs:now});
 assert.deepEqual(chosen.map(row=>row.id),["chosen"]);assert.equal(chosen[0].source,"chosen");
 const measured=rankSearchArtists(artists,tracks,{history:[listen("w",1000000)],nowMs:now});assert.equal(measured[0].id,"wrong");assert.equal(measured[0].source,"listening");
});
test("primary artist roles direct measurements and duplicate song rows cannot multiply time",()=>{
 const primary=song("x","primary");primary.artistCredits=[{artistId:"guest",name:"guest",role:"featured"},{artistId:"primary",name:"primary",role:"primary"}];
 const result=rankSearchArtists([artist("guest"),artist("primary"),artist("other")],[primary,primary,song("o","other")],{history:[listen("x",600000),listen("o",800000)],nowMs:now});
 assert.equal(result[0].id,"other");assert.ok(!result.some(row=>row.id==="guest"));
});
test("an unlinked primary artist cannot give its measured listening to a featured guest",()=>{
 const track=song("x","guest");track.artistCredits=[{artistId:null,name:"Unknown primary",role:"primary"},{artistId:"guest",name:"guest",role:"featured"}];
 const result=rankSearchArtists([artist("guest"),artist("other")],[track,song("o","other")],{history:[listen("x",6000000)],nowMs:now});
 assert.deepEqual(result.map(row=>row.id),["other"]);assert.equal(result[0].source,"catalog");
});
test("recent comparable listening wins without assigning a date to undated history",()=>{
 const artists=[artist("new"),artist("old"),artist("unknown")],tracks=[song("n","new"),song("o","old"),song("u","unknown")];
 const undated={...listen("u",600000),lastPlayedAt:undefined};
 const result=rankSearchArtists(artists,tracks,{history:[listen("n",600000,1,now),listen("o",600000,1,now-90*86400000),undated],nowMs:now});
 assert.equal(result[0].id,"new");assert.equal(result[2].id,"unknown");
});
test("genre choices create useful entry points while a cold start stays clearly catalog-based",()=>{
 const artists=[artist("jazz"),artist("pop"),artist("untagged")],tracks=[song("j","jazz",["Jazz","jazz"]),song("p","pop",["Pop"]),song("u","untagged")];
 const selected=rankSearchArtists(artists,tracks,{settings:{seedGenres:["Jazz"]},nowMs:now});assert.equal(selected[0].id,"jazz");assert.equal(selected[0].source,"genres");
 assert.ok(rankSearchArtists(artists,tracks,{nowMs:now}).every(row=>row.source==="catalog"));assert.deepEqual(rankSearchArtists([],[],{nowMs:now}),[]);
});
test("multi-genre songs divide their influence across unique tags",()=>{
 const artists=[artist("heard-mixed"),artist("heard-folk"),artist("jazz-new"),artist("folk-new")];
 const tracks=[song("m","heard-mixed",["Jazz","jazz","Pop"]),song("f","heard-folk",["Folk"]),song("j","jazz-new",["Jazz"]),song("n","folk-new",["Folk"])];
 const result=rankSearchArtists(artists,tracks,{history:[listen("m",600000),listen("f",600000)],nowMs:now});
 assert.ok(result.findIndex(row=>row.id==="folk-new")<result.findIndex(row=>row.id==="jazz-new"));
});
test("a request to suggest a song less reduces influence without treating skips as dislike",()=>{
 const artists=[artist("less"),artist("neutral")],tracks=[song("l","less"),song("n","neutral")];
 const l={...listen("l",1000000,5),skippedCount:100};
 const baseline=rankSearchArtists(artists,tracks,{history:[l,listen("n",800000)],nowMs:now});assert.equal(baseline[0].id,"less");
 const adjusted=rankSearchArtists(artists,tracks,{history:[l,listen("n",800000)],feedback:[{target:"recording",targetId:"l",kind:"less"}],nowMs:now});assert.equal(adjusted[0].id,"neutral");
});
test("asking for more of a song supplies an explicit entry point even with learning paused",()=>{
 const result=rankSearchArtists([artist("chosen-song"),artist("other")],[song("c","chosen-song"),song("o","other")],{settings:{learnFromListening:false},feedback:[{target:"recording",targetId:"c",kind:"love"}],nowMs:now});
 assert.equal(result[0].id,"chosen-song");assert.equal(result[0].source,"chosen");assert.equal(result[0].reason,"From your song choices");
});
test("explicit filtering removes both artists and their genre influence",()=>{
 const explicit={...song("x","explicit",["Jazz"]),explicit:true},other=song("o","other",["Jazz"]);
 const result=rankSearchArtists([artist("explicit"),artist("other")],[explicit,other],{settings:{explicitContent:false},history:[listen("x",600000)],nowMs:now});
 assert.deepEqual(result.map(row=>row.id),["other"]);assert.equal(result[0].source,"catalog");
});
