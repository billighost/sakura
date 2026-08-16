import PlaylistClient from "./PlaylistClient";

export default async function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlaylistClient id={id} />;
}
