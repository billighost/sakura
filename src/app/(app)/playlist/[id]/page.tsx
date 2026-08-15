import { Suspense } from "react";
import Loading from "./loading";
import PlaylistClient from "./PlaylistClient";

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      {params.then(({ id }) => (
        <PlaylistClient id={id} />
      ))}
    </Suspense>
  );
}
