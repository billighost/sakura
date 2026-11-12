import { getRebuildServices } from "../server/runtime";
import { CARD_SELECT,VERIFIED,card,type RecordingCard } from "./catalog";
import { getRebuildPool,inTransaction } from "./db";
import { ProductError,uuid } from "./validation";
import type { CatalogRecording } from "../server/contracts";
import {createHash} from "node:crypto";

export function entityReference(raw:string):{provider:"deezer"|"spotify";id:string}|null {
  const spotify=/^spotify:([a-zA-Z0-9]{22})$/.exec(raw);
  if(spotify)return {provider:"spotify",id:spotify[1]};
  const match=/^(?:deezer:)?([1-9]\d{0,17})$/.exec(raw);
  return match?{provider:"deezer",id:match[1]}:null;
}
async function catalogCards(accountId:string,catalog:readonly CatalogRecording[]) {
  const selected=catalog.filter(t=>t.reference.provider==="deezer"||t.reference.provider==="spotify").map(t=>t.reference);
  const rows=selected.length?(await getRebuildPool().query(`${CARD_SELECT.replace('FROM sakura_v2."Recording" r',`,requested.provider AS "catalogProvider",requested.external_id AS "catalogId" FROM sakura_v2."Recording" r`)}
    JOIN sakura_v2."ExternalReference" requested ON requested.recording_id=r.id AND requested.verified_at IS NOT NULL
    JOIN jsonb_to_recordset($2::jsonb) selected(provider text,id text) ON selected.provider=requested.provider AND selected.id=requested.external_id
    WHERE ${VERIFIED}`,[accountId,JSON.stringify(selected)])).rows:[];
  const indexed=new Map<string,RecordingCard>(rows.map(r=>[`${r.catalogProvider}:${r.catalogId}`,card(r)])),seen=new Set<string>();
  return catalog.flatMap(t=>{
    const canonical=indexed.get(`${t.reference.provider}:${t.reference.id}`);
    const track=canonical||{...t,id:`${t.reference.provider}:${t.reference.id}`,artistId:t.artistReference?`${t.artistReference.provider}:${t.artistReference.id}`:null,
      albumId:t.albumReference?`${t.albumReference.provider}:${t.albumReference.id}`:null,playability:"resolvable"};
    if(seen.has(track.id))return [];seen.add(track.id);return [track];
  });
}

export async function artistEntity(accountId:string,rawId:string) {
  const reference=entityReference(rawId),pool=getRebuildPool();
  const existing=(await pool.query(`SELECT id,name,image_url AS "imageUrl",provider,external_id AS "externalId",provenance->>'catalogDetailSignature' AS "catalogDetailSignature" FROM sakura_v2."Artist"
    WHERE ${reference?"provider=$1 AND external_id=$2":"id=$1::uuid"}`,[...(reference?[reference.provider,reference.id]:[uuid(rawId,"artist ID")])])).rows[0];
  if(!existing&&!reference)throw new ProductError(404,"Artist not found");
  const provider=reference?.provider||existing?.provider;
  const providerId=reference?.id||existing?.externalId;
  const detailId=provider==="spotify"?`spotify:${providerId}`:providerId;
  let detail:Awaited<ReturnType<ReturnType<typeof getRebuildServices>["catalog"]["detail"]>>|null=null;
  if(providerId&&["deezer","spotify"].includes(provider))try{detail=await getRebuildServices().catalog.detail("artist",detailId);}catch{if(!existing)throw new ProductError(503,"Artist catalog is temporarily unavailable");}
  const savedSignature=existing?.catalogDetailSignature;if(existing)delete existing.catalogDetailSignature;
  const detailSignature=detail?createHash("sha256").update(JSON.stringify(detail)).digest("hex"):undefined;
  let artist=existing;
  // Public provider metadata is still read in full. Only identical persistence
  // work is skipped; account-specific playback cards remain fresh on every read.
  if(detail&&(!existing||savedSignature!==detailSignature)){
    artist=await inTransaction(async client=>{
      const result=(await client.query(`INSERT INTO sakura_v2."Artist"(provider,external_id,name,image_url,provenance)
        VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(provider,external_id) DO UPDATE SET
        name=EXCLUDED.name,image_url=COALESCE(EXCLUDED.image_url,sakura_v2."Artist".image_url),provenance=sakura_v2."Artist".provenance||EXCLUDED.provenance,updated_at=now()
        RETURNING id,name,image_url AS "imageUrl",provider,external_id AS "externalId"`,[provider,providerId,detail!.name,detail!.imageUrl||null,JSON.stringify({catalog:detail!.reference,catalogDetailSignature:detailSignature})])).rows[0];
      const albums=[...new Map(detail!.albums.map(album=>[`${album.reference.provider}:${album.reference.id}`,{provider:album.reference.provider,id:album.reference.id,title:album.title,cover:album.coverUrl||null,release:album.releaseDate||null}])).values()];
      if(albums.length)await client.query(`INSERT INTO sakura_v2."Album"(provider,external_id,title,artist_id,cover_url,release_date,provenance)
        SELECT x.provider,x.id,x.title,$1::uuid,x.cover,x.release,jsonb_build_object('catalog',jsonb_build_object('provider',x.provider,'id',x.id))
        FROM jsonb_to_recordset($2::jsonb) x(provider text,id text,title text,cover text,release text) ON CONFLICT(provider,external_id) DO UPDATE SET
        title=EXCLUDED.title,cover_url=COALESCE(EXCLUDED.cover_url,sakura_v2."Album".cover_url),release_date=COALESCE(EXCLUDED.release_date,sakura_v2."Album".release_date)`,
        [result.id,JSON.stringify(albums)]);
      return result;
    });
  }
  if(!artist)throw new ProductError(404,"Artist not found");
  const albums=(await pool.query(`SELECT id,title,cover_url AS "coverUrl",release_date AS "releaseDate" FROM sakura_v2."Album" WHERE artist_id=$1::uuid ORDER BY release_date DESC NULLS LAST,title LIMIT 50`,[artist.id])).rows;
  const indexed=(await pool.query(`${CARD_SELECT} JOIN sakura_v2."RecordingArtist" ra ON ra.recording_id=r.id WHERE ra.artist_id=$2::uuid AND ${VERIFIED}
    ORDER BY COALESCE((r.metadata->>'popularity')::numeric,0.5) DESC,r.id LIMIT 100`,[accountId,artist.id])).rows.map(card);
  const remote=detail?await catalogCards(accountId,detail.tracks):[];
  const seen=new Set(remote.map(t=>t.id));
  const recordings=[...remote,...indexed.filter(t=>!seen.has(t.id))];
  return {...artist,recordings,tracks:recordings,albums};
}

