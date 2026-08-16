import AlbumClient from "./AlbumClient";

/**
 * `loading.tsx` is the boundary that covers awaiting `params` here, so there is
 * no inner Suspense: AlbumClient is a client component that fetches its own data
 * and renders its own placeholder, and wrapping it in a second boundary only
 * added a fallback that never showed.
 */
export default async function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AlbumClient id={id} />;
}
