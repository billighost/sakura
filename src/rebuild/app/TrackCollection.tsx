"use client";

import { useMemo, useState } from "react";
import { useMusic } from "./MusicContext";
import { SearchField, TrackList } from "./Elements";
import { CollectionToolbar, sortRoomTracks, useRoomPresentation } from "./CollectionRoom";
import { collectionTrackMatches } from "./collectionSearch";
import { StickySearch } from "./StickySearch";
import type { MusicTrack } from "./types";

/** Shared presentation controls for catalog lists and collection previews. */
export function TrackCollection({ tracks, room, label, firstSortLabel = "Original order", dateSortLabel, searchable = true, sticky = true }: {
 tracks: MusicTrack[];
 room: string;
 label: string;
 firstSortLabel?: string;
 dateSortLabel?: string;
 searchable?: boolean;
 sticky?: boolean;
}) {
 const music = useMusic();
 const {effectiveId,track:currentTrack,queue,downloads}=music;
 const [presentation, setPresentation] = useRoomPresentation(music.account?.id, room);
 const {layout,sort,direction}=presentation;
 const [query,setQuery]=useState("");
 const unique = useMemo(() => [...new Map(tracks.map(track => [effectiveId(track), track])).values()], [tracks, effectiveId, currentTrack, queue, downloads]);
 const ordered = useMemo(() => sortRoomTracks(unique.filter(track=>collectionTrackMatches(track,query)), sort, direction), [unique, query, sort, direction]);

 return <section aria-label={label}>
  {searchable&&<StickySearch enabled={sticky} label={label+" search"}>
   <SearchField value={query} onChange={setQuery} label={"Find in "+label.toLowerCase()} placeholder="Find a title, artist or album"/>
  </StickySearch>}
  <CollectionToolbar layout={layout} onLayout={value=>setPresentation({layout:value})} sort={sort} onSort={value=>setPresentation({sort:value})} direction={direction} onDirection={value=>setPresentation({direction:value})} count={ordered.length} firstSortLabel={firstSortLabel} dateSortLabel={dateSortLabel}/>
  <TrackList tracks={ordered} layout={layout} dateLabel={dateSortLabel}/>
 </section>;
}
