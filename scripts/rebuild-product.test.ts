import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after,before,describe,it } from "node:test";
import { getRebuildPool,inTransaction } from "../src/rebuild/data/db";
import { getLibrary,createPlaylist,getPlaylist,mutatePlaylistTracks,setFavorite,updatePlaylist,deletePlaylist } from "../src/rebuild/data/collections";
import { recordHistory,getHistory,compactHistory,historyChunk } from "../src/rebuild/data/history";
import { getSettings,patchSettings } from "../src/rebuild/data/settings";
import { getProfile,getArtist,getAlbum } from "../src/rebuild/data/product";
import { syncCatalog,cardsForIds } from "../src/rebuild/data/catalog";
import { ensureMixes,getMix,offlineMixes } from "../src/rebuild/recommendations/service";
import { SITUATIONAL_MIXES } from "../src/rebuild/recommendations/situations";
import { bloomWindows } from "../src/rebuild/bloom/calendar";
import { getBloom,listBloom,revealBloom,completeBloom,archivedBloom } from "../src/rebuild/bloom/service";
import { ProductError,pageInput,preferencesPatch } from "../src/rebuild/data/validation";
import { entityReference } from "../src/rebuild/data/entities";

const first=randomUUID(),second=randomUUID(),prefix=randomUUID().replaceAll("-","");
const recordingIds=Array.from({length:80},()=>randomUUID());
const events=Array.from({length:6},()=>randomUUID());
const actualPool=getRebuildPool();
const testSchema=`sakura_test_${prefix}`;
// Each run gets an isolated catalog schema. Synthetic verified recordings must
// never appear in the real Home feed while browser tests or people use the app.
const rewrite=(statement:unknown)=>typeof statement==="string"?statement.replaceAll("sakura_v2",testSchema):statement;
const pool=new Proxy(actualPool,{get(target,property){
  if(property==="query")return (statement:unknown,...args:unknown[])=>Reflect.apply(target.query,target,[rewrite(statement),...args]);
  if(property==="connect")return async()=>{
    const client=await target.connect();return new Proxy(client,{get(connection,key){
      if(key==="query")return (statement:unknown,...args:unknown[])=>Reflect.apply(connection.query,connection,[rewrite(statement),...args]);
      const value=Reflect.get(connection,key);return typeof value==="function"?value.bind(connection):value;
    }});
  };
  const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
}});
(globalThis as unknown as {sakuraV2ProductPool:typeof pool}).sakuraV2ProductPool=pool;
const input=(sequence:number,msPlayed:number,flags={})=>({eventId:events[0],recordingId:recordingIds[0],sequence,msPlayed,positionMs:msPlayed,context:"test",...flags});
describe("Fresh v2 product with isolated PostgreSQL fixtures",()=>{
  before(async()=>{
    for(const filename of ["src/rebuild/server/schema-proposal.sql","src/rebuild/data/schema.sql"]){
      await actualPool.query((await readFile(filename,"utf8")).replaceAll("sakura_v2",testSchema));
    }
    await inTransaction(async client=>{
      for(const id of [first,second])await client.query(`INSERT INTO public."User"(id,username,email,"passwordHash","createdAt")
        VALUES($1::uuid,$2,$3,'not-a-valid-hash',now())`,[id,`test_${id.slice(0,16)}`,`${id}@example.invalid`]);
      const fixtures=recordingIds.map((id,i)=>({id,metadata:{title:`Fixture ${i}`,artists:[`Fixture Artist ${i%20}`],durationMs:180000,
        artistReference:{provider:"deezer",id:`fixture-${prefix}-artist-${i%20}`},albumReference:{provider:"deezer",id:`fixture-${prefix}-album-${i%20}`},
        albumTitle:`Fixture Album ${i%20}`,coverUrl:"https://e-cdns-images.dzcdn.net/images/cover/fixture/500x500-000000-80-0-0.jpg",
        artistImageUrl:"https://e-cdns-images.dzcdn.net/images/artist/fixture/500x500-000000-80-0-0.jpg",genres:[i%2?"pop":"afrobeats"],popularity:i/100}}));
      await client.query(`INSERT INTO sakura_v2."Recording"(id,metadata,state) SELECT id::uuid,metadata,'verified'
        FROM jsonb_to_recordset($1::jsonb) x(id text,metadata jsonb)`,[JSON.stringify(fixtures)]);
      await client.query(`INSERT INTO sakura_v2."ExternalReference"(provider,external_id,recording_id,verified_at)
        SELECT 'deezer','fixture-'||$2||'-'||x.position,x.id,now() FROM unnest($1::uuid[]) WITH ORDINALITY x(id,position)`,[recordingIds,prefix]);
      await syncCatalog(client);
    });
  });
  after(async()=>{
    await inTransaction(async client=>{
      for(const table of ["UserDownload","AudioResolveJob","Share","ArchivedListeningRecording","ListeningImportSnapshot","LifetimeListeningSummary"])
        await client.query(`DELETE FROM sakura_v2."${table}" WHERE account_id=ANY($1::uuid[])`,[[first,second]]);
      await client.query(`DELETE FROM sakura_v2."AudioAsset" WHERE recording_id=ANY($1::uuid[])`,[recordingIds]);
      await client.query(`DELETE FROM public."User" WHERE id=ANY($1::uuid[])`,[[first,second]]);
      await client.query(`DELETE FROM sakura_v2."ExternalReference" WHERE recording_id=ANY($1::uuid[])`,[recordingIds]);
      await client.query(`DELETE FROM sakura_v2."Recording" WHERE id=ANY($1::uuid[])`,[recordingIds]);
      await client.query(`DELETE FROM sakura_v2."Album" WHERE external_id LIKE $1`,[`fixture-${prefix}-%`]);
      await client.query(`DELETE FROM sakura_v2."Artist" WHERE external_id LIKE $1`,[`fixture-${prefix}-%`]);
    });
    await actualPool.query(`DROP SCHEMA "${testSchema}" CASCADE`);
    await pool.end();
  });
  it("validates cursor, settings and incremental audible contracts",()=>{
    assert.throws(()=>pageInput(new URL("http://localhost/api?cursor=invalid")),ProductError);
    assert.throws(()=>preferencesPatch({theme:"banana"}),ProductError);
    assert.throws(()=>preferencesPatch({crossfadeSeconds:12}),ProductError);
    assert.throws(()=>historyChunk({...input(0,1),msPlayed:120001}),ProductError);
    assert.throws(()=>historyChunk({...input(0,1),completed:true,skipped:true}),ProductError);
    assert.deepEqual(entityReference("spotify:2lEl1iNGpz9r2B7R5BqXSD"),{provider:"spotify",id:"2lEl1iNGpz9r2B7R5BqXSD"});
    assert.equal(entityReference("spotify:invalid"),null);
  });
  it("persists preferences independently and scopes them to the account",async()=>{
    const initial=await getSettings(first);assert.equal(initial.theme,"system");assert.equal(initial.onboarded,false);
    await patchSettings(first,{theme:"dark",seedArtists:["Fixture Artist 0"],seedGenres:["afrobeats"],onboarded:true});
    await patchSettings(first,{reducedMotion:true});
    const updated=await getSettings(first);assert.equal(updated.theme,"dark");assert.equal(updated.reducedMotion,true);assert.equal(updated.onboarded,true);
    assert.equal((await getSettings(second)).theme,"system");
  });
  it("uses canonical favorite identity and stable cursor pagination",async()=>{
    for(const id of recordingIds.slice(0,3))await setFavorite(first,{recordingId:id,liked:true});
    await setFavorite(first,{recordingId:recordingIds[0],liked:true});
    const result:string[]=[];let cursor:string|null=null;
    do{
      const url=new URL("http://localhost/api?limit=1");if(cursor)url.searchParams.set("cursor",cursor);
      const page=await getLibrary(first,url);result.push(...page.recordings.map(r=>r.recordingId));cursor=page.nextCursor;
    }while(cursor);
    assert.equal(result.length,3);assert.equal(new Set(result).size,3);
    assert.equal((await getLibrary(second,new URL("http://localhost/api"))).recordings.length,0);
  });
  it("keeps playlist membership unique, ordered and owner scoped",async()=>{
    const playlist=await createPlaylist(first,{name:"Fixture collection"});
    await mutatePlaylistTracks(first,playlist.id,{recordingIds:recordingIds.slice(0,3)});
    await mutatePlaylistTracks(first,playlist.id,{recordingIds:[recordingIds[0]]});
    const loaded=await getPlaylist(first,playlist.id);assert.equal(loaded.trackCount,3);
    await assert.rejects(getPlaylist(second,playlist.id),e=>e instanceof ProductError&&e.status===404);
    await assert.rejects(mutatePlaylistTracks(second,playlist.id,{recordingIds:[recordingIds[3]]}),e=>e instanceof ProductError&&e.status===404);
    const reordered=await updatePlaylist(first,playlist.id,{recordingIds:recordingIds.slice(0,3).reverse()});
    assert.deepEqual(reordered.recordings.map((r:{recordingId:string})=>r.recordingId),recordingIds.slice(0,3).reverse());
    await mutatePlaylistTracks(first,playlist.id,{recordingId:recordingIds[1]},true);
    assert.equal((await getPlaylist(first,playlist.id)).trackCount,2);
    await assert.rejects(updatePlaylist(first,playlist.id,{recordingIds:[recordingIds[0]]}),e=>e instanceof ProductError&&e.status===409);
    await deletePlaylist(first,playlist.id);
  });
  it("commits concurrent retries once and accepts delayed earlier increments",async()=>{
    const duplicate=await Promise.all([recordHistory(first,input(2,15000)),recordHistory(first,input(2,15000))]);
    assert.equal(duplicate.filter(r=>"duplicate" in r&&r.duplicate).length,1);
    await recordHistory(first,input(0,10000));
    await recordHistory(first,input(1,5000,{completed:true,finished:true}));
    const profile=await getProfile(first);assert.equal(profile.profile.id,first);assert.equal(profile.stats.audibleMs,30000);
    assert.equal(profile.stats.playCount,1);assert.equal(profile.stats.completedCount,1);
    await assert.rejects(recordHistory(first,input(2,16000)),e=>e instanceof ProductError&&e.status===409);
    await assert.rejects(recordHistory(first,{...input(3,1000),recordingId:recordingIds[1]}),e=>e instanceof ProductError&&e.status===409);
    assert.equal((await getProfile(first)).stats.audibleMs,30000);
    assert.equal((await getProfile(second)).stats.audibleMs,0);
  });
  it("compacts raw display history without replaying accumulated time",async()=>{
    const before=await getHistory(first,new URL("http://localhost/api"));assert.equal(before.events.length,1);
    const compact=await compactHistory(first,new Date(Date.now()+10000));assert.equal(compact.compacted,1);
    assert.equal((await getHistory(first,new URL("http://localhost/api"))).events.length,0);
    const retry=await recordHistory(first,input(2,15000));assert.equal("duplicate" in retry&&retry.duplicate,true);
    assert.equal((await getProfile(first)).stats.audibleMs,30000);
  });
  it("does not record private-session playback",async()=>{
    await patchSettings(first,{privateSession:true});
    const result=await recordHistory(first,{...input(0,15000),eventId:events[1]});
    assert.equal("privateSession" in result&&result.privateSession,true);
    assert.equal((await getProfile(first)).stats.audibleMs,30000);
    await patchSettings(first,{privateSession:false});
  });
  it("shares exact artist and album artwork across cards and detail pages",async()=>{
    const [track]=await cardsForIds(first,[recordingIds[0]]);assert.ok(track.artistId);assert.ok(track.albumId);
    const artist=await getArtist(first,track.artistId),album=await getAlbum(first,track.albumId);
    assert.equal(artist.imageUrl,track.artistImageUrl);assert.equal(album.coverUrl,track.coverUrl);
    assert.ok(artist.recordings.some((r:{recordingId:string})=>r.recordingId===track.recordingId));assert.ok(album.recordings.some((r:{recordingId:string})=>r.recordingId===track.recordingId));
  });
  it("persists distinct mixes, keeps stable day identity, and exposes unresolved cards for direct Play",async()=>{
    const mixes=await ensureMixes(first,true),again=await ensureMixes(first);
    assert.deepEqual(again.map(m=>m.id),mixes.map(m=>m.id));
    const ready=mixes.filter(m=>m.status==="ready");assert.ok(ready.length>=2);
    const loaded=await Promise.all(ready.map(m=>getMix(first,m.id)));
    assert.equal(mixes.length,SITUATIONAL_MIXES.length);
    for(const mix of loaded){assert.equal(mix.playability,"resolvable");assert.ok(mix.recordings.length>=(SITUATIONAL_MIXES.find(s=>s.id===mix.slot)!.minimum));assert.equal(new Set(mix.recordings.map((r:{recordingId:string})=>r.recordingId)).size,mix.recordings.length);}
    for(let i=0;i<loaded.length;i++)for(let j=i+1;j<loaded.length;j++){
      const left=new Set(loaded[i].recordings.map((r:{recordingId:string})=>r.recordingId)),right=loaded[j].recordings;
      const overlap=right.filter((r:{recordingId:string})=>left.has(r.recordingId)).length/Math.min(left.size,right.length);assert.ok(overlap<=0.2);
    }
    await assert.rejects(getMix(second,ready[0].id),e=>e instanceof ProductError&&e.status===404);
  });
  it("offline mixes contain only the device's supplied canonical IDs",async()=>{
    const supplied=recordingIds.slice(20,65),allowed=new Set<string>(supplied),result=await offlineMixes(first,{recordingIds:supplied});
    assert.ok(result.mixes.some(m=>m.status==="ready"));
    for(const mix of result.mixes)assert.ok(mix.recordingIds.every(id=>allowed.has(id)));
    assert.ok(result.recordings.every(c=>allowed.has(c.id)));
  });
  it("attributes delayed offline listening correctly and persists sequential Bloom reveals",async()=>{
    const now=new Date("2026-11-07T12:00:00Z"),[previous,current]=bloomWindows("weekly",now);
    const occurredAt=new Date(new Date(previous.periodStart).getTime()+86400000).toISOString();
    const chunk={...input(0,60000),eventId:events[3],occurredAt};
    await recordHistory(first,chunk);await recordHistory(first,chunk);
    const list=await listBloom(second,"weekly",now);assert.equal(list.items[0].status,"empty");assert.equal(list.items[1].status,"locked");
    await assert.rejects(getBloom(first,current.id,now),e=>e instanceof ProductError&&e.status===423);
    let recap=await getBloom(first,previous.id,now);
    assert.equal(recap.summary.audibleMs,60000);assert.equal(recap.summary.playCount,1);assert.equal(recap.summary.activeDays,1);
    assert.ok(recap.chapterCount>=6);assert.ok(recap.chapters.every(c=>c.stat===null&&c.relatedRecording===null));
    await assert.rejects(revealBloom(first,previous.id,recap.chapters[1].id,now),e=>e instanceof ProductError&&e.status===409);
    await assert.rejects(completeBloom(first,previous.id,now),e=>e instanceof ProductError&&e.status===409);
    for(const chapter of recap.chapters)recap=await revealBloom(first,previous.id,chapter.id,now);
    assert.equal(recap.chapters[0].stat?.value,1);assert.ok(recap.chapters[1].relatedRecording);
    const completed=await completeBloom(first,previous.id,now);assert.equal(completed.completed,true);
    assert.equal((await getBloom(second,previous.id,now)).status,"empty");
    await assert.rejects(getBloom(first,previous.id,new Date(previous.expiresAt)),e=>e instanceof ProductError&&e.status===410);
    assert.deepEqual((await archivedBloom(first,null,now)).items,[]);
  });
  it("preserves exact individually linked artist credits without splitting names",async()=>{
    const reference={provider:"deezer",id:`fixture-${prefix}-artist-featured`};
    const artist=(await pool.query(`INSERT INTO sakura_v2."Artist"(provider,external_id,name) VALUES('deezer',$1,'Tyler, The Creator') RETURNING id`,[reference.id])).rows[0];
    await pool.query(`INSERT INTO sakura_v2."RecordingArtist"(recording_id,artist_id,position) VALUES($1::uuid,$2::uuid,1)`,[recordingIds[0],artist.id]);
    await pool.query(`UPDATE sakura_v2."Recording" SET metadata=metadata||$2::jsonb WHERE id=$1::uuid`,[recordingIds[0],JSON.stringify({artists:["Fixture Artist 0","Tyler, The Creator"],artistCredits:[
      {name:"Fixture Artist 0",role:"primary",reference:{provider:"deezer",id:`fixture-${prefix}-artist-0`}},{name:"Tyler, The Creator",role:"featured",reference}]})]);
    const [recording]=await cardsForIds(first,[recordingIds[0]]);assert.equal(recording.artistCredits.length,2);
    assert.equal(recording.artistCredits[1].name,"Tyler, The Creator");assert.equal(recording.artistCredits[1].artistId,artist.id);assert.equal(recording.artistCredits[1].role,"featured");
  });
  it("archives completed yearly chapters while enforcing normal recap expiry",async()=>{
    const id="yearly-2025",now=new Date("2026-11-07T12:00:00Z");
    await recordHistory(first,{...input(0,30000),eventId:events[4],occurredAt:"2025-06-15T10:00:00.000Z"});
    let recap=await getBloom(first,id,now);assert.equal(recap.summary.audibleMs,30000);
    for(const chapter of recap.chapters)recap=await revealBloom(first,id,chapter.id,now);
    await completeBloom(first,id,now);assert.equal((await archivedBloom(first,"2025",now)).items.length,0);
    const expired=new Date("2026-12-31T23:00:00.000Z");
    await assert.rejects(getBloom(first,id,expired),e=>e instanceof ProductError&&e.status===410);
    const archive=await archivedBloom(first,"2025",expired);assert.equal(archive.items.length,1);
    assert.equal(archive.items[0].status,"archived");assert.ok(archive.items[0].chapters.every(c=>c.revealed));
    assert.equal((await archivedBloom(second,"2025",expired)).items.length,0);
  });
  it("projects only public checksum-verified immutable CDN assets for the exact recording",async()=>{
    const previousCloud=process.env.CLOUDINARY_CLOUD_NAME;process.env.CLOUDINARY_CLOUD_NAME="review-cloud";
    try{
      for(let index=2;index<=7;index++){
        const id=recordingIds[index],sourceId=randomUUID(),cdnId=randomUUID(),sha256="a".repeat(64),size=3840000;
        const metadata=(await pool.query(`SELECT metadata FROM sakura_v2."Recording" WHERE id=$1::uuid`,[id])).rows[0].metadata;
        const references=[{provider:"deezer",id:`fixture-${prefix}-${index+1}`}];
        await pool.query(`INSERT INTO sakura_v2."AudioAsset"(id,recording_id,metadata,source_references,locator,audio_kind,state,mime_type,size_bytes,verified_at,sha256)
          VALUES($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,'full','ready','audio/mpeg',$6,now(),$7)`,
          [sourceId,id,JSON.stringify(metadata),JSON.stringify(references),JSON.stringify({kind:"telegram-worker",chatScope:"synthetic-review",messageId:String(index)}),size,sha256]);
        const assetMetadata=index===5?{...metadata,title:metadata.title+" (Live)",version:{kinds:["live"],labels:[]}}:metadata;
        const cloud=index===6?"another-cloud":"review-cloud",version=index===7?"":"v12/";
        const locator={kind:"https",url:`https://res.cloudinary.com/${cloud}/video/upload/${version}sakura/v2/audio/${id}/${sha256}.mp3`};
        const evidence=index===4?{}:{delivery:{method:"immutable-cdn-sha256",provider:"cloudinary",sourceAssetId:sourceId,verifiedSha256:sha256,verifiedAt:new Date().toISOString()}};
        await pool.query(`INSERT INTO sakura_v2."AudioAsset"(id,recording_id,metadata,source_references,locator,audio_kind,state,mime_type,size_bytes,verified_at,sha256,owner_account_id,evidence)
          VALUES($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,'full','ready','audio/mpeg',$6,now(),$7,$8::uuid,$9::jsonb)`,
          [cdnId,id,JSON.stringify(assetMetadata),JSON.stringify(references),JSON.stringify(locator),size,sha256,index===3?first:null,JSON.stringify(evidence)]);
        const [recording]=await cardsForIds(first,[id]);
        if(index===2){assert.equal(recording.readyPlayback?.assetId,cdnId);assert.equal(recording.readyPlayback?.sha256,sha256);assert.equal(recording.readyPlayback?.sizeBytes,size);
          assert.equal(recording.readyPlayback?.url,locator.url);assert.equal(recording.readyPlayback?.fallbackUrl,`/api/v2/recordings/${id}/audio?assetId=${cdnId}`);
        }else assert.equal(recording.readyPlayback,undefined,`Unsafe CDN case ${index} must use the verified resolver`);
      }
    }finally{if(previousCloud===undefined)delete process.env.CLOUDINARY_CLOUD_NAME;else process.env.CLOUDINARY_CLOUD_NAME=previousCloud;}
  });
});
