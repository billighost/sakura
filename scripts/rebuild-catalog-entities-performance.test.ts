import assert from "node:assert/strict";
import {after,before,describe,it} from "node:test";
import {artistEntity,albumEntity} from "../src/rebuild/data/entities";

const account="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const artistId="33333333-3333-4333-8333-333333333333",albumId="44444444-4444-4444-8444-444444444444",recordingId="55555555-5555-4555-8555-555555555555";
const runtime=globalThis as unknown as {sakuraV2ProductPool?:unknown;sakuraV2ServicesKey?:string};
const originalFetch=globalThis.fetch,originalPool=runtime.sakuraV2ProductPool;
const artists=new Map<string,Record<string,unknown>>(),albums=new Map<string,Record<string,unknown>>();
let writes=0,transactions=0,cardReads=0,title="Fixture Album";
const clone=(value:unknown)=>structuredClone(value);
function publicRow(value:Record<string,unknown>){const copy={...value};delete copy.catalogDetailSignature;return copy;}
const pool={
  async query(statement:string,parameters:unknown[]=[]):Promise<{rows:Record<string,unknown>[];rowCount:number}>{
    let rows:Record<string,unknown>[]=[];
    if(statement==="BEGIN")transactions++;
    else if(statement.startsWith("SELECT id,name")){
      const value=artists.get(parameters.length===2?`${parameters[0]}:${parameters[1]}`:"deezer:1204");if(value)rows=[clone(value) as Record<string,unknown>];
    }else if(statement.startsWith("SELECT a.id,a.title")){
      const value=albums.get(parameters.length===2?`${parameters[0]}:${parameters[1]}`:"deezer:901");if(value)rows=[clone({...value,artistName:"Fixture Artist"}) as Record<string,unknown>];
    }else if(statement.startsWith("SELECT id,title"))rows=[...albums.values()].map(value=>({id:value.id,title:value.title,coverUrl:value.coverUrl,releaseDate:value.releaseDate}));
    else if(statement.startsWith('INSERT INTO sakura_v2."Artist"')){
      writes++;const provenance=JSON.parse(String(parameters[4])),key=`${parameters[0]}:${parameters[1]}`;
      const value={...artists.get(key),id:artistId,name:parameters[2],imageUrl:parameters[3],provider:parameters[0],externalId:parameters[1],...(provenance.catalogDetailSignature?{catalogDetailSignature:provenance.catalogDetailSignature}:{})};
      artists.set(key,value);rows=[publicRow(value)];
    }else if(statement.startsWith('INSERT INTO sakura_v2."Album"')){
      writes++;
      if(statement.includes("jsonb_to_recordset")){
        for(const value of JSON.parse(String(parameters[1])))albums.set(`${value.provider}:${value.id}`,{id:albumId,title:value.title,coverUrl:value.cover,releaseDate:value.release,artistId:parameters[0],provider:value.provider,externalId:value.id});
      }else{
        const provenance=JSON.parse(String(parameters[6])),key=`${parameters[0]}:${parameters[1]}`;
        const value={id:albumId,title:parameters[2],artistId:parameters[3],coverUrl:parameters[4],releaseDate:parameters[5],provider:parameters[0],externalId:parameters[1],catalogDetailSignature:provenance.catalogDetailSignature};
        albums.set(key,value);rows=[publicRow(value)];
      }
    }else if(statement.startsWith("SELECT r.id")){
      cardReads++;
      rows=[{id:recordingId,metadata:{title:"Fixture Song",artists:["Fixture Artist"],durationMs:180000},provenance:{},references:[{provider:"deezer",id:"333"}],ready:parameters[0]===account,catalogProvider:"deezer",catalogId:"333"}];
    }
    return {rows,rowCount:rows.length};
  },
  async connect(){return {...this,release(){}};},
};
describe("Public catalog entity persistence",()=>{
  before(()=>{
    runtime.sakuraV2ProductPool=pool;runtime.sakuraV2ServicesKey=undefined;
    globalThis.fetch=(async input=>{
      const url=new URL(String(input)),track={id:333,title:"Fixture Song",duration:180,artist:{id:1204,name:"Fixture Artist"},album:{id:901,title,cover_big:"https://example.test/album.jpg"}};
      if(url.pathname==="/artist/1204")return Response.json({id:1204,name:"Fixture Artist",picture_big:"https://example.test/artist.jpg"});
      if(url.pathname==="/artist/1204/top")return Response.json({data:[track]});
      if(url.pathname==="/artist/1204/albums")return Response.json({data:[{id:901,title,cover_big:"https://example.test/album.jpg",release_date:"2026-01-01"}]});
      if(url.pathname==="/album/901")return Response.json({id:901,title,cover_big:"https://example.test/album.jpg",artist:{id:1204,name:"Fixture Artist"},release_date:"2026-01-01",tracks:{data:[track]}});
      return Response.json({error:"Fixture transport only"},{status:503});
    }) as typeof fetch;
  });
  after(()=>{globalThis.fetch=originalFetch;runtime.sakuraV2ProductPool=originalPool;runtime.sakuraV2ServicesKey=undefined;});
  it("skips identical artist/album writes while keeping account playback projections fresh",async()=>{
    const first=await artistEntity(account,"1204"),beforeWrites=writes,beforeTransactions=transactions,beforeCards=cardReads;
    const second=await artistEntity(other,"1204");
    assert.equal(writes,beforeWrites);assert.equal(transactions,beforeTransactions);assert.ok(cardReads>beforeCards);
    assert.equal(first.recordings[0].id,recordingId);assert.equal(first.recordings[0].playability,"ready");assert.equal(second.recordings[0].playability,"resolvable");
    assert.equal(second.albums.length,1);assert.equal("catalogDetailSignature" in second,false);
  });
  it("skips identical album persistence and still reconciles changed public details",async()=>{
    await albumEntity(account,"901");const beforeWrites=writes,beforeTransactions=transactions;
    const second=await albumEntity(other,"901");
    assert.equal(writes,beforeWrites);assert.equal(transactions,beforeTransactions);assert.equal(second.recordings[0].playability,"resolvable");
    assert.equal("catalogDetailSignature" in second,false);
    title="Updated Fixture Album";runtime.sakuraV2ServicesKey=undefined;
    const changed=await albumEntity(account,"901");assert.equal(changed.title,title);assert.ok(writes>beforeWrites);
  });
});
