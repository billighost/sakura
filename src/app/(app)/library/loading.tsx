import { PageSkeleton } from "@/components/CollectionHero";

/** A tab root, so no hero and no back control — a title and a list. */
export default function Loading() {
  return <PageSkeleton rows={8} />;
}
