"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { MusicState } from "./MusicContext";
import type { DownloadSnapshots } from "./downloadSnapshots";

type ActionKeys = {
  [Key in keyof MusicState]-?: NonNullable<MusicState[Key]> extends (...args: infer _Args) => unknown ? Key : never
}[keyof MusicState];

export type MusicActions = Pick<MusicState, ActionKeys>;
export type MusicView = Omit<MusicState, ActionKeys | "positionMs" | "durationMs" | "playbackProgress"> & { aliasesRevision: number };

const ViewContext = createContext<MusicView | null>(null);
const ActionsContext = createContext<MusicActions | null>(null);
const DownloadsContext = createContext<DownloadSnapshots | null>(null);

/** Root owns the live action proxies and membership-only view publication. */
export function MusicViewProvider({ view, actions, downloads, children }: {
  view: MusicView; actions: MusicActions; downloads: DownloadSnapshots; children: ReactNode;
}) {
  return <ActionsContext.Provider value={actions}><DownloadsContext.Provider value={downloads}><ViewContext.Provider value={view}>{children}</ViewContext.Provider></DownloadsContext.Provider></ActionsContext.Provider>;
}

export function musicActions(value: MusicState): MusicActions {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => typeof member === "function")) as MusicActions;
}

export function musicView(value: MusicState, aliasesRevision: number): MusicView {
  return { ...Object.fromEntries(Object.entries(value).filter(([key, member]) => typeof member !== "function" && !["positionMs", "durationMs", "playbackProgress"].includes(key))), aliasesRevision } as MusicView;
}

export function useMusicView() {
  const value = useContext(ViewContext);
  if (!value) throw new Error("MusicProvider view is required.");
  return value;
}

export function useMusicActions() {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("MusicProvider actions are required.");
  return value;
}

function useDownloadStore() {
  const value = useContext(DownloadsContext);
  if (!value) throw new Error("MusicProvider downloads are required.");
  return value;
}

export function useDownloadEntry(recordingId: string) {
  const store = useDownloadStore();
  const subscribe = useCallback((listener: () => void) => store.subscribeEntry(recordingId, listener), [store, recordingId]);
  const snapshot = useCallback(() => store.getEntry(recordingId), [store, recordingId]);
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

export function useDownloadSnapshot() {
  const store = useDownloadStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

export function useDownloadMembershipSnapshot() {
  const store = useDownloadStore();
  return useSyncExternalStore(store.subscribeMembership, store.getMembershipSnapshot, store.getServerSnapshot);
}
