import { Suspense } from "react";
import Loading from "./loading";
import ArtistClient from "./ArtistClient";

export default function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      {params.then(({ id }) => (
        <ArtistClient id={id} />
      ))}
    </Suspense>
  );
}
