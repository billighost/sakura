import Link from "next/link";
import { Blossom } from "@/rebuild/app/Brand";
export default function NotFound(){return <main style={{maxWidth:440,margin:"15vh auto",padding:24,textAlign:"center"}}><Blossom style={{width:54,color:"var(--ink-petal)"}}/><h1 style={{fontFamily:"var(--font-fraunces),Georgia,serif",fontWeight:400}}>This little path has moved.</h1><p>The song or collection may no longer be here.</p><Link href="/home">Come back to the music</Link></main>;}
