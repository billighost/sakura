import { getRebuildPool,inTransaction } from "./db";
import { CARD_SELECT,VERIFIED,card,cardsForIds } from "./catalog";
import { ProductError,encodeCursor,ids,object,pageInput,text,uuid } from "./validation";
import {randomUUID} from "node:crypto";

export async function listPlaylists(accountId:string) {
  const rows=await getRebuildPool().query(`SELECT p.id,p.name,p.description,p.cover_url AS "coverUrl",p.revision,
    p.created_at AS "createdAt",p.updated_at AS "updatedAt",COUNT(pr.recording_id)::integer AS "trackCount",
    (SELECT r.metadata->>'coverUrl' FROM sakura_v2."PlaylistRecording" x JOIN sakura_v2."Recording" r ON r.id=x.recording_id
      WHERE x.playlist_id=p.id ORDER BY x.position LIMIT 1) AS "firstCoverUrl"
    FROM sakura_v2."Playlist" p LEFT JOIN sakura_v2."PlaylistRecording" pr ON pr.playlist_id=p.id
    WHERE p.account_id=$1::uuid GROUP BY p.id ORDER BY p.updated_at DESC,p.id LIMIT 200`,[accountId]);
  return rows.rows.map(p=>({...p,revision:Number(p.revision),coverUrl:p.coverUrl||p.firstCoverUrl||null}));
}
export async function getLibrary(accountId:string,url:URL) {
  const {limit,cursor}=pageInput(url);
  const kind=url.searchParams.get("kind")||"liked";
  if(!["liked","downloads","all"].includes(kind))throw new ProductError(400,"Invalid library view");
  const from=kind==="downloads" ? `JOIN (SELECT recording_id,MAX(updated_at) AS created_at FROM sakura_v2."UserDownload"
      WHERE account_id=$1::uuid AND status='complete' GROUP BY recording_id) f ON f.recording_id=r.id` :
    kind==="all" ? `JOIN (SELECT recording_id,MAX(created_at) created_at FROM (
      SELECT recording_id,created_at FROM sakura_v2."Favorite" WHERE account_id=$1::uuid UNION ALL
      SELECT recording_id,updated_at FROM sakura_v2."UserDownload" WHERE account_id=$1::uuid AND status='complete' UNION ALL
      SELECT pr.recording_id,pr.added_at FROM sakura_v2."PlaylistRecording" pr JOIN sakura_v2."Playlist" p ON p.id=pr.playlist_id WHERE p.account_id=$1::uuid
    ) x GROUP BY recording_id) f ON f.recording_id=r.id` : `JOIN sakura_v2."Favorite" f ON f.recording_id=r.id AND f.account_id=$1::uuid`;
  const rows=await getRebuildPool().query(`${CARD_SELECT.replace('FROM sakura_v2."Recording" r',`,f.created_at AS "addedAt",
    EXISTS(SELECT 1 FROM sakura_v2."Favorite" fav WHERE fav.account_id=$1::uuid AND fav.recording_id=r.id) AS liked FROM sakura_v2."Recording" r`)}
    ${from} WHERE ${VERIFIED} AND ($2::timestamptz IS NULL OR (f.created_at,r.id)<($2::timestamptz,$3::uuid))
    ORDER BY f.created_at DESC,r.id DESC LIMIT $4`,[accountId,cursor?.timestamp??null,cursor?.id??null,limit+1]);
  const hasMore=rows.rows.length>limit,selected=rows.rows.slice(0,limit),last=selected.at(-1);
  return {recordings:selected.map(card),tracks:selected.map(card),playlists:await listPlaylists(accountId),
    nextCursor:hasMore&&last?encodeCursor(last.addedAt,last.id):null,kind};
}
export async function setFavorite(accountId:string,value:unknown) {
  const input=object(value),recordingId=uuid(input.recordingId,"recording ID");
  if(typeof input.liked!=="boolean")throw new ProductError(400,"Expected liked state");
  const liked=input.liked;
  await inTransaction(async client=>{
    if(liked){
      const inserted=await client.query(`INSERT INTO sakura_v2."Favorite"(account_id,recording_id)
        SELECT $1::uuid,r.id FROM sakura_v2."Recording" r WHERE r.id=$2::uuid AND ${VERIFIED}
        ON CONFLICT DO NOTHING RETURNING recording_id`,[accountId,recordingId]);
      if(!inserted.rowCount&&!(await client.query(`SELECT 1 FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=$2::uuid`,[accountId,recordingId])).rowCount)
        throw new ProductError(404,"Recording not found");
    }else await client.query(`DELETE FROM sakura_v2."Favorite" WHERE account_id=$1::uuid AND recording_id=$2::uuid`,[accountId,recordingId]);
    await client.query(`UPDATE sakura_v2."Mix" SET expires_at=now() WHERE account_id=$1::uuid`,[accountId]);
  });
  return {recordingId,liked};
}
export async function createPlaylist(accountId:string,value:unknown) {
  const input=object(value),name=text(input.name,"playlist name",120),description=input.description===undefined?"":text(input.description,"description",2000,true);
  const id=input.requestId===undefined?randomUUID():uuid(input.requestId,"playlist request ID");
  await getRebuildPool().query(`INSERT INTO sakura_v2."Playlist"(id,account_id,name,description) VALUES($1::uuid,$2::uuid,$3,$4) ON CONFLICT(id) DO NOTHING`,[id,accountId,name,description]);
  const row=(await getRebuildPool().query(`SELECT id,name,description,revision,created_at AS "createdAt",updated_at AS "updatedAt" FROM sakura_v2."Playlist" WHERE id=$1::uuid AND account_id=$2::uuid`,[id,accountId])).rows[0];
  if(!row||row.name!==name||row.description!==description)throw new ProductError(409,"Playlist request has already been used");
  return {...row,revision:Number(row.revision),trackCount:0,recordings:[],tracks:[]};
}
export async function getPlaylist(accountId:string,rawId:string) {
  const id=uuid(rawId,"playlist ID"),pool=getRebuildPool();
  const playlist=(await pool.query(`SELECT id,name,description,cover_url AS "coverUrl",revision,created_at AS "createdAt",updated_at AS "updatedAt"
    FROM sakura_v2."Playlist" WHERE id=$2::uuid AND account_id=$1::uuid`,[accountId,id])).rows[0];
  if(!playlist)throw new ProductError(404,"Playlist not found");
  const membership=(await pool.query(`SELECT recording_id AS id FROM sakura_v2."PlaylistRecording" WHERE playlist_id=$1::uuid ORDER BY position`,[id])).rows.map(r=>r.id);
  const recordings=await cardsForIds(accountId,membership);
  return {...playlist,revision:Number(playlist.revision),recordings,tracks:recordings,trackCount:recordings.length,
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
