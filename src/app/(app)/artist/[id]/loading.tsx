import { CollectionHeroSkeleton, TrackListSkeleton } from "@/components/CollectionHero";

export default function Loading() {
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <CollectionHeroSkeleton round />
      <TrackListSkeleton rows={6} />
    </div>
  );
}
