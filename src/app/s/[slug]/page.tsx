import { connection } from "next/server";
import { notFound } from "next/navigation";
import { readPublicShare, validShareSlug } from "@/rebuild/data/shares";
import { requireRebuildAccount } from "@/rebuild/auth";
import { SharedSong } from "@/rebuild/player/SharedSong";
export const instant=false;
export default async function Page({params}:{params:Promise<{slug:string}>}){
 await connection();const {slug}=await params;if(!validShareSlug(slug))notFound();
 const [share,account]=await Promise.all([readPublicShare(slug),requireRebuildAccount()]);
 if(!share)notFound();
 return <SharedSong share={share} signedIn={Boolean(account)}/>;
}
