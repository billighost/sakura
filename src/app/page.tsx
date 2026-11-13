import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireRebuildAccount } from "@/rebuild/auth";
import Link from "next/link";
import { Blossom, Branch } from "@/rebuild/app/Brand";
import { staticPageMetadata } from "@/rebuild/seo/metadata";
import s from "@/rebuild/app/ink.module.css";
export const metadata = staticPageMetadata("default");
export const instant = false;
export default async function Page() {
 await connection();
 if (await requireRebuildAccount()) redirect("/home");
 return <div className={s.authRoot}>
  <aside className={s.authArtwork}>
   <Link href="/" className={s.brand}><Blossom/><span>sakura<small>your little music world</small></span></Link>
   <Branch className={s.authBranch}/>
   <div><span className={s.eyebrow}>A LITTLE ROOM TO LISTEN</span><h2>Let the world<br/><em>wait a little.</em></h2><p>Music, with room to breathe.</p></div>
  </aside>
  <main className={s.authForm}>
   <span className={s.eyebrow}>WELCOME TO SAKURA</span><h1>Your little<br/>music world.</h1>
   <p>A quiet place for favorite songs, new discoveries, and listening without hurry.</p>
   <p>Keep your songs and playlists close, follow synchronized lyrics, and take downloaded music with you. In Sakura Bloom, the songs become a story.</p>
   <Link className={s.primaryButton} href="/register">Make yourself at home</Link>
   <p>Already have a little world here? <Link href="/login">Sign in</Link></p>
   <p><Link href="/about">About Sakura</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></p>
  </main>
 </div>;
}
