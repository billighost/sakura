import { Suspense } from "react";
import SystemPlaylistClient, { SystemPlaylistLoadingState } from "./SystemPlaylistClient";

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<SystemPlaylistLoadingState />}>
      {params.then(({ id }) => (
        <SystemPlaylistClient id={id} />
      ))}
    </Suspense>
  );
}
