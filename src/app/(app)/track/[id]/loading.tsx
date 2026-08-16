import { CollectionHeroSkeleton, TrackListSkeleton } from "@/components/CollectionHero";

export default function Loading() {
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      {/* A track has one play button rather than a transport row, so the
          placeholder omits it instead of standing in for a control that
          will never arrive. */}
      <CollectionHeroSkeleton transport={false} />
      <TrackListSkeleton rows={3} />
    </div>
  );
}
