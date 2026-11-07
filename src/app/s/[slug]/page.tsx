import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getRebuildPool } from "@/rebuild/data/db";
import { requireRebuildAccount } from "@/rebuild/auth";
import { SharedSong, type PublicShare } from "@/rebuild/player/SharedSong";
export const instant=false;
export default async function Page({params}:{params:Promise<{slug:string}>}){
 await connection();const {slug}=await params;if(!/^[A-Za-z0-9_-]{16}$/.test(slug))notFound();
 const found=await getRebuildPool().query('SELECT slug,kind,payload FROM sakura_v2."Share" WHERE slug=$1 AND deleted_at IS NULL',[slug]);
 if(!found.rows[0])notFound();
 return <SharedSong share={found.rows[0] as PublicShare} signedIn={Boolean(await requireRebuildAccount())}/>;
}
