import { Suspense } from "react";
import MixClient, { MixLoadingState } from "./MixClient";

export default function MixPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<MixLoadingState />}>
      {params.then(({ id }) => (
        <MixClient id={id} />
      ))}
    </Suspense>
  );
}
