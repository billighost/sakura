"use client";

import { useState } from "react";
import { useMusic } from "./MusicContext";
import { TrackList } from "./Elements";
import { CollectionToolbar, sortRoomTracks, useRoomLayout, type RoomSort, type RoomSortDirection } from "./CollectionRoom";
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
 const [layout, setLayout] = useRoomLayout(music.account?.id, room);
 const [sort, setSort] = useState<RoomSort>("kept");
 const [direction, setDirection] = useState<RoomSortDirection>("asc");
 const unique = [...new Map(tracks.map(track => [music.effectiveId(track), track])).values()];
 const ordered = sortRoomTracks(unique, sort, direction);

 return <section aria-label={label}>
  <CollectionToolbar layout={layout} onLayout={setLayout} sort={sort} onSort={setSort} direction={direction} onDirection={setDirection} count={ordered.length} firstSortLabel={firstSortLabel} dateSortLabel={dateSortLabel}/>
  <TrackList tracks={ordered} layout={layout} dateLabel={dateSortLabel}/>
 </section>;
}
