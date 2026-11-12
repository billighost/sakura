import { getRebuildPool,inTransaction,inIdempotentTransaction } from "./db";
import { CARD_SELECT,VERIFIED,card,cardsForIds } from "./catalog";
import { ProductError,encodeCursor,ids,integer,object,pageInput,text,uuid } from "./validation";
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";

export async function listPlaylists(accountId:string,sql:Pick<PoolClient,"query">=getRebuildPool()) {
  const rows=await sql.query(`SELECT p.id,p.name,p.description,p.cover_url AS "coverUrl",p.revision,
    p.created_at AS "createdAt",p.updated_at AS "updatedAt",COUNT(pr.recording_id)::integer AS "trackCount",
    (SELECT array_agg(art."coverUrl" ORDER BY art."firstPosition") FROM (
      SELECT r.metadata->>'coverUrl' AS "coverUrl",MIN(x.position) AS "firstPosition"
      FROM sakura_v2."PlaylistRecording" x JOIN sakura_v2."Recording" r ON r.id=x.recording_id
      WHERE x.playlist_id=p.id AND NULLIF(r.metadata->>'coverUrl','') IS NOT NULL
      GROUP BY r.metadata->>'coverUrl' ORDER BY MIN(x.position) LIMIT 4
    ) art) AS "trackCoverUrls"
    FROM sakura_v2."Playlist" p LEFT JOIN sakura_v2."PlaylistRecording" pr ON pr.playlist_id=p.id
    WHERE p.account_id=$1::uuid GROUP BY p.id ORDER BY p.updated_at DESC,p.id LIMIT 200`,[accountId]);
  return rows.rows.map(p=>{
    const coverUrls=[p.coverUrl,...(Array.isArray(p.trackCoverUrls)?p.trackCoverUrls:[])].filter((url,index,all)=>typeof url==="string"&&url&&all.indexOf(url)===index).slice(0,4);
    const {trackCoverUrls:_,...playlist}=p;void _;
    return {...playlist,hasCustomCover:Boolean(p.coverUrl),revision:Number(p.revision),coverUrl:coverUrls[0]||null,coverUrls};
  });
}
export async function getFavoriteStates(accountId:string,sql:Pick<PoolClient,"query">=getRebuildPool()):Promise<Record<string,{liked:boolean;revision:number}>> {
  const result=await sql.query(`SELECT c.recording_id,c.revision,
    EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=c.account_id AND f.recording_id=c.recording_id) AS liked
    FROM sakura_v2."FavoriteChoice" c WHERE c.account_id=$1::uuid
    UNION ALL SELECT f.recording_id,1 AS revision,true AS liked FROM sakura_v2."Favorite" f WHERE f.account_id=$1::uuid
    AND NOT EXISTS(SELECT 1 FROM sakura_v2."FavoriteChoice" c WHERE c.account_id=f.account_id AND c.recording_id=f.recording_id)`,[accountId]);
  return Object.fromEntries(result.rows.map(row=>[String(row.recording_id),{liked:row.liked===true,revision:Number(row.revision)}]));
}
export async function getFavoriteRevisions(accountId:string,sql:Pick<PoolClient,"query">=getRebuildPool()):Promise<Record<string,number>> {
  return Object.fromEntries(Object.entries(await getFavoriteStates(accountId,sql)).map(([id,state])=>[id,state.revision]));
}
export async function getLibrary(accountId:string,url:URL) {
  const {limit,cursor}=pageInput(url);
  const kind=url.searchParams.get("kind")||"liked";
  if(!["liked","downloads","all"].includes(kind))throw new ProductError(400,"Invalid library view");
  return inTransaction(async client=>{
  // Favorite rows and their causal baselines must describe the same snapshot.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
  const from=kind==="downloads" ? `JOIN (SELECT recording_id,MAX(updated_at) AS created_at FROM sakura_v2."UserDownload"
      WHERE account_id=$1::uuid AND status='complete' GROUP BY recording_id) f ON f.recording_id=r.id` :
    kind==="all" ? `JOIN (SELECT recording_id,MAX(created_at) created_at FROM (
      SELECT recording_id,created_at FROM sakura_v2."Favorite" WHERE account_id=$1::uuid UNION ALL
      SELECT recording_id,updated_at FROM sakura_v2."UserDownload" WHERE account_id=$1::uuid AND status='complete' UNION ALL
      SELECT pr.recording_id,pr.added_at FROM sakura_v2."PlaylistRecording" pr JOIN sakura_v2."Playlist" p ON p.id=pr.playlist_id WHERE p.account_id=$1::uuid
    ) x GROUP BY recording_id) f ON f.recording_id=r.id` : `JOIN sakura_v2."Favorite" f ON f.recording_id=r.id AND f.account_id=$1::uuid`;
  const rows=await client.query(`${CARD_SELECT.replace('FROM sakura_v2."Recording" r',`,f.created_at AS "addedAt",
    EXISTS(SELECT 1 FROM sakura_v2."Favorite" fav WHERE fav.account_id=$1::uuid AND fav.recording_id=r.id) AS liked FROM sakura_v2."Recording" r`)}
    ${from} WHERE ${VERIFIED} AND ($2::timestamptz IS NULL OR (f.created_at,r.id)<($2::timestamptz,$3::uuid))
    ORDER BY f.created_at DESC,r.id DESC LIMIT $4`,[accountId,cursor?.timestamp??null,cursor?.id??null,limit+1]);
  const hasMore=rows.rows.length>limit,selected=rows.rows.slice(0,limit),last=selected.at(-1);
  const favoriteStates=await getFavoriteStates(accountId,client);
  return {recordings:selected.map(card),tracks:selected.map(card),playlists:await listPlaylists(accountId,client),favoriteStates,favoriteRevisions:Object.fromEntries(Object.entries(favoriteStates).map(([id,state])=>[id,state.revision])),
    nextCursor:hasMore&&last?encodeCursor(last.addedAt,last.id):null,kind};
  });
}
export async function setFavorite(accountId:string,value:unknown) {
  const input=object(value),recordingId=uuid(input.recordingId,"recording ID");
  if(typeof input.liked!=="boolean")throw new ProductError(400,"Expected liked state");
  const liked=input.liked,operationId=input.operationId===undefined?undefined:uuid(input.operationId,"favorite operation ID"),baseRevision=input.baseRevision===undefined?undefined:integer(input.baseRevision,"favorite base revision",0,Number.MAX_SAFE_INTEGER);
  return inIdempotentTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`sakura-v2-history:${accountId}`]);
    const current=(await client.query(`SELECT
      EXISTS(SELECT 1 FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=$2::uuid) AS liked,
      (SELECT revision FROM sakura_v2."FavoriteChoice" WHERE account_id=$1::uuid AND recording_id=$2::uuid) AS revision,
      (SELECT jsonb_build_object('recording_id',recording_id,'liked',liked,'conflict',conflict)
        FROM sakura_v2."FavoriteOperationReceipt" WHERE account_id=$1::uuid AND operation_id=$3::uuid) AS receipt`,
      [accountId,recordingId,operationId??null])).rows[0];
    const revision=Number(current.revision??(current.liked?1:0));
    if(operationId){
      const previous=current.receipt;
      if(previous){
        if(previous.recording_id!==recordingId||previous.liked!==liked)throw new ProductError(409,"Favorite operation belongs to another choice");
        return {recordingId,liked:Boolean(current.liked),revision,operationId,accepted:true,duplicate:true,conflict:previous.conflict===true};
      }
    }
    const receipt=async(conflict=false)=>{if(operationId)await client.query(`INSERT INTO sakura_v2."FavoriteOperationReceipt"(account_id,operation_id,recording_id,liked,base_revision,conflict) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)`,[accountId,operationId,recordingId,liked,baseRevision??null,conflict]);};
    if(baseRevision!==undefined&&baseRevision!==revision){
      await receipt(true);
      return {recordingId,liked:Boolean(current.liked),revision,...(operationId?{operationId}:{}),accepted:true,duplicate:false,conflict:true};
    }
    if(liked){
      const inserted=await client.query(`INSERT INTO sakura_v2."Favorite"(account_id,recording_id)
        SELECT $1::uuid,r.id FROM sakura_v2."Recording" r WHERE r.id=$2::uuid AND ${VERIFIED}
        ON CONFLICT DO NOTHING RETURNING recording_id`,[accountId,recordingId]);
      if(!inserted.rowCount&&!(await client.query(`SELECT 1 FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=$2::uuid`,[accountId,recordingId])).rowCount)
        throw new ProductError(404,"Recording not found");
    }else await client.query(`DELETE FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=$2::uuid`,[accountId,recordingId]);
    await client.query(`INSERT INTO sakura_v2."FavoriteChoice"(account_id,recording_id,revision,liked) VALUES($1::uuid,$2::uuid,$3,$4)
      ON CONFLICT(account_id,recording_id) DO UPDATE SET revision=EXCLUDED.revision,liked=EXCLUDED.liked,updated_at=now()`,[accountId,recordingId,revision+1,liked]);
    await receipt();
    await client.query(`UPDATE sakura_v2."Mix" SET expires_at=now() WHERE account_id=$1::uuid`,[accountId]);
    await client.query(`DELETE FROM sakura_v2."FeedSession" WHERE account_id=$1::uuid`,[accountId]);
    return {recordingId,liked,revision:revision+1,...(operationId?{operationId,accepted:true,duplicate:false,conflict:false}:{})};
  });
}
export async function createPlaylist(accountId:string,value:unknown) {
  const input=object(value),name=text(input.name,"playlist name",120),description=input.description===undefined?"":text(input.description,"description",2000,true);
  const id=input.requestId===undefined?randomUUID():uuid(input.requestId,"playlist request ID");
  const recordingIds=input.recordingIds===undefined?[]:ids(input.recordingIds,2000);
  await inTransaction(async client=>{
    const inserted=await client.query(`INSERT INTO sakura_v2."Playlist"(id,account_id,name,description)
      VALUES($1::uuid,$2::uuid,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id`,[id,accountId,name,description]);
    if(!inserted.rowCount){
      const existing=(await client.query(`SELECT name,description FROM sakura_v2."Playlist" WHERE id=$1::uuid AND account_id=$2::uuid`,[id,accountId])).rows[0];
      if(!existing||existing.name!==name||existing.description!==description)throw new ProductError(409,"Playlist request has already been used");
      const existingIds=(await client.query(`SELECT recording_id FROM sakura_v2."PlaylistRecording" WHERE playlist_id=$1::uuid ORDER BY position`,[id])).rows.map(row=>row.recording_id as string);
      if(existingIds.length!==recordingIds.length||existingIds.some((recordingId,index)=>recordingId!==recordingIds[index]))throw new ProductError(409,"Playlist request has already been used");
      return;
    }
    if(!recordingIds.length)return;
    const recordings=await cardsForIds(accountId,recordingIds,client);
    if(recordings.length!==recordingIds.length)throw new ProductError(404,"A selected recording is unavailable");
    await client.query(`INSERT INTO sakura_v2."PlaylistRecording"(playlist_id,recording_id,position)
      SELECT $1::uuid,x.id,x.position-1 FROM unnest($2::uuid[]) WITH ORDINALITY x(id,position)`,[id,recordingIds]);
  });
  return getPlaylist(accountId,id);
}
export async function getPlaylist(accountId:string,rawId:string) {
  const id=uuid(rawId,"playlist ID"),pool=getRebuildPool();
  const playlist=(await pool.query(`SELECT id,name,description,cover_url AS "coverUrl",revision,created_at AS "createdAt",updated_at AS "updatedAt"
    FROM sakura_v2."Playlist" WHERE id=$2::uuid AND account_id=$1::uuid`,[accountId,id])).rows[0];
  if(!playlist)throw new ProductError(404,"Playlist not found");
  const rows=await pool.query(`${CARD_SELECT.replace('FROM sakura_v2."Recording" r',',pr.added_at AS "addedAt" FROM sakura_v2."Recording" r')}
    JOIN sakura_v2."PlaylistRecording" pr ON pr.recording_id=r.id AND pr.playlist_id=$2::uuid
    WHERE ${VERIFIED} ORDER BY pr.position`,[accountId,id]);
  const recordings=rows.rows.map(card);
  const coverUrls=[playlist.coverUrl,...recordings.map(recording=>recording.coverUrl)].filter((url,index,all)=>typeof url==="string"&&url&&all.indexOf(url)===index).slice(0,4);
  return {...playlist,hasCustomCover:Boolean(playlist.coverUrl),coverUrl:coverUrls[0]||null,coverUrls,revision:Number(playlist.revision),recordings,tracks:recordings,trackCount:recordings.length,
    durationMs:recordings.reduce((sum,r)=>sum+(r.durationMs||0),0)};
}
export async function updatePlaylist(accountId:string,rawId:string,value:unknown) {
  const id=uuid(rawId,"playlist ID"),input=object(value);
  if(Object.keys(input).some(k=>!["name","description","recordingIds"].includes(k)))throw new ProductError(400,"Unsupported playlist field");
  const name=input.name===undefined?null:text(input.name,"playlist name",120),description=input.description===undefined?null:text(input.description,"description",2000,true);
  const order=input.recordingIds===undefined?null:ids(input.recordingIds,2000);
  await inTransaction(async client=>{
    const row=await client.query(`SELECT id,name,description FROM sakura_v2."Playlist" WHERE id=$2::uuid AND account_id=$1::uuid FOR UPDATE`,[accountId,id]);
    if(!row.rowCount)throw new ProductError(404,"Playlist not found");
    let changed=(name!==null&&name!==row.rows[0].name)||(description!==null&&description!==row.rows[0].description);
    if(order){
      const current=(await client.query(`SELECT recording_id FROM sakura_v2."PlaylistRecording" WHERE playlist_id=$1::uuid ORDER BY position`,[id])).rows.map(r=>r.recording_id);
      if(current.length!==order.length||current.some(x=>!order.includes(x)))throw new ProductError(409,"Playlist membership changed; refresh before reordering");
      const reordered=current.some((x,index)=>x!==order[index]);
      changed ||= reordered;
      if(reordered)await client.query(`UPDATE sakura_v2."PlaylistRecording" SET position=ordered.position-1 FROM
        unnest($2::uuid[]) WITH ORDINALITY ordered(id,position) WHERE playlist_id=$1::uuid AND recording_id=ordered.id`,[id,order]);
    }
    if(changed)await client.query(`UPDATE sakura_v2."Playlist" SET name=COALESCE($3,name),description=COALESCE($4,description),revision=revision+1,updated_at=now()
      WHERE account_id=$1::uuid AND id=$2::uuid`,[accountId,id,name,description]);
  });
  return getPlaylist(accountId,id);
}
export async function deletePlaylist(accountId:string,rawId:string) {
  const id=uuid(rawId,"playlist ID");
  const result=await getRebuildPool().query(`DELETE FROM sakura_v2."Playlist" WHERE id=$2::uuid AND account_id=$1::uuid`,[accountId,id]);
  if(!result.rowCount)throw new ProductError(404,"Playlist not found");
  return {deleted:true,id};
}
export async function mutatePlaylistTracks(accountId:string,rawId:string,value:unknown,remove=false) {
  const id=uuid(rawId,"playlist ID"),input=object(value);
  const recordingIds=remove?[uuid(input.recordingId,"recording ID")]:ids(input.recordingIds??[input.recordingId],200);
  await inTransaction(async client=>{
    if(!(await client.query(`SELECT id FROM sakura_v2."Playlist" WHERE id=$2::uuid AND account_id=$1::uuid FOR UPDATE`,[accountId,id])).rowCount)throw new ProductError(404,"Playlist not found");
    let changed=false;
    if(remove)changed=Boolean((await client.query(`DELETE FROM sakura_v2."PlaylistRecording" WHERE playlist_id=$1::uuid AND recording_id=ANY($2::uuid[])`,[id,recordingIds])).rowCount);
    else{
      const current=(await client.query(`SELECT recording_id FROM sakura_v2."PlaylistRecording" WHERE playlist_id=$1::uuid`,[id])).rows;
      const existing=new Set(current.map(row=>row.recording_id));
      const additions=recordingIds.filter(recordingId=>!existing.has(recordingId));
      const recordings=await cardsForIds(accountId,additions,client);
      if(recordings.length!==additions.length)throw new ProductError(404,"A selected recording is unavailable");
      if(current.length+additions.length>2000)throw new ProductError(400,"Playlist supports up to 2000 songs");
      if(additions.length)changed=Boolean((await client.query(`INSERT INTO sakura_v2."PlaylistRecording"(playlist_id,recording_id,position)
        SELECT $1::uuid,x.id,(SELECT COALESCE(MAX(position)+1,0) FROM sakura_v2."PlaylistRecording" WHERE playlist_id=$1::uuid)+x.position-1
        FROM unnest($2::uuid[]) WITH ORDINALITY x(id,position) ON CONFLICT(playlist_id,recording_id) DO NOTHING`,[id,additions])).rowCount);
    }
    if(changed)await client.query(`UPDATE sakura_v2."Playlist" SET revision=revision+1,updated_at=now() WHERE id=$1::uuid`,[id]);
  });
  return getPlaylist(accountId,id);
}
