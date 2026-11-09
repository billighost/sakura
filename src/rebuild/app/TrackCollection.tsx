"use client";

import { useMusic } from "./MusicContext";
import { TrackList } from "./Elements";
import { CollectionToolbar, sortRoomTracks, useRoomPresentation } from "./CollectionRoom";
import type { MusicTrack } from "./types";

/** Shared presentation controls for catalog lists and collection previews. */
export function TrackCollection({ tracks, room, label, firstSortLabel = "Original order", dateSortLabel }: {
 tracks: MusicTrack[];
 room: string;
 label: string;
 firstSortLabel?: string;
 dateSortLabel?: string;
}) {
 const music = useMusic();
 const [presentation, setPresentation] = useRoomPresentation(music.account?.id, room);
 const {layout,sort,direction}=presentation;
 const unique = [...new Map(tracks.map(track => [music.effectiveId(track), track])).values()];
 const ordered = sortRoomTracks(unique, sort, direction);

 return <section aria-label={label}>
  <CollectionToolbar layout={layout} onLayout={value=>setPresentation({layout:value})} sort={sort} onSort={value=>setPresentation({sort:value})} direction={direction} onDirection={value=>setPresentation({direction:value})} count={ordered.length} firstSortLabel={firstSortLabel} dateSortLabel={dateSortLabel}/>
  <TrackList tracks={ordered} layout={layout} dateLabel={dateSortLabel}/>
 </section>;
}
