import MixClient from "./MixClient";

/** `loading.tsx` covers awaiting params; MixClient owns its own placeholder. */
export default async function MixPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MixClient id={id} />;
}
