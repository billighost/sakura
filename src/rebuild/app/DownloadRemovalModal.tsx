"use client";

import dynamic from "next/dynamic";

// Rendering and the offline warmup must share this exact import site.
export const preloadDownloadRemovalDialog = () => import("./DownloadRemovalDialog").then(module => module.DownloadRemovalDialog);

export const DownloadRemovalModal = dynamic(preloadDownloadRemovalDialog, {
  ssr: false,
  loading: () => <p role="status" aria-live="polite">Opening download options…</p>,
});
