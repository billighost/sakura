import SystemPlaylistClient from "./SystemPlaylistClient";

export default async function SystemPlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SystemPlaylistClient id={id} />;
}
