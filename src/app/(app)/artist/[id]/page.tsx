import ArtistClient from "./ArtistClient";

/** See the note in ../album/[id]/page.tsx on why there's no inner Suspense. */
export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ArtistClient id={id} />;
}
