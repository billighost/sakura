import { Suspense } from "react";
import BrowseClient, { BrowseLoadingState } from "./BrowseClient";

export default function ExternalPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  return (
    <Suspense fallback={<BrowseLoadingState />}>
      {params.then(({ kind, id }) => (
        <BrowseClient kind={kind} id={id} />
      ))}
    </Suspense>
  );
}
