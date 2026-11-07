import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getRebuildPool,inTransaction } from "../src/rebuild/data/db";

const base=process.env.SAKURA_TEST_ORIGIN||"http://localhost:3000";
const accounts:string[]=[];
let lastRequest="",lastStatus=0;
class Session {
  cookies=new Map<string,string>();
  async request(path:string,options:RequestInit={}) {
    const headers=new Headers(options.headers);headers.set("Cookie",[...this.cookies].map(([name,value])=>`${name}=${value}`).join(";"));
    if(!headers.has("Origin"))headers.set("Origin",base);
    const response=await fetch(base+path,{...options,headers,redirect:"manual",signal:AbortSignal.timeout(90000)});
    lastRequest=path;lastStatus=response.status;
    for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(";"),index=pair.indexOf("=");this.cookies.set(pair.slice(0,index),pair.slice(index+1));}
    return response;
  }
  async json(path:string,method="GET",body?:unknown){const response=await this.request(path,{method,...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});return {response,data:await response.json()};}
}
async function signUp(){
  const session=new Session(),nonce=randomUUID().replaceAll("-","").slice(0,16),identifier="api_"+nonce,password=randomUUID()+"Aa!9";
  const registration=await session.json("/api/auth/register","POST",{username:identifier,email:identifier+"@example.invalid",password});
  assert.equal(registration.response.status,201,"Fresh registration should succeed");accounts.push(registration.data.user.id);
  const csrf=await session.json("/api/auth/csrf");
  const response=await session.request("/api/auth/callback/credentials",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","X-Auth-Return-Redirect":"1"},
    body:new URLSearchParams({csrfToken:csrf.data.csrfToken,identifier,password,callbackUrl:base+"/home"})});
  assert.ok(response.status===200||response.status===302,"Credentials sign-in should succeed");await response.body?.cancel();
  return session;
}
async function main(){
  try{
    if(process.argv.includes("--bloom-only")){
      const first=await signUp(),second=await signUp();
      assert.equal((await new Session().json("/api/v2/bloom")).response.status,401);
      const preference=await first.json("/api/v2/settings","PATCH",{seedArtistSelections:[{name:"YOASOBI",reference:{provider:"deezer",id:"108153772"}}],onboarded:true,timeZone:"Africa/Lagos"});
      assert.equal(preference.response.status,200);assert.equal(preference.data.onboarded,true);assert.equal(preference.data.seedArtistSelections[0].selectionKey,"artist:deezer:108153772");
      const saved=await first.json("/api/v2/settings");assert.equal(saved.data.seedArtistSelections.length,1);assert.equal((await second.json("/api/v2/settings")).data.seedArtistSelections.length,0);
      const listing=await first.json("/api/v2/bloom?period=weekly");assert.equal(listing.response.status,200);assert.equal(listing.data.schedule.timeZone,"Africa/Lagos");
      const locked=listing.data.items.find((item:{status:string})=>item.status==="locked");assert.ok(locked);
      assert.equal((await first.json("/api/v2/bloom/"+locked.id)).response.status,423);
      const monthly=await first.json("/api/v2/bloom?period=monthly");const empty=monthly.data.items.find((item:{status:string})=>item.status==="empty");assert.ok(empty);
      const recap=await first.json("/api/v2/bloom/"+empty.id);assert.equal(recap.response.status,200);assert.equal(recap.data.summary.audibleMs,0);assert.deepEqual(recap.data.chapters,[]);
      assert.equal((await first.json("/api/v2/bloom/"+empty.id+"/complete","POST",{})).response.status,409);
      assert.deepEqual((await first.json("/api/v2/bloom/archive")).data.items,[]);
      const ids=(await getRebuildPool().query(`SELECT id FROM sakura_v2."Recording" WHERE state='verified' ORDER BY id LIMIT 32`)).rows.map(r=>r.id),allowed=new Set(ids);
      const detail=await first.json("/api/v2/recordings/"+ids[0]);assert.equal(detail.response.status,200);assert.equal(detail.data.recordingId,ids[0]);assert.ok(Array.isArray(detail.data.artistCredits));assert.ok(Array.isArray(detail.data.genres));
      if(detail.data.artistCredits.length)assert.ok(detail.data.artistCredits[0].artistId||detail.data.artistCredits[0].reference);
      const offline=await first.json("/api/v2/mixes/offline","POST",{recordingIds:ids});assert.equal(offline.response.status,200);
      assert.ok(offline.data.mixes.every((m:{recordingIds:string[]})=>m.recordingIds.every(id=>allowed.has(id))));
      assert.equal((await first.json("/api/v2/library","POST",{recordingId:ids[0],liked:true})).response.status,200);
      const library=await first.json("/api/v2/library");assert.ok(library.data.recordings.some((r:{id:string})=>r.id===ids[0]));
      const artists=await first.json("/api/v2/artists");assert.equal(artists.response.status,200);
      const names=artists.data.artists.map((a:{name:string})=>a.name.normalize("NFKC").trim().toLowerCase());assert.equal(new Set(names).size,names.length);
      console.log(JSON.stringify({status:"passed",checks:17,bloomServerAvailability:true,emptyRecapsTruthful:true,exactOnboardingSaved:true,accountIsolation:true,canonicalFavoriteSaved:true,offlineStrictSubset:true,artistChoicesGrouped:true,recordingDetailCredits:true}));
      return;
    }
    if(process.argv.includes("--providers-only")){
      const first=await signUp();
      const preference=await first.json("/api/v2/settings","PATCH",{theme:"dark"});assert.equal(preference.response.status,200,"A real browser Origin should be accepted");
      const foreign=await first.request("/api/v2/settings",{method:"PATCH",headers:{"Content-Type":"application/json",Origin:"https://example.invalid"},body:JSON.stringify({theme:"light"})});assert.equal(foreign.status,403);await foreign.body?.cancel();
      const search=await first.json("/api/v2/search?q=Bruno%20Mars");assert.equal(search.response.status,200);
      const artist=await first.json("/api/v2/artists/"+encodeURIComponent(search.data.artists[0].id));assert.equal(artist.response.status,200);assert.ok(artist.data.recordings.length>0);
      const album=await first.json("/api/v2/albums/"+encodeURIComponent(search.data.albums[0].id));assert.equal(album.response.status,200);assert.ok(album.data.recordings.length>0);
      const spotifyNavigation=await checkSpotify(first);assert.equal(spotifyNavigation,true,"Configured Spotify coverage is required for the original Ye check");
      console.log(JSON.stringify({status:"passed",checks:8,realBrowserOrigin:true,foreignOriginRejected:true,providerEntityNavigation:true,spotifyNavigation:true,fixtureCleanup:"required"}));
      return;
    }
    const first=await signUp(),second=await signUp();
    const anonymous=await new Session().json("/api/v2/profile");assert.equal(anonymous.response.status,401);
    const profile=await first.json("/api/v2/profile");assert.equal(profile.response.status,200);assert.ok(profile.data.profile.id);assert.equal(profile.data.stats.audibleMs,0);
    const updated=await first.json("/api/v2/settings","PATCH",{theme:"dark",reducedMotion:true});assert.equal(updated.response.status,200);assert.equal(updated.data.theme,"dark");
    const otherSettings=await second.json("/api/v2/settings");assert.equal(otherSettings.data.theme,"system");
    const origin=await first.request("/api/v2/settings",{method:"PATCH",headers:{"Content-Type":"application/json",Origin:"https://example.invalid"},body:JSON.stringify({theme:"light"})});assert.equal(origin.status,403);await origin.body?.cancel();
    const home=await first.json("/api/v2/home");assert.equal(home.response.status,200);assert.ok(home.data.featured.length>0,"Fresh verified online catalog should appear on Home");
    const recordingId=home.data.featured[0].recordingId;
    const liked=await first.json("/api/v2/library","POST",{recordingId,liked:true});assert.equal(liked.response.status,200);assert.equal(liked.data.liked,true);
    assert.equal((await first.json("/api/v2/library")).data.recordings.length,1);assert.equal((await second.json("/api/v2/library")).data.recordings.length,0);
    const playlist=await first.json("/api/v2/playlists","POST",{name:"API test playlist"});assert.equal(playlist.response.status,200);
    assert.equal((await first.json(`/api/v2/playlists/${playlist.data.id}/tracks`,"POST",{recordingIds:[recordingId]})).response.status,200);
    assert.equal((await second.json(`/api/v2/playlists/${playlist.data.id}`)).response.status,404);
    const eventId=randomUUID(),chunk={eventId,recordingId,sequence:0,msPlayed:5000,positionMs:5000,completed:false,context:"test",finished:true};
    assert.equal((await first.json("/api/v2/history","POST",chunk)).response.status,200);
    assert.equal((await first.json("/api/v2/history","POST",chunk)).data.duplicate,true);
    const totals=await first.json("/api/v2/profile");assert.equal(totals.data.stats.audibleMs,5000);assert.equal(totals.data.stats.playCount,1);
    const mix=home.data.mixes.find((m:{status:string})=>m.status==="ready");assert.ok(mix);
    const mixResult=await first.json("/api/v2/mixes/"+mix.id);assert.equal(mixResult.response.status,200);assert.ok(mixResult.data.recordings.length>0);assert.equal(mixResult.data.playability,"resolvable");
    assert.equal((await second.json("/api/v2/mixes/"+mix.id)).response.status,404);
    const search=await first.json("/api/v2/search?q=Bruno%20Mars");assert.equal(search.response.status,200);
    assert.ok(search.data.artists[0].id.startsWith("deezer:"));
    const artist=await first.json("/api/v2/artists/"+encodeURIComponent(search.data.artists[0].id));assert.equal(artist.response.status,200);assert.ok(artist.data.recordings.length>0);assert.ok(artist.data.imageUrl);
    assert.ok(search.data.albums[0].id.startsWith("deezer:"));
    const album=await first.json("/api/v2/albums/"+encodeURIComponent(search.data.albums[0].id));assert.equal(album.response.status,200);assert.ok(album.data.recordings.length>0);assert.ok(album.data.coverUrl);
    const spotifyNavigation=await checkSpotify(first);
    console.log(JSON.stringify({status:"passed",checks:spotifyNavigation?23:19,realAuthentication:true,accountIsolation:true,actualAudibleTime:true,providerEntityNavigation:true,spotifyNavigation,fixtureCleanup:"required"}));
  }finally{
    if(accounts.length)await inTransaction(async client=>{
      for(const table of ["UserDownload","AudioResolveJob","Share","ArchivedListeningRecording","ListeningImportSnapshot","LifetimeListeningSummary"])
        await client.query(`DELETE FROM sakura_v2."${table}" WHERE account_id=ANY($1::uuid[])`,[accounts]);
      await client.query(`DELETE FROM public."User" WHERE id=ANY($1::uuid[])`,[accounts]);
    });
    console.log(JSON.stringify({syntheticAccountsRemoved:accounts.length}));await getRebuildPool().end();
  }
}
async function checkSpotify(first:Session):Promise<boolean>{
  if(!process.env.SPOTIFY_CLIENT_ID||!process.env.SPOTIFY_CLIENT_SECRET)return false;
  const ye=await first.json('/api/v2/search?q='+encodeURIComponent('track:Ye artist:"Burna Boy"'));assert.equal(ye.response.status,200);
  const original=ye.data.tracks.find((t:{reference:{provider:string};metadata:{title:string;artists:string[]}})=>t.reference.provider==="spotify"&&t.metadata.title==="Ye"&&t.metadata.artists.includes("Burna Boy"));
  assert.ok(original,"Original Ye should be available from the configured Spotify catalog");
  const indexed=await first.json("/api/v2/recordings/index","POST",{reference:original.reference});assert.equal(indexed.response.status,200);
  const voice=await first.json("/api/v2/artists/spotify:"+original.artistReference.id);assert.equal(voice.response.status,200);assert.equal(voice.data.provider,"spotify");assert.ok(voice.data.recordings.length>0);assert.ok(voice.data.imageUrl);
  const record=await first.json("/api/v2/albums/spotify:"+original.albumReference.id);assert.equal(record.response.status,200);assert.ok(record.data.recordings.length>0);assert.ok(record.data.coverUrl);
  return true;
}
void main().catch(error=>{console.error(JSON.stringify({status:"failed",name:error instanceof Error?error.name:"UnknownError",path:lastRequest,httpStatus:lastStatus,
  message:error instanceof Error?error.message:"HTTP check failed",code:(error as {cause?:{code?:string}})?.cause?.code||null}));process.exitCode=1;});
