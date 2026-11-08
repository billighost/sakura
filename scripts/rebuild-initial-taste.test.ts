import assert from "node:assert/strict";
import {test} from "node:test";
import {buildInitialTasteProfile,initialTasteGenreWeights,initialTasteSignature,normalizeInitialTasteProfile} from "../src/rebuild/recommendations/initialTaste";
import {planLocalQueue,rankPersonalizedTracks,type TasteSettings,type TasteTrack} from "../src/rebuild/recommendations/personalization";
import {rankSearchArtists} from "../src/rebuild/recommendations/searchArtists";
import {fullSettings,settingsFields,rebasePreferences} from "../src/rebuild/app/preferences";
import {preferencesPatch} from "../src/rebuild/data/validation";

const now=Date.parse("2026-11-08T12:00:00Z");
const chosen:TasteSettings={seedArtists:["Chosen"],seedArtistSelections:[{name:"Chosen",reference:{provider:"deezer",id:"1"},selectionKey:"artist:deezer:1"}]};
const song=(id:string,artist="Chosen",genres:string[]=["Jazz"],providerId="1"):TasteTrack=>({id,title:id,artists:[artist],artistId:artist,artistCredits:[{name:artist,artistId:artist,role:"primary",reference:{provider:"deezer",id:providerId}}],genres});
const withProfile=(settings:TasteSettings=chosen,tracks:TasteTrack[]=[song("source")]):TasteSettings=>({...settings,initialTasteProfile:buildInitialTasteProfile(tracks,settings)});

