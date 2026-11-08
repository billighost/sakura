import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {rankPersonalizedTracks,orderPersonalizedTracks,planLocalQueue,tasteExcluded,activeTasteFeedback,recentRelease,type TasteTrack,type ListeningEvidence} from "../src/rebuild/recommendations/personalization";
import {encodeFeedCursor,parseFeedCursor,verifyFeedCursor} from "../src/rebuild/recommendations/feedCursor";

const now=Date.parse("2026-11-08T12:00:00Z");
const track=(id:string,artist=id,genres=["Jazz"]):TasteTrack=>({id,title:`Song ${id}`,artists:[artist],artistId:`artist-${artist}`,genres,durationMs:180000,popularity:.5});
const listened=(id:string,values:Partial<ListeningEvidence>={}):ListeningEvidence=>({recordingId:id,audibleMs:1800000,playCount:10,completedCount:8,skippedCount:1,lastPlayedAt:now-10*86400000,...values});

describe("Personalized feed and queue ranking",()=>{
  it("uses completion, genres and favourite artists without inferring acoustic mood",()=>{
    const songs=[track("known","A"),track("related","A"),track("genre","B"),track("unknown","C",["Metal"])];
    const ranked=rankPersonalizedTracks(songs,{history:[listened("known")],nowMs:now,seed:"test"});
    const known=ranked.find(item=>item.track.id==="known")!,related=ranked.find(item=>item.track.id==="related")!,genre=ranked.find(item=>item.track.id==="genre")!;
    assert.equal(known.lane,"familiar");assert.match(known.reason,/all the way/);
    assert.equal(related.familiarArtist,true);assert.match(related.reason,/Another side/);
    assert.match(genre.reason,/Jazz/);assert.ok(ranked.every(item=>!/energetic|mood|tempo|BPM/i.test(item.reason)));
  });
  it("changes familiar and exploration ordering using the discovery control",()=>{
    const songs=[track("known","A"),track("new","B")],history=[listened("known")];
    const familiar=rankPersonalizedTracks(songs,{history,settings:{discovery:0},nowMs:now,seed:"one"});
    const explore=rankPersonalizedTracks(songs,{history,settings:{discovery:1},nowMs:now,seed:"one"});
    assert.equal(familiar[0].track.id,"known");assert.equal(explore[0].track.id,"new");
  });
  it("snoozes and exclusions remove both candidates and their inferred taste evidence",()=>{
    const songs=[track("known","A",["Jazz"]),track("related","B",["Jazz"]),track("other","C",["Metal"])];
    const feedback=[{target:"recording" as const,targetId:"known",kind:"snooze" as const,expiresAt:now+86400000}];
    const ranked=rankPersonalizedTracks(songs,{history:[listened("known")],feedback,nowMs:now});
    assert.ok(!ranked.some(item=>item.track.id==="known"));
    assert.ok(!ranked.find(item=>item.track.id==="related")!.reason.includes("interest in Jazz"));
    assert.ok(!tasteExcluded(songs[0],feedback,now+86400001));
    const expired=rankPersonalizedTracks(songs,{history:[listened("known")],feedback,nowMs:now+86400001});
    assert.match(expired.find(item=>item.track.id==="related")!.reason,/Jazz/);
  });
  it("artist exclusions inspect featured credits and expire all feedback kinds",()=>{
    const song={...track("one","A"),artistCredits:[{name:"A",artistId:"artist-A"},{name:"B",artistId:"artist-B"}]};
    assert.equal(tasteExcluded(song,[{target:"artist",targetId:"artist-B",kind:"block"}],now),true);
    assert.equal(tasteExcluded(song,[{target:"artist",targetId:"artist-B",kind:"block",expiresAt:now-1}],now),false);
    assert.deepEqual(activeTasteFeedback([{target:"recording",targetId:"one",kind:"less",expiresAt:now-1}],now),[]);
  });
  it("learning can be disabled while keeping explicit likes and seeds useful",()=>{
    const songs=[track("heard","A"),track("seeded","B",["Metal"])];
    const ranked=rankPersonalizedTracks(songs,{history:[listened("heard")],settings:{learnFromListening:false,seedGenres:["Metal"]},nowMs:now});
    assert.equal(ranked.find(item=>item.track.id==="heard")!.heard,false);
    assert.match(ranked.find(item=>item.track.id==="seeded")!.reason,/Metal/);
  });
  it("exact onboarding artist references do not select unrelated same-name identities",()=>{
    const songs=[{...track("right","Same Name"),artistCredits:[{name:"Same Name",artistId:"id-right",reference:{provider:"deezer",id:"1"}}]},
      {...track("wrong","Same Name"),artistCredits:[{name:"Same Name",artistId:"id-wrong",reference:{provider:"deezer",id:"2"}}]}];
    const ranked=rankPersonalizedTracks(songs,{settings:{seedArtists:["Same Name"],seedArtistSelections:[{name:"Same Name",reference:{provider:"deezer",id:"1"}}]},nowMs:now});
    assert.equal(ranked.find(item=>item.track.id==="right")!.familiarArtist,true);
    assert.equal(ranked.find(item=>item.track.id==="wrong")!.familiarArtist,false);
  });
  it("only valid published dates count as recent releases",()=>{
    assert.equal(recentRelease("2026-10-24",now),true);
    for(const value of [undefined,"2026","2026-02-30","2026-12-01","2025-11-01","yesterday"])assert.equal(recentRelease(value,now),false);
    const ranked=rankPersonalizedTracks([{...track("new","A"),releaseDate:"2026-10-24"},track("old","A")],{settings:{seedArtists:["A"]},nowMs:now});
    assert.equal(ranked.find(item=>item.track.id==="new")!.lane,"fresh");assert.match(ranked.find(item=>item.track.id==="new")!.reason,/recent release/);
  });
  it("local queues are unique subsets and enforce explicit/exclusion rules",()=>{
    const songs=[track("one"),track("two"),{...track("explicit"),explicit:true},track("blocked"),track("one")];
    const result=planLocalQueue(songs,{settings:{explicitContent:false},feedback:[{target:"recording",targetId:"blocked",kind:"block"}],limit:80,nowMs:now});
    assert.deepEqual(result.map(song=>song.id).sort(),["one","two"]);
    assert.deepEqual(planLocalQueue([]),[]);
  });
  it("sequences varied artists and keeps supplied evidence outside a restricted collection",()=>{
    const songs=[track("a1","A"),track("a2","A"),track("b1","B"),track("b2","B"),track("c1","C")];
    const ranked=rankPersonalizedTracks(songs,{settings:{seedArtists:["A"],artistVariety:1},nowMs:now});
    const ordered=orderPersonalizedTracks(ranked,{artistVariety:1});
    assert.notEqual(ordered[0].track.artists[0],ordered[1].track.artists[0]);
    const external=track("evidence","Outside",["Jazz"]),restricted=[track("inside","Inside",["Jazz"]),track("other","Other",["Metal"])];
    const inferred=rankPersonalizedTracks(restricted,{evidenceTracks:[external],history:[listened("evidence")],nowMs:now});
    assert.match(inferred.find(item=>item.track.id==="inside")!.reason,/Jazz/);
  });
  it("uses local time evidence only when the listener enables it",()=>{
    const songs=[track("known","A"),track("related","B")],history=[listened("known",{hourWeights:[{hour:13,audibleMs:1800000}]})];
    const aware=rankPersonalizedTracks(songs,{history,settings:{timeAware:true,timeZone:"Africa/Lagos"},nowMs:now});
    const unaware=rankPersonalizedTracks(songs,{history,settings:{timeAware:false,timeZone:"Africa/Lagos"},nowMs:now});
    assert.match(aware.find(item=>item.track.id==="related")!.reason,/around this time/);
    assert.ok(!unaware.find(item=>item.track.id==="related")!.reason.includes("around this time"));
  });
  it("recent-repeat tolerance affects ranking independently of listening totals",()=>{
    const songs=[track("recent","A"),track("older","A")],history=[listened("recent",{lastPlayedAt:now-60000}),listened("older")];
    const strict=rankPersonalizedTracks(songs,{history,settings:{repeatTolerance:0},nowMs:now,seed:"repeat"});
    const loose=rankPersonalizedTracks(songs,{history,settings:{repeatTolerance:1},nowMs:now,seed:"repeat"});
    assert.ok(loose.find(item=>item.track.id==="recent")!.score>strict.find(item=>item.track.id==="recent")!.score+1);
  });
  it("deep-cut preference opens unheard songs from familiar artists independently of popularity",()=>{
    const songs=[track("heard","A"),track("deep","A"),track("liked","A"),track("unfamiliar","B")];
    const options={history:[listened("heard")],likedIds:["liked"],nowMs:now,seed:"deep-cuts"};
    const low=rankPersonalizedTracks(songs,{...options,settings:{deepCutBias:0}});
    const normal=rankPersonalizedTracks(songs,{...options,settings:{deepCutBias:.35}});
    const high=rankPersonalizedTracks(songs,{...options,settings:{deepCutBias:1}});
    const score=(ranked:ReturnType<typeof rankPersonalizedTracks>,id:string)=>ranked.find(item=>item.track.id===id)!.score;
    assert.ok(score(low,"heard")>score(low,"deep"));assert.ok(score(high,"deep")>score(high,"heard"));
    assert.ok(score(normal,"deep")>score(low,"deep"));assert.ok(score(normal,"deep")<score(high,"deep"));
    const lift=score(high,"deep")-score(low,"deep");
    assert.ok(lift>1);assert.ok(lift-(score(high,"liked")-score(low,"liked"))>1);
    assert.ok(lift-(score(high,"unfamiliar")-score(low,"unfamiliar"))>1);
  });
});

describe("Owned, signed feed cursors",()=>{
  const session="12345678-1234-4234-8234-123456789abc",secret="a".repeat(64);
  it("keeps a session and position with a bounded token",()=>{
    const encoded=encodeFeedCursor(session,24,secret),parsed=parseFeedCursor(encoded);
    assert.ok(encoded.length<360);assert.equal(parsed.sessionId,session);assert.equal(parsed.offset,24);assert.doesNotThrow(()=>verifyFeedCursor(parsed,secret));
  });
  it("rejects modified positions, another session's key and malformed tokens",()=>{
    const parsed=parseFeedCursor(encodeFeedCursor(session,24,secret));
    assert.throws(()=>verifyFeedCursor({...parsed,offset:25},secret));assert.throws(()=>verifyFeedCursor(parsed,"b".repeat(64)));
    for(const value of ["", "x".repeat(361),"%%%%",Buffer.from(JSON.stringify({v:1,s:session,o:2501,h:parsed.signature})).toString("base64url")])assert.throws(()=>parseFeedCursor(value));
  });
});
