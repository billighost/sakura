import { Suspense } from "react";
import Loading from "./loading";
import AlbumClient from "./AlbumClient";

export default function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      {params.then(({ id }) => (
        <AlbumClient id={id} />
      ))}
    </Suspense>
  );
}
