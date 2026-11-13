"use client";

import { useMemo, useState } from "react";
import { useMusicActions, useMusicView } from "./musicView";
import { SearchField, TrackList } from "./Elements";
import { CollectionToolbar, sortRoomTracks, useRoomPresentation } from "./CollectionRoom";
import { useCollectionSearch } from "./useCollectionSearch";
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
 const music = useMusicView(), actions = useMusicActions();
 const [presentation, setPresentation] = useRoomPresentation(music.account?.id, room);
 const {layout,sort,direction}=presentation;
 const [query,setQuery]=useState("");
 // The stable action reads mutable aliases; their revision invalidates this projection.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const unique = useMemo(() => [...new Map(tracks.map(track => [actions.effectiveId(track), track])).values()], [tracks, actions, music.aliasesRevision]);
 const sorted = useMemo(() => sortRoomTracks(unique, sort, direction), [unique, sort, direction]);
 const { tracks: ordered, searching } = useCollectionSearch(sorted, query);

 return <section aria-label={label} aria-busy={searching}>
  {searchable&&<StickySearch enabled={sticky} label={label+" search"}>
   <SearchField value={query} onChange={setQuery} label={"Find in "+label.toLowerCase()} placeholder="Find a title, artist or album"/>
  </StickySearch>}
  <CollectionToolbar layout={layout} onLayout={value=>setPresentation({layout:value})} sort={sort} onSort={value=>setPresentation({sort:value})} direction={direction} onDirection={value=>setPresentation({direction:value})} count={ordered.length} firstSortLabel={firstSortLabel} dateSortLabel={dateSortLabel}/>
  {searching&&<p role="status">Searching songs…</p>}
  <TrackList tracks={ordered} layout={layout} dateLabel={dateSortLabel}/>
 </section>;
}
