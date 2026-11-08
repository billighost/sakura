import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { getRebuildPool, inTransaction } from "../src/rebuild/data/db";
import { historyChunk, recordHistory, getHistory } from "../src/rebuild/data/history";
import { clearDataInput, clearPeriodStart, clearPersonalizationData, exportPersonalizationData } from "../src/rebuild/data/personalization";
import { tasteExpiry, tasteInput, setTaste, getTaste, removeTaste } from "../src/rebuild/data/taste";
import { buildListeningInsights, localCalendarDays, getListeningInsights } from "../src/rebuild/data/listeningInsights";
import { getTasteState } from "../src/rebuild/data/tasteState";
import { patchSettings } from "../src/rebuild/data/settings";
import { getProfile } from "../src/rebuild/data/product";
import { card } from "../src/rebuild/data/catalog";

describe("Listening insight and data boundary contracts",()=>{
  it("uses local calendar days across timezones and DST rather than UTC dates",()=>{
    assert.deepEqual(localCalendarDays("America/New_York",new Date("2026-11-02T02:00:00Z"),3),["2026-10-30","2026-10-31","2026-11-01"]);
    assert.deepEqual(localCalendarDays("Asia/Tokyo",new Date("2026-11-01T16:00:00Z"),2),["2026-11-01","2026-11-02"]);
  });
  it("zero-fills days and ranks observed hour genres without inventing untagged genres",()=>{
    const result=buildListeningInsights([{date:"2026-11-08",audibleMs:60000}],[{hour:22,name:"Jazz",audibleMs:60000},{hour:22,name:null,audibleMs:10000}],
      [{name:"Jazz",audibleMs:60000},{name:"Pop",audibleMs:40000}],{events:10,finished:5,completed:3,skipped:2,activeDays:2,uniqueRecordings:4},"Africa/Lagos",new Date("2026-11-08T12:00:00Z"));
    assert.equal(result.days.length,30);assert.equal(result.days.at(-1)?.audibleMs,60000);assert.equal(result.days[0].audibleMs,0);
    assert.equal(result.hours.length,24);assert.equal(result.hours[22].audibleMs,70000);assert.equal(result.hours[22].genres.length,1);
    assert.equal(result.genres[0].share,.6);assert.equal(result.completionRate,.6);assert.equal(result.skipRate,.4);assert.equal(result.peakHour,22);
  });
  it("empty history presents zero measurements and no inferred listening hour",()=>{
    const result=buildListeningInsights([],[],[],{events:0,finished:0,completed:0,skipped:0,activeDays:0,uniqueRecordings:0},"UTC");
    assert.equal(result.completionRate,0);assert.equal(result.peakHour,null);assert.equal(result.confidence.level,"starting");assert.deepEqual(result.genres,[]);
  });
  it("describes sparse listening with singular play, song and day labels",()=>{
    const result=buildListeningInsights([],[],[],{events:1,finished:1,completed:1,skipped:0,activeDays:1,uniqueRecordings:1},"UTC");
    assert.equal(result.confidence.evidence,"1 play across 1 song and 1 day.");
  });
  it("keeps malformed catalog tags unknown instead of turning objects into genres",()=>{
    const recording=card({id:randomUUID(),metadata:{title:"Fixture",artists:["Artist"],genres:["Jazz",null,42,{tag:"Pop"},""]},references:[{provider:"deezer",id:"1"}]});
    assert.deepEqual(recording.genres,["Jazz"]);
  });
  it("validates temporary and permanent taste choices and strict clearing scopes",()=>{
    const targetId=randomUUID();
    assert.equal(tasteInput({target:"recording",targetId,kind:"snooze"}).duration,"week");
    assert.equal(tasteExpiry("day",new Date("2026-11-08T00:00:00Z")),"2026-11-09T00:00:00.000Z");
    assert.equal(tasteExpiry("forever"),null);
    assert.throws(()=>tasteInput({target:"recording",targetId,kind:"snooze",duration:"forever"}));
    assert.throws(()=>tasteInput({target:"account",targetId,kind:"block"}));
    assert.throws(()=>clearDataInput({scope:"downloads"}));
    assert.throws(()=>clearDataInput({scope:"all",period:"year"}));
    assert.equal(clearPeriodStart("week",new Date("2026-11-08T00:00:00Z")),"2026-11-01T00:00:00.000Z");
  });
  it("new stored telemetry does not change the legacy receipt hash contract",()=>{
    const chunk={eventId:"11111111-1111-4111-8111-111111111111",recordingId:"22222222-2222-4222-8222-222222222222",sequence:0,msPlayed:5000,positionMs:5000,completed:false,skipped:false,finished:false,context:"direct",contextId:null};
    const parsed=historyChunk(chunk);assert.equal(parsed.payloadHash.length,64);assert.equal(parsed.positionMs,5000);
    assert.equal(parsed.payloadHash,"147e67124377e04a8ba8765429947271603187f3c80ff11c02fcb4fd92429e5f");
    assert.notEqual(parsed.payloadHash,historyChunk({...chunk,occurredAt:"2026-11-01T12:00:00Z"}).payloadHash);
    assert.throws(()=>historyChunk({...chunk,completed:true,finished:false}));
    assert.throws(()=>historyChunk({...chunk,skipped:true,finished:false}));
    assert.throws(()=>historyChunk({...chunk,occurredAt:"2026-02-30T12:00:00Z"}));
    assert.equal(historyChunk({...chunk,occurredAt:"2026-11-01T00:30:00+09:00"}).occurredAt,"2026-10-31T15:30:00.000Z");
  });
});

