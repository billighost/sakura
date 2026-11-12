"use client";
import { useState } from "react";
import Link from "next/link";
import { MusicProvider, useMusic } from "@/rebuild/app/MusicContext";
import { OfflineNavigationController } from "@/rebuild/app/NavigationUX";
import { PersonalizedFeed } from "@/rebuild/app/PersonalizedFeed";
import { useResource } from "@/rebuild/app/resources";

function ArtistRoom() {
 const { account } = useMusic(), resource = useResource<{ name: string }>(account?.id || null, "/api/v2/artists/prefetch-fixture");
 return <output data-prepared-artist>{resource.data?.name || "waiting"}</output>;
}
function Room() {
 const music = useMusic(), [artist, setArtist] = useState(false), [feed, setFeed] = useState(false);
 return <><OfflineNavigationController/><main>
  <h1>Navigation data preparation fixture</h1><output data-boot>{music.booting ? "loading" : "ready"}</output>
  <Link href="/artist/prefetch-fixture" prefetch={false} data-prefetch-artist onClick={event => { event.preventDefault(); setArtist(true); }}>Open artist</Link>
  <Link href="/discover" prefetch={false} data-prefetch-feed onClick={event => { event.preventDefault(); setFeed(true); }}>Open discovery</Link>
  {artist && <ArtistRoom/>}{feed && <PersonalizedFeed surface="discover"/>}
 </main></>;
}
export default function PrefetchRoom() { return <MusicProvider><Room/></MusicProvider>; }
