import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { validShareSlug } from "@/rebuild/data/shares";
import { readShareForPage } from "@/rebuild/seo/public-data";
import { publicShareMetadata } from "@/rebuild/seo/entity";
import { requireRebuildAccount } from "@/rebuild/auth";
import { SharedSong, SharedSongActions, SharedSongActionsLoading } from "@/rebuild/player/SharedSong";
import type { PublicShare } from "@/rebuild/player/SharedSong";
export const instant=false;
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
 await connection();
 const { slug } = await params;
 if (!validShareSlug(slug)) notFound();
 const share = await readShareForPage(slug);
 if (!share) notFound();
 return publicShareMetadata(share);
}
async function ShareActions({share,account}:{share:PublicShare;account:ReturnType<typeof requireRebuildAccount>}){
 const current=await account;
 return <SharedSongActions share={share} signedIn={Boolean(current)}/>;
}
export default async function Page({params}:{params:Promise<{slug:string}>}){
 await connection();const {slug}=await params;if(!validShareSlug(slug))notFound();
 // Public content remains authoritative; a slow/unavailable account check only
 // affects its own action boundary and falls back to the safe sign-in path.
 const account=requireRebuildAccount().catch(()=>null),share=await readShareForPage(slug);
 if(!share)notFound();
 return <SharedSong share={share} actions={<Suspense fallback={<SharedSongActionsLoading/>}><ShareActions share={share} account={account}/></Suspense>}/>;
}
