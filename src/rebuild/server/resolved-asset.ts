import type { ResolveRecordingResult, StoredAudioAsset } from "./contracts";

// Request-local evidence travels with the resolved object, never its JSON or a
// persisted job. A later request still performs the repository ownership check.
const selectedAssets = new WeakMap<object, StoredAudioAsset>();
export function rememberResolvedAsset(result: ResolveRecordingResult, asset: StoredAudioAsset): ResolveRecordingResult {
  if (result.status === "resolved") selectedAssets.set(result, asset);
  return result;
}
export function selectedResolvedAsset(result: ResolveRecordingResult, accountId: string): StoredAudioAsset | undefined {
  if (result.status !== "resolved") return;
  const asset = selectedAssets.get(result);
  if (asset?.recordingId === result.recording.recordingId && asset.assetId === result.playback.assetId
    && (asset.ownerAccountId === null || asset.ownerAccountId === accountId)) return asset;
}