test("artist choices generate catalog starting points without listening measurements",()=>{
 const profile=buildInitialTasteProfile([song("one"),song("one"),song("two","Chosen",["Jazz","jazz","Soul"]),song("other","Same Name",["Metal"],"2")],chosen);
 assert.equal(profile.recordingCount,2);assert.deepEqual(profile.genres.map(genre=>genre.name),["Jazz","Soul"]);
 assert.ok(!JSON.stringify(profile).match(/audible|playCount|completed|skipped|lastPlayed|hour/i));
 assert.deepEqual(chosen.seedGenres,undefined);
 assert.deepEqual(buildInitialTasteProfile([song("case","Chosen",["Jazz","jazz"])],chosen).genres.map(genre=>genre.name),["Jazz"]);
});
test("exact choices do not acquire genres from a same-name or featured identity",()=>{
 const wrong=song("wrong","Chosen",["Metal"],"2"),featured={...song("feature","Other",["Pop"],"9"),artistCredits:[{name:"Other",role:"primary" as const,artistId:"Other"},{name:"Chosen",role:"featured" as const,artistId:"Chosen",reference:{provider:"deezer",id:"1"}}]};
 assert.equal(buildInitialTasteProfile([wrong,featured],chosen).recordingCount,0);
});
test("legacy choices remain connected alongside exact artist references",()=>{
 const settings={...chosen,seedArtists:["Chosen","Legacy"]},profile=buildInitialTasteProfile([song("c"),song("l","Legacy",["Folk"],"8")],settings);
 assert.deepEqual(profile.genres.map(genre=>genre.name).sort(),["Folk","Jazz"]);
 assert.equal(rankPersonalizedTracks([song("l","Legacy",["Folk"],"8")],{settings,nowMs:now})[0].familiarArtist,true);
});
test("each chosen artist contributes equally and multi-genre tags divide influence",()=>{
 const settings={seedArtists:["Chosen","Other"]},tracks=[...Array.from({length:20},(_,i)=>song(`j${i}`)),song("folk","Other",["Folk","Folk","Soul"],"2")],profile=buildInitialTasteProfile(tracks,settings);
 assert.equal(profile.artists[0].recordings.length,8);assert.equal(profile.genres.find(genre=>genre.name==="Jazz")!.weight,1);
 assert.equal(profile.genres.find(genre=>genre.name==="Folk")!.weight,.5);assert.equal(profile.genres.find(genre=>genre.name==="Soul")!.weight,.5);
});
test("unknown tags and explicit-only choices stay unknown when explicit songs are disabled",()=>{
 const settings={...chosen,explicitContent:false},profile=buildInitialTasteProfile([{...song("x"),explicit:true},song("unknown","Chosen",[])],settings);
 assert.equal(profile.recordingCount,1);assert.deepEqual(profile.genres,[]);
});
test("changing artists or explicit preference invalidates a cached starting recipe",()=>{
 const settings=withProfile();assert.ok(initialTasteGenreWeights(settings).length);
 assert.deepEqual(initialTasteGenreWeights({...settings,seedArtistSelections:[],seedArtists:["Other"]}),[]);
 assert.deepEqual(initialTasteGenreWeights({...settings,explicitContent:false}),[]);
 assert.equal(initialTasteSignature({...chosen,seedArtists:["Chosen"]}),initialTasteSignature(chosen));
});
test("active recording and featured-artist exclusions remove starting influence and expiry restores it",()=>{
 const source={...song("source"),artistCredits:[...song("source").artistCredits!,{name:"Guest",artistId:"guest",role:"featured" as const}]},settings=withProfile(chosen,[source]);
 for(const feedback of [{target:"recording" as const,targetId:"source",kind:"block" as const},{target:"artist" as const,targetId:"guest",kind:"snooze" as const,expiresAt:now+1000}])assert.deepEqual(initialTasteGenreWeights(settings,[feedback],now),[]);
 assert.ok(initialTasteGenreWeights(settings,[{target:"artist",targetId:"guest",kind:"snooze",expiresAt:now-1}],now).length);
});
test("learning paused keeps chosen starting points useful across feed, local queue, and Search",()=>{
 const settings=withProfile({...chosen,learnFromListening:false}),tracks=[song("related","New",["Jazz"],"3"),song("other","Other",["Metal"],"4")];
 const ranked=rankPersonalizedTracks(tracks,{settings,nowMs:now,seed:"initial"});assert.equal(ranked[0].track.id,"related");assert.match(ranked[0].reason,/chosen artists/);assert.ok(ranked.every(row=>!row.heard));
 assert.equal(planLocalQueue(tracks,{settings,nowMs:now})[0].id,"related");
 assert.equal(rankSearchArtists([{id:"New",name:"New"},{id:"Other",name:"Other"}],tracks,{settings,nowMs:now})[0].id,"New");
});
test("explicitly chosen genres outrank artist-derived genres",()=>{
 const settings=withProfile({...chosen,seedGenres:["Metal"]}),tracks=[song("jazz","New",["Jazz"],"3"),song("metal","Other",["Metal"],"4")];
 const ranked=rankPersonalizedTracks(tracks,{settings,nowMs:now,seed:"explicit-genres"});assert.equal(ranked[0].track.id,"metal");
});
test("listening in another genre does not relabel a chosen-artist genre as observed listening",()=>{
 const settings=withProfile(),tracks=[song("jazz","New",["Jazz"],"3"),song("metal","Other",["Metal"],"4")];
 const ranked=rankPersonalizedTracks(tracks,{settings,history:[{recordingId:"metal",audibleMs:600000,playCount:2,completedCount:1,skippedCount:0}],nowMs:now});
 assert.match(ranked.find(row=>row.track.id==="jazz")!.reason,/chosen artists/);
});
test("read-only metadata survives a full cache read and is excluded from every outgoing preference path",()=>{
 const settings=withProfile(),full=fullSettings(settings);assert.deepEqual(full.initialTasteProfile,settings.initialTasteProfile);
 assert.ok(!("initialTasteProfile" in settingsFields(settings)));assert.throws(()=>preferencesPatch({initialTasteProfile:settings.initialTasteProfile}),/Unsupported/);
 assert.deepEqual(rebasePreferences({...settingsFields(settings),initialTasteProfile:settings.initialTasteProfile},settingsFields(chosen),settingsFields(chosen)).pending,{});
 assert.ok(!fullSettings({...settings,seedArtists:["Other"],seedArtistSelections:[]}).initialTasteProfile);
});
test("cache normalization recalculates weights and discards unsupported fields",()=>{
 const profile=buildInitialTasteProfile([song("source")],chosen),normalized=normalizeInitialTasteProfile({...profile,playCount:999,genres:[{name:"Invented",weight:1}],recordingCount:9000});
 assert.deepEqual(normalized,profile);assert.ok(!normalizeInitialTasteProfile({...profile,artists:Array(21).fill(profile.artists[0])}));
});
test("an unlinked primary never transfers its listening to the first linked guest",()=>{
 const source={...song("source","Unknown"),artistId:"guest",artistCredits:[{name:"Unknown",role:"primary" as const},{name:"Guest",artistId:"guest",role:"featured" as const}]},guest={...song("guest-song","Guest"),artistId:"guest",artistCredits:[{name:"Guest",artistId:"guest",role:"primary" as const}]};
 const ranked=rankPersonalizedTracks([source,guest],{history:[{recordingId:"source",audibleMs:600000,playCount:2,completedCount:1,skippedCount:0}],nowMs:now});assert.equal(ranked.find(row=>row.track.id==="guest-song")!.familiarArtist,false);
});
