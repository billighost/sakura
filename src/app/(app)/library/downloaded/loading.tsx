import { CollectionHeroSkeleton, TrackListSkeleton } from "@/components/CollectionHero";

export default function Loading() {
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <CollectionHeroSkeleton />
      <TrackListSkeleton rows={8} />
    </div>
  );
}
