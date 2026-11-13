import type { Metadata } from "next";
import { OgPreviewGallery } from "@/rebuild/og/OgPreviewGallery";

export const metadata: Metadata = {
  title: { absolute: "Sakura · The sharing collection" },
  description: "Three carefully coded OG image directions for Sakura. Compare every page, preview it in a chat, and save your favorites.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <OgPreviewGallery />;
}