const databaseAvailable=Boolean(process.env.SAKURA_REBUILD_DATABASE_URL||process.env.DATABASE_URL);
describe("User-owned personalization data with isolated PostgreSQL fixtures",{skip:!databaseAvailable},()=>{
  const first=randomUUID(),second=randomUUID(),recordingId=randomUUID(),prefix=randomUUID().replaceAll("-","");
  const schema=`sakura_taste_test_${prefix}`;
  let actual:ReturnType<typeof getRebuildPool>,pool:ReturnType<typeof getRebuildPool>;
  const oldEvent=randomUUID(),recentEvent=randomUUID();
  const oldAt=new Date(Date.now()-40*86400000).toISOString(),recentAt=new Date(Date.now()-86400000).toISOString();
  const chunk=(eventId:string,occurredAt:string,sequence=0,msPlayed=5000,positionMs=5000)=>({eventId,recordingId,sequence,msPlayed,positionMs,occurredAt,context:"feed",completed:false,skipped:false,finished:false});
  before(async()=>{
    actual=getRebuildPool();
    const rewrite=(statement:unknown)=>typeof statement==="string"?statement.replaceAll("sakura_v2",schema):statement;
    pool=new Proxy(actual,{get(target,key){
      if(key==="query")return (statement:unknown,...args:unknown[])=>Reflect.apply(target.query,target,[rewrite(statement),...args]);
      if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){
        if(property==="query")return (statement:unknown,...args:unknown[])=>Reflect.apply(connection.query,connection,[rewrite(statement),...args]);
        const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;
      }});};
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    }});
    (globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=pool;
    for(const filename of ["src/rebuild/server/schema-proposal.sql","src/rebuild/data/schema.sql"])
      await actual.query((await readFile(filename,"utf8")).replaceAll("sakura_v2",schema));
    await inTransaction(async client=>{
      for(const id of [first,second])await client.query(`INSERT INTO public."User"(id,username,email,"passwordHash","createdAt") VALUES($1::uuid,$2,$3,'invalid-test-hash',now())`,[id,`taste_${id.slice(0,16)}`,`${id}@example.invalid`]);
      await client.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) VALUES($1::uuid,$2::jsonb,'verified')`,[recordingId,JSON.stringify({title:"Taste fixture",artists:["Fixture voice"],durationMs:180000,genres:["Jazz"]})]);
      await client.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) VALUES('deezer',$1,$2::uuid,now())`,[`fixture-${prefix}`,recordingId]);
      await client.query(`INSERT INTO sakura_v2."Favorite"(account_id,recording_id) VALUES($1::uuid,$2::uuid)`,[first,recordingId]);
    });
  });
  after(async()=>{
    if(actual){
      await actual.query(`DELETE FROM "${schema}"."LifetimeListeningSummary" WHERE account_id=ANY($1::uuid[])`,[[first,second]]).catch(()=>{});
      await actual.query(`DELETE FROM public."User" WHERE id=ANY($1::uuid[])`,[[first,second]]).catch(()=>{});
      await actual.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      (globalThis as unknown as {sakuraV2ProductPool:typeof actual}).sakuraV2ProductPool=actual;
      await actual.end();
    }
  });
  it("persists terminal positions by sequence while counting delayed audio once",async()=>{
    await recordHistory(first,chunk(recentEvent,recentAt,2,10000,80000));
    await recordHistory(first,chunk(recentEvent,recentAt,0,5000,5000));
    const history=await getHistory(first,new URL("http://localhost/api"));
    assert.equal(history.events[0].positionMs,80000);assert.equal(history.events[0].audibleMs,15000);
    const retry=await recordHistory(first,chunk(recentEvent,recentAt,2,10000,80000));assert.ok("duplicate" in retry&&retry.duplicate);
    await recordHistory(first,chunk(oldEvent,oldAt));await recordHistory(second,chunk(randomUUID(),recentAt));
  });
  it("scopes deliberate feedback and persists reversible expiry",async()=>{
    await setTaste(first,{target:"recording",targetId:recordingId,kind:"snooze",duration:"week"});
    assert.equal((await getTaste(first)).feedback.length,1);assert.equal((await getTaste(second)).feedback.length,0);
    assert.ok((await getTaste(first)).feedback[0].track?.title);
    await removeTaste(first,{target:"recording",targetId:recordingId});assert.equal((await getTaste(first)).feedback.length,0);
    await setTaste(first,{target:"recording",targetId:recordingId,kind:"block",duration:"forever"});
  });
  it("returns the authoritative retained exclusions after week and month feedback clearing",async()=>{
    const recentId=randomUUID();
    await pool.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT $2::uuid,metadata,'verified' FROM sakura_v2."Recording" WHERE id=$1::uuid`,[recordingId,recentId]);
    await pool.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) VALUES('deezer',$1,$2::uuid,now())`,[`recent-feedback-${prefix}`,recentId]);
    await pool.query(`UPDATE sakura_v2."TasteFeedback" SET updated_at=$2::timestamptz WHERE account_id=$1::uuid AND target_id=$3::uuid`,[first,oldAt,recordingId]);
    for(const period of ["week","month"] as const){
      const saved=await setTaste(first,{target:"recording",targetId:recentId,kind:"block"});
      assert.match(saved.updatedAt,/\.\d{6}Z$/);
      const result=await clearPersonalizationData(first,{scope:"feedback",period});
      assert.equal(result.clearedFeedback,1);assert.equal(result.clearedEvents,0);assert.equal(result.feedbackAuthoritative,true);
      assert.deepEqual(result.tasteFeedback.map(item=>item.targetId),[recordingId]);assert.equal(result.tasteFeedback[0].kind,"block");
      assert.ok(result.tasteFeedback[0].updatedAt<result.cutoff);assert.ok(saved.updatedAt<result.cutoff);
      assert.equal((await getTaste(first)).feedback.length,1);
    }
  });
  it("clears a week, reconciles retained totals, and rejects resurrected offline events",async()=>{
    const result=await clearPersonalizationData(first,{scope:"history",period:"week"});assert.equal(result.clearedEvents,1);
    assert.equal(result.feedbackAuthoritative,true);assert.deepEqual(result.tasteFeedback.map(item=>item.targetId),[recordingId]);
    const profile=await exportPersonalizationData(first);assert.equal(profile.stats.audibleMs,"5000");assert.equal(profile.listeningHistory.length,1);
    const state=await getTasteState(first);assert.equal(state.tasteEvidence[0].audibleMs,5000);assert.equal(new Date(state.historyClearedAt).getTime(),Date.parse(result.cutoff));
    assert.ok(state.historyDeletion?.periodStart);
    assert.equal((await exportPersonalizationData(second)).stats.audibleMs,"5000");
    const late=await recordHistory(first,chunk(recentEvent,new Date(Date.now()+1000).toISOString(),3));assert.ok("cleared" in late&&late.cleared);
    const unseen=await recordHistory(first,chunk(randomUUID(),recentAt));assert.ok("cleared" in unseen&&unseen.cleared);
    assert.equal((await getTaste(first)).feedback.length,1);
    assert.equal((await pool.query(`SELECT COUNT(*)::integer n FROM sakura_v2."Favorite" WHERE account_id=$1::uuid`,[first])).rows[0].n,1);
  });
  it("clears all owned measurements and feedback while new timestamped listening can resume",async()=>{
    const result=await clearPersonalizationData(first,{scope:"all",period:"all"});assert.equal(result.clearedEvents,1);assert.equal(result.clearedFeedback,1);
    assert.deepEqual(result.tasteFeedback,[]);
    const empty=await exportPersonalizationData(first);assert.equal(empty.stats.audibleMs,"0");assert.equal(empty.recordingSummaries.length,0);
    const eventId=randomUUID(),occurredAt=new Date(Date.parse(result.cutoff)+1000).toISOString();
    const resumed=await recordHistory(first,chunk(eventId,occurredAt));assert.ok(resumed.accepted);
    const insights=await getListeningInsights(first,"Africa/Lagos");assert.equal(insights.tasteEvidence[0].audibleMs,5000);
    const undated={...chunk(randomUUID(),occurredAt)};delete (undated as {occurredAt?:string}).occurredAt;
    const rejected=await recordHistory(first,undated);assert.ok("cleared" in rejected&&rejected.cleared);
  });
  it("retains undated imported aggregates without keeping an erased recent date",async()=>{
    await pool.query(`UPDATE sakura_v2."ListeningRecordingSummary" SET audible_ms=audible_ms+30000,play_count=play_count+2 WHERE account_id=$1::uuid`,[second]);
    await pool.query(`UPDATE sakura_v2."LifetimeListeningSummary" SET audible_ms=audible_ms+30000,play_count=play_count+2 WHERE account_id=$1::uuid`,[second]);
    await clearPersonalizationData(second,{scope:"history",period:"week"});
    const retained=await exportPersonalizationData(second);
    assert.equal(retained.stats.audibleMs,"30000");assert.equal(retained.recordingSummaries[0].lastPlayedAt,null);
    assert.equal(retained.listeningHistory.length,0);
    await clearPersonalizationData(second,{scope:"history",period:"all"});
    assert.equal((await exportPersonalizationData(second)).stats.audibleMs,"0");
  });
  it("divides audible time among distinct published tags and leaves missing tags unknown",async()=>{
    await pool.query(`UPDATE sakura_v2."Recording" SET metadata=jsonb_set(metadata,'{genres}','["Jazz","jazz","Pop",""]'::jsonb) WHERE id=$1::uuid`,[recordingId]);
    try{
      const insights=await getListeningInsights(first,"Africa/Lagos");
      assert.equal(insights.genres.length,2);assert.equal(insights.genres.reduce((sum,genre)=>sum+genre.audibleMs,0),5000);
      assert.ok(insights.genres.every(genre=>genre.audibleMs===2500&&genre.share===.5));
      assert.equal(insights.hours.reduce((sum,hour)=>sum+hour.audibleMs,0),5000);
      await pool.query(`UPDATE sakura_v2."Recording" SET metadata=jsonb_set(metadata,'{genres}','[null,42,{"tag":"Pop"},""]'::jsonb) WHERE id=$1::uuid`,[recordingId]);
      const unknown=await getListeningInsights(first,"Africa/Lagos");assert.deepEqual(unknown.genres,[]);assert.equal(unknown.untaggedAudibleMs,5000);
    }finally{await pool.query(`UPDATE sakura_v2."Recording" SET metadata=jsonb_set(metadata,'{genres}','["Jazz"]'::jsonb) WHERE id=$1::uuid`,[recordingId]);}
  });
  it("rejects private and paused offline listening even after recording is enabled again",async()=>{
    for(const preference of ["privateSession","learnFromListening"]){
      await patchSettings(second,{[preference]:preference==="privateSession"});
      await pool.query(`UPDATE sakura_v2."ListeningPrivacyWindow" SET started_at=clock_timestamp()-interval '2 seconds' WHERE account_id=$1::uuid AND ended_at IS NULL`,[second]);
      const pausedAt=new Date().toISOString(),eventId=randomUUID();
      await patchSettings(second,{[preference]:preference!=="privateSession"});
      const late=await recordHistory(second,chunk(eventId,pausedAt));assert.equal(late.accepted,false);assert.ok("learningPaused" in late&&late.learningPaused);
    }
    const exported=await exportPersonalizationData(second);assert.equal(exported.privacyPeriods.length,2);assert.equal(exported.listeningHistory.length,0);
  });
  it("exports replayable measurement dates without exposing playback locators",async()=>{
    const profile=await exportPersonalizationData(first);
    assert.equal(profile.listeningMeasurements.length,1);assert.equal(profile.listeningMeasurements[0].audibleMs,"5000");
    assert.ok(profile.listeningMeasurements[0].occurredAt);
    await setTaste(first,{target:"recording",targetId:recordingId,kind:"less"});
    await pool.query(`UPDATE sakura_v2."Recording" SET metadata=metadata||'{"audioUrl":"https://private.invalid/signed?token=secret"}'::jsonb WHERE id=$1::uuid`,[recordingId]);
    try{assert.ok(!JSON.stringify(await exportPersonalizationData(first)).includes("private.invalid"));}
    finally{await pool.query(`UPDATE sakura_v2."Recording" SET metadata=metadata-'audioUrl' WHERE id=$1::uuid`,[recordingId]);}
  });
  it("keeps undated receipts out of daily and hour charts while retaining their time",async()=>{
    const stamped=(await pool.query(`SELECT event_id,sequence,occurred_at FROM sakura_v2."ListeningChunk" WHERE account_id=$1::uuid`,[first])).rows[0];
    await pool.query(`UPDATE sakura_v2."ListeningChunk" SET occurred_at=NULL WHERE account_id=$1::uuid`,[first]);
    try{
      const insights=await getListeningInsights(first,"Africa/Lagos");
      assert.equal(insights.tasteEvidence[0].audibleMs,5000);assert.deepEqual(insights.tasteEvidence[0].hourWeights,[]);
      assert.equal(insights.days.reduce((sum,day)=>sum+day.audibleMs,0),0);assert.equal(insights.hours.reduce((sum,hour)=>sum+hour.audibleMs,0),0);assert.equal(insights.activeDays,0);
      const exported=await exportPersonalizationData(first);assert.equal(exported.listeningMeasurements[0].occurredAt,null);assert.ok(exported.listeningMeasurements[0].receivedAt);
    }finally{await pool.query(`UPDATE sakura_v2."ListeningChunk" SET occurred_at=$4::timestamptz WHERE account_id=$1::uuid AND event_id=$2::uuid AND sequence=$3`,[first,stamped.event_id,stamped.sequence,stamped.occurred_at]);}
  });
  it("returns every selective deletion receipt and keeps erased profile/export state coherent",async()=>{
    const blocker=await actual.connect();let committed=false;
    try{
      await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${first}`]);
      await blocker.query(`DELETE FROM "${schema}"."ListeningEventLedger" WHERE account_id=$1::uuid`,[first]);
      await blocker.query(`DELETE FROM "${schema}"."ListeningRecordingSummary" WHERE account_id=$1::uuid`,[first]);
      await blocker.query(`DELETE FROM "${schema}"."LifetimeListeningSummary" WHERE account_id=$1::uuid`,[first]);
      const exporting=exportPersonalizationData(first),profiling=getProfile(first);
      await blocker.query("COMMIT");committed=true;
      const [exported,profile]=await Promise.all([exporting,profiling]);
      assert.equal(exported.stats.audibleMs,"0");assert.equal(exported.listeningHistory.length,0);assert.equal(exported.listeningMeasurements.length,0);
      assert.equal(profile.stats.audibleMs,0);assert.equal(profile.topArtists.length,0);assert.equal(profile.insights.tasteEvidence.length,0);
      const state=await getTasteState(first);assert.equal(state.historyDeletions.length,2);assert.ok(state.historyDeletions.some(row=>row.periodStart!==null));assert.ok(state.historyDeletions.some(row=>row.periodStart===null));
    }finally{if(!committed)await blocker.query("ROLLBACK");blocker.release();}
  });
  it("timestamps a waiting song choice after the clear it follows, and stamps undo replies",async()=>{
    const blocker=await pool.connect();let committed=false,pending:Promise<Awaited<ReturnType<typeof setTaste>>>|undefined;
    let signalLock!:()=>void;const lockRequested=new Promise<void>(resolve=>{signalLock=resolve;});
    const observed=new Proxy(pool,{get(target,key){
      if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){
        if(property==="query")return (statement:unknown,...args:unknown[])=>{
          if(typeof statement==="string"&&statement.includes("pg_advisory_xact_lock"))signalLock();
          return Reflect.apply(connection.query,connection,[statement,...args]);
        };
        const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;
      }});};
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    }});
    try{
      await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${first}`]);
      (globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=observed;
      pending=setTaste(first,{target:"recording",targetId:recordingId,kind:"block"});
      await Promise.race([lockRequested,pending.then(()=>{throw new Error("Choice should wait behind clearing");})]);
      const cutoff=String((await blocker.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp`)).rows[0].stamp);
      await blocker.query(`DELETE FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid`,[first]);
      await blocker.query("COMMIT");committed=true;
      const saved=await pending;assert.ok(saved.updatedAt>cutoff);
      assert.equal((await getTaste(first)).feedback[0].updatedAt,saved.updatedAt);
      const removed=await removeTaste(first,{target:"recording",targetId:recordingId});assert.ok(removed.mutationAt>saved.updatedAt);
    }finally{
      if(!committed)await blocker.query("ROLLBACK");blocker.release();
      if(pending)await pending.catch(()=>undefined);
      (globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=pool;
    }
  });
});