export async function albumEntity(accountId:string,rawId:string) {
  const reference=entityReference(rawId),pool=getRebuildPool();
  let album=(await pool.query(`SELECT a.id,a.title,a.cover_url AS "coverUrl",a.artist_id AS "artistId",ar.name AS "artistName",a.release_date AS "releaseDate",a.provider,a.external_id AS "externalId",a.provenance->>'catalogDetailSignature' AS "catalogDetailSignature"
    FROM sakura_v2."Album" a LEFT JOIN sakura_v2."Artist" ar ON ar.id=a.artist_id WHERE ${reference?"a.provider=$1 AND a.external_id=$2":"a.id=$1::uuid"}`,[...(reference?[reference.provider,reference.id]:[uuid(rawId,"album ID")])])).rows[0];
  if(!album&&!reference)throw new ProductError(404,"Album not found");
  const provider=reference?.provider||album?.provider;
  const providerId=reference?.id||album?.externalId;
  const detailId=provider==="spotify"?`spotify:${providerId}`:providerId;
  let detail:Awaited<ReturnType<ReturnType<typeof getRebuildServices>["catalog"]["detail"]>>|null=null;
  if(providerId&&["deezer","spotify"].includes(provider))try{detail=await getRebuildServices().catalog.detail("album",detailId);}catch{if(!album)throw new ProductError(503,"Album catalog is temporarily unavailable");}
  const savedSignature=album?.catalogDetailSignature;if(album)delete album.catalogDetailSignature;
  const detailSignature=detail?createHash("sha256").update(JSON.stringify(detail)).digest("hex"):undefined;
  if(detail&&(!album||savedSignature!==detailSignature)){
    const entity=detail;
    album=await inTransaction(async client=>{
      let artistId=album?.artistId||null;
      if(entity.artistReference&&entity.artist){
        const artist=(await client.query(`INSERT INTO sakura_v2."Artist"(provider,external_id,name,image_url,provenance) VALUES($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT(provider,external_id) DO UPDATE SET name=EXCLUDED.name,image_url=COALESCE(EXCLUDED.image_url,sakura_v2."Artist".image_url) RETURNING id`,
          [entity.artistReference.provider,entity.artistReference.id,entity.artist,entity.tracks[0]?.artistImageUrl||null,JSON.stringify({catalog:entity.artistReference})])).rows[0];artistId=artist.id;
      }
      const row=(await client.query(`INSERT INTO sakura_v2."Album"(provider,external_id,title,artist_id,cover_url,release_date,provenance)
        VALUES($1,$2,$3,$4::uuid,$5,$6,$7::jsonb) ON CONFLICT(provider,external_id) DO UPDATE SET
        title=EXCLUDED.title,cover_url=COALESCE(EXCLUDED.cover_url,sakura_v2."Album".cover_url),release_date=COALESCE(EXCLUDED.release_date,sakura_v2."Album".release_date),provenance=sakura_v2."Album".provenance||EXCLUDED.provenance
        RETURNING id,title,cover_url AS "coverUrl",artist_id AS "artistId",release_date AS "releaseDate"`,[provider,providerId,entity.title,artistId,entity.coverUrl||null,entity.releaseDate||null,JSON.stringify({catalog:entity.reference,genres:entity.genres,catalogDetailSignature:detailSignature})])).rows[0];
      return {...row,artistName:entity.artist||album?.artistName||null};
    });
  }
  if(!album)throw new ProductError(404,"Album not found");
  const recordings=detail?await catalogCards(accountId,detail.tracks):(await pool.query(`${CARD_SELECT} JOIN sakura_v2."RecordingAlbum" ra ON ra.recording_id=r.id WHERE ra.album_id=$2::uuid AND ${VERIFIED}
    ORDER BY ra.position,r.created_at,r.id LIMIT 200`,[accountId,album.id])).rows.map(card);
  return {...album,recordings,tracks:recordings,durationMs:recordings.reduce((sum,t)=>sum+(("durationMs" in t?t.durationMs:t.metadata.durationMs)||0),0)};
}
