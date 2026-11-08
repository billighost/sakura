import "dotenv/config";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {after,before,describe,it} from "node:test";
import {getRebuildPool,inTransaction} from "../src/rebuild/data/db";
import {syncCatalog,type RecordingCard} from "../src/rebuild/data/catalog";
import {patchSettings} from "../src/rebuild/data/settings";
import {setFavorite} from "../src/rebuild/data/collections";
import {recordHistory} from "../src/rebuild/data/history";
import {clearPersonalizationData} from "../src/rebuild/data/personalization";
import {getPersonalizedFeed,generateSmartQueue} from "../src/rebuild/recommendations/feed";
import {ensureMixes,getMix,offlineMixes} from "../src/rebuild/recommendations/service";
import {ProductError} from "../src/rebuild/data/validation";
import {getHome} from "../src/rebuild/data/product";

const first=randomUUID(),second=randomUUID(),prefix=randomUUID().replaceAll("-","");
const recordings:string[]=Array.from({length:40},()=>randomUUID());
const actual=getRebuildPool(),schema=`sakura_feed_test_${prefix}`;
const rewrite=(sql:unknown)=>typeof sql==="string"?sql.replaceAll("sakura_v2",schema):sql;
const pool=new Proxy(actual,{get(target,key){
  if(key==="query")return (sql:unknown,...args:unknown[])=>Reflect.apply(target.query,target,[rewrite(sql),...args]);
  if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){
    if(property==="query")return (sql:unknown,...args:unknown[])=>Reflect.apply(connection.query,connection,[rewrite(sql),...args]);
    const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;
  }});};
  const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
}});
(globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=pool;
const feed=(cursor?:string|null,surface="home",mode="balanced",limit=7)=>{const url=new URL(`http://localhost/api/v2/feed?surface=${surface}&mode=${mode}&limit=${limit}`);if(cursor)url.searchParams.set("cursor",cursor);return url;};
const status=(code:number)=>(error:unknown)=>error instanceof ProductError&&error.status===code;

describe("Personalization service with isolated PostgreSQL fixtures",()=>{
  before(async()=>{
    for(const filename of ["src/rebuild/server/schema-proposal.sql","src/rebuild/data/schema.sql"])await actual.query((await readFile(filename,"utf8")).replaceAll("sakura_v2",schema));
    await inTransaction(async client=>{
      for(const id of [first,second])await client.query(`INSERT INTO public."User"(id,username,email,"passwordHash","createdAt") VALUES($1::uuid,$2,$3,'fixture',now())`,[id,`feed_${id.slice(0,16)}`,`${id}@example.invalid`]);
      const fixtures=recordings.map((id,index)=>({id,metadata:{title:`Feed fixture ${index}`,artists:[`Feed Artist ${index%10}`],durationMs:180000,
        artistReference:{provider:"deezer",id:`fixture-${prefix}-artist-${index%10}`},albumReference:{provider:"deezer",id:`fixture-${prefix}-album-${index}`},
        albumTitle:`Fixture Album ${index}`,genres:[index%2?"Jazz":"Afrobeats"],popularity:.5}}));
      await client.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT id::uuid,metadata,'verified' FROM jsonb_to_recordset($1::jsonb) x(id text,metadata jsonb)`,[JSON.stringify(fixtures)]);
      await client.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at) SELECT 'deezer','fixture-'||$2||'-'||x.position,x.id,now() FROM unnest($1::uuid[]) WITH ORDINALITY x(id,position)`,[recordings,prefix]);
      await syncCatalog(client);
    });
    await patchSettings(first,{seedArtists:["Feed Artist 0"],seedGenres:["Jazz"],onboarded:true});
  });
  after(async()=>{
    try{await actual.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await actual.query(`DELETE FROM public."User" WHERE id=ANY($1::uuid[])`,[[first,second]]);}
    finally{await actual.end();}
  });
  it("continues a stable, unique catalog snapshot to an honest end",async()=>{
    const page=await getPersonalizedFeed(first,feed()),seen=page.items.map(item=>item.track.id);
    assert.equal(page.personalized,true);assert.equal(page.totalCandidates,40);assert.ok(page.nextCursor);
    const next=await getPersonalizedFeed(first,feed(page.nextCursor));
    assert.deepEqual(next.items,(await getPersonalizedFeed(first,feed(page.nextCursor))).items);
    seen.push(...next.items.map(item=>item.track.id));let cursor=next.nextCursor;
    while(cursor){const current=await getPersonalizedFeed(first,feed(cursor));seen.push(...current.items.map(item=>item.track.id));cursor=current.nextCursor;}
    assert.equal(seen.length,40);assert.equal(new Set(seen).size,40);assert.ok(seen.every(id=>recordings.includes(id)));
  });
  it("binds cursors to the owning account, surface, settings and expiry",async()=>{
    const page=await getPersonalizedFeed(first,feed());assert.ok(page.nextCursor);
    await assert.rejects(getPersonalizedFeed(second,feed(page.nextCursor)),status(410));
    await assert.rejects(getPersonalizedFeed(first,feed(page.nextCursor,"discover")),status(400));
    await patchSettings(first,{artistVariety:.9});await assert.rejects(getPersonalizedFeed(first,feed(page.nextCursor)),status(410));
    const renewed=await getPersonalizedFeed(first,feed());
    await pool.query(`UPDATE sakura_v2."FeedSession" SET expires_at=now()-interval '1 minute' WHERE account_id=$1::uuid AND id=$2::uuid`,[first,renewed.sessionId]);
    await assert.rejects(getPersonalizedFeed(first,feed(renewed.nextCursor)),status(410));
  });
  it("liking or unliking changes the feed selection and its explanations",async()=>{
    const page=await getPersonalizedFeed(first,feed());
    await setFavorite(first,{recordingId:recordings[0],liked:true});
    await assert.rejects(getPersonalizedFeed(first,feed(page.nextCursor)),status(410));
    const liked=await getPersonalizedFeed(first,feed(null,"home","balanced",40));
    assert.match(liked.items.find(item=>item.track.id===recordings[0])!.reason,/liked/);
    await setFavorite(first,{recordingId:recordings[0],liked:false});
    const unliked=await getPersonalizedFeed(first,feed(null,"home","balanced",40));
    assert.doesNotMatch(unliked.items.find(item=>item.track.id===recordings[0])!.reason,/liked/);
  });
  it("rechecks suppression after a cursor snapshot has been created",async()=>{
    const page=await getPersonalizedFeed(first,feed()),pending=await getPersonalizedFeed(first,feed(page.nextCursor)),blocked=pending.items[0].track.id;
    await pool.query(`INSERT INTO sakura_v2."TasteFeedback"(account_id,target,target_id,kind) VALUES($1::uuid,'recording',$2::uuid,'block') ON CONFLICT(account_id,target,target_id) DO UPDATE SET kind='block',expires_at=NULL`,[first,blocked]);
    const filtered=await getPersonalizedFeed(first,feed(page.nextCursor));assert.equal(filtered.items.length,7);assert.ok(filtered.items.every(item=>item.track.id!==blocked));
    await pool.query(`DELETE FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid`,[first]);
  });
  it("fresh favourite-artist shelves rely on an actual published release date",async()=>{
    const release=new Date(Date.now()-86400000).toISOString().slice(0,10);
    await pool.query(`UPDATE sakura_v2."Album" SET release_date=$1 WHERE external_id=$2`,[release,`fixture-${prefix}-album-0`]);
    await pool.query(`UPDATE sakura_v2."Album" SET release_date='2099-01-01' WHERE external_id=$1`,[`fixture-${prefix}-album-10`]);
    const page=await getPersonalizedFeed(first,feed()),shelf=page.sections.find(section=>section.id==="fresh-voices");
    assert.ok(shelf);assert.ok(shelf.tracks.some(track=>track.id===recordings[0]));assert.ok(!shelf.tracks.some(track=>track.id===recordings[10]));
  });
  it("an old recording on a recent compilation is not labeled a new release",async()=>{
    const original=randomUUID();
    await pool.query(`INSERT INTO sakura_v2."Album"(id,provider,external_id,title,release_date) VALUES($1::uuid,'deezer',$2,'Original edition','2001-04-12')`,[original,`fixture-${prefix}-original`]);
    await pool.query(`INSERT INTO sakura_v2."RecordingAlbum"(recording_id,album_id,position) VALUES($1::uuid,$2::uuid,99)`,[recordings[0],original]);
    try{
      const page=await getPersonalizedFeed(first,feed(null,"home","balanced",40));
      assert.ok(!page.sections.find(section=>section.id==="fresh-voices")?.tracks.some(track=>track.id===recordings[0]));
      assert.doesNotMatch(page.items.find(item=>item.track.id===recordings[0])!.reason,/recent album/);
    }finally{await pool.query(`DELETE FROM sakura_v2."Album" WHERE id=$1::uuid`,[original]);}
  });
  it("smart queues stay inside chosen downloads, collections and liked songs",async()=>{
    const selected=recordings.slice(0,5),queue=await generateSmartQueue(first,{scope:"downloads",recordingIds:selected,limit:80});
    assert.equal(queue.tracks.length,5);assert.ok(queue.tracks.every(track=>selected.includes(track.id)));assert.equal(new Set(queue.tracks.map(track=>track.id)).size,5);
    assert.deepEqual((await generateSmartQueue(first,{scope:"collection",recordingIds:[]})).tracks,[]);
    await setFavorite(first,{recordingId:recordings[0],liked:true});await setFavorite(first,{recordingId:recordings[1],liked:true});
    const liked=await generateSmartQueue(first,{scope:"liked"});assert.deepEqual(liked.tracks.map(track=>track.id).sort(),recordings.slice(0,2).sort());
    assert.equal((await generateSmartQueue(second,{scope:"liked"})).tracks.length,0);
    await assert.rejects(generateSmartQueue(first,{scope:"downloads"}),status(400));
    await assert.rejects(generateSmartQueue(first,{scope:"all",recordingIds:selected}),status(400));
    await assert.rejects(generateSmartQueue(first,{scope:"collection",recordingIds:[selected[0],selected[0]]}),status(400));
  });
  it("uses retained listening evidence, ignores expired feedback and omits blocked taste",async()=>{
    await recordHistory(first,{eventId:randomUUID(),recordingId:recordings[2],sequence:0,msPlayed:120000,positionMs:120000,completed:true,finished:true});
    await pool.query(`INSERT INTO sakura_v2."TasteFeedback"(account_id,target,target_id,kind,expires_at) VALUES($1::uuid,'recording',$2::uuid,'snooze',now()-interval '1 minute')`,[first,recordings[2]]);
    const allowed=await generateSmartQueue(first,{scope:"collection",recordingIds:[recordings[2]]});assert.equal(allowed.tracks.length,1);assert.ok(allowed.taste.history.some(item=>item.recordingId===recordings[2]));
    await pool.query(`UPDATE sakura_v2."TasteFeedback" SET kind='block',expires_at=NULL WHERE account_id=$1::uuid AND target_id=$2::uuid`,[first,recordings[2]]);
    const blocked=await generateSmartQueue(first,{scope:"collection",recordingIds:[recordings[2]]});assert.equal(blocked.tracks.length,0);assert.ok(!blocked.taste.history.some(item=>item.recordingId===recordings[2]));
    await pool.query(`DELETE FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid`,[first]);
  });
  it("old mix links still respect a new taste exclusion",async()=>{
    const mixes=await ensureMixes(first,true),mix=mixes.find(item=>item.status==="ready");assert.ok(mix);
    const old=await getMix(first,mix.id);assert.ok(old.recordings.length);
    const blocked=old.recordings[0].id;
    await pool.query(`INSERT INTO sakura_v2."TasteFeedback"(account_id,target,target_id,kind) VALUES($1::uuid,'recording',$2::uuid,'block')`,[first,blocked]);
    assert.ok((await getMix(first,mix.id)).recordings.every((track:RecordingCard)=>track.id!==blocked));
    await pool.query(`DELETE FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid`,[first]);
  });
  it("cold-start pages keep their evidence status while continuing the same feed",async()=>{
    const firstPage=await getPersonalizedFeed(second,feed());
    assert.equal(firstPage.personalized,false);assert.ok(firstPage.nextCursor);
    assert.ok(firstPage.items.every(item=>item.reason==="A starting point for your recommendations"));
    assert.equal((await getPersonalizedFeed(second,feed(firstPage.nextCursor))).personalized,false);
  });
  it("explicit preferences filter liked recordings and every restricted queue source",async()=>{
    const explicit=recordings[39];
    await pool.query(`UPDATE sakura_v2."Recording" SET metadata=jsonb_set(metadata,'{explicit}','"explicit"'::jsonb) WHERE id=$1::uuid`,[explicit]);
    await setFavorite(first,{recordingId:explicit,liked:true});
    await patchSettings(first,{explicitContent:false});
    try{
      for(const scope of ["collection","downloads","liked"]){
        const queue=await generateSmartQueue(first,{scope,recordingIds:[explicit]});assert.deepEqual(queue.tracks,[]);
      }
      const page=await getPersonalizedFeed(first,feed(null,"home","balanced",40));
      assert.equal(page.items.length,39);assert.ok(page.items.every(item=>item.track.id!==explicit));
      assert.ok(page.sections.every(section=>section.tracks.every(track=>track.id!==explicit)));
    }finally{
      await patchSettings(first,{explicitContent:true});
      await setFavorite(first,{recordingId:explicit,liked:false});
      await pool.query(`UPDATE sakura_v2."Recording" SET metadata=metadata-'explicit' WHERE id=$1::uuid`,[explicit]);
    }
  });
  it("private and paused learning prevent measurement while explicit seeds still personalize",async()=>{
    const value={recordingId:recordings[0],sequence:0,msPlayed:5000,positionMs:5000,occurredAt:new Date().toISOString()};
    await patchSettings(second,{privateSession:true});
    const privateResult=await recordHistory(second,{...value,eventId:randomUUID()});
    assert.equal(privateResult.accepted,false);assert.ok("privateSession" in privateResult&&privateResult.privateSession);
    await patchSettings(second,{privateSession:false,learnFromListening:false,seedGenres:["Jazz"]});
    const paused=await recordHistory(second,{...value,eventId:randomUUID()});
    assert.equal(paused.accepted,false);assert.ok("learningPaused" in paused&&paused.learningPaused);
    const page=await getPersonalizedFeed(second,feed());assert.equal(page.personalized,true);assert.equal(page.learning,false);
    assert.ok(page.items.some(item=>item.reason.includes("Jazz")));
    assert.equal((await pool.query(`SELECT COUNT(*)::integer n FROM sakura_v2."ListeningEventLedger" WHERE account_id=$1::uuid`,[second])).rows[0].n,0);
  });
  it("a feed waiting behind user erasure cannot recreate erased taste evidence",async()=>{
    await patchSettings(second,{privateSession:false,learnFromListening:true,seedArtists:[],seedGenres:[]});
    await recordHistory(second,{eventId:randomUUID(),recordingId:recordings[3],sequence:0,msPlayed:60000,positionMs:60000,occurredAt:new Date().toISOString()});
    assert.equal((await getPersonalizedFeed(second,feed())).personalized,true);
    const oldMix=(await ensureMixes(second,true))[0];assert.ok(oldMix);
    const blocker=await actual.connect();let committed=false;
    try{
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${second}`]);
      const clearing=clearPersonalizationData(second,{scope:"history",period:"all"});
      // Wait for the exact erasure request to enter PostgreSQL's advisory-lock
      // queue; timer ordering cannot establish this on a remote connection.
      const lockKey=`sakura-v2-history:${second}`,deadline=Date.now()+10000;
      let clearWaiting=false;
      while(Date.now()<deadline){
        const waiting=await blocker.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
          AND classid::bigint=CASE WHEN hashtext($1)<0 THEN 4294967295::bigint ELSE 0::bigint END
          AND objid::bigint=(hashtext($1)::bigint & 4294967295::bigint)) AS waiting`,[lockKey]);
        if(waiting.rows[0].waiting){clearWaiting=true;break;}
      }
      assert.ok(clearWaiting,"The erasure request must be waiting on its account lock before the feed starts");
      const arriving=getPersonalizedFeed(second,feed());
      const opening=getMix(second,oldMix.id).then(()=>false,error=>error instanceof ProductError&&error.status===404);
      const homeOpening=getHome(second);
      await blocker.query("COMMIT");committed=true;
      await clearing;const page=await arriving;
      assert.equal(page.personalized,false);
      assert.ok(page.items.every(item=>item.reason==="A starting point for your recommendations"));
      assert.equal(await opening,true,"An erased mix cannot reopen its old projection");
      assert.deepEqual((await homeOpening).recent,[],"Home cannot return the erased recent history");
      assert.equal((await pool.query(`SELECT COUNT(*)::integer n FROM sakura_v2."ListeningEventLedger" WHERE account_id=$1::uuid`,[second])).rows[0].n,0);
    }finally{if(!committed)await blocker.query("ROLLBACK");blocker.release();}
  });
  it("offline mix SQL ranks only supplied eligible recordings and ignores expired breaks",async()=>{
    const selected=recordings.slice(0,16);
    await recordHistory(first,{eventId:randomUUID(),recordingId:selected[5],sequence:0,msPlayed:5000,positionMs:5000,occurredAt:new Date().toISOString()});
    await pool.query(`INSERT INTO sakura_v2."TasteFeedback"(account_id,target,target_id,kind,expires_at)
      VALUES($1::uuid,'recording',$2::uuid,'block',NULL),($1::uuid,'recording',$3::uuid,'snooze',now()-interval '1 minute')
      ON CONFLICT(account_id,target,target_id) DO UPDATE SET kind=EXCLUDED.kind,expires_at=EXCLUDED.expires_at`,[first,selected[0],selected[1]]);
    try{
      const result=await offlineMixes(first,{recordingIds:selected});
      assert.ok(result.recordings.every(track=>selected.includes(track.id)&&track.id!==selected[0]));
      assert.ok(result.recordings.some(track=>track.id===selected[1]));
      for(const mix of result.mixes){
        assert.equal(new Set(mix.recordingIds).size,mix.recordingIds.length);
        assert.ok(mix.recordingIds.every(id=>selected.includes(id)&&id!==selected[0]));
      }
      await patchSettings(first,{learnFromListening:false});
      assert.ok((await offlineMixes(first,{recordingIds:selected})).recordings.length);
    }finally{
      await patchSettings(first,{learnFromListening:true});
      await pool.query(`DELETE FROM sakura_v2."TasteFeedback" WHERE account_id=$1::uuid AND target_id=ANY($2::uuid[])`,[first,selected.slice(0,2)]);
    }
  });
  it("bounds retained feed snapshots to eight per account",async()=>{
    for(let index=0;index<10;index++)await getPersonalizedFeed(first,feed());
    const count=await pool.query(`SELECT COUNT(*)::integer n FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid`,[first]);assert.ok(count.rows[0].n<=8);
  });
});
