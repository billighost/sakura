// Generated from src/rebuild/core; run node scripts/build-rebuild-worker.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadKey = downloadKey;
exports.reduceDownloads = reduceDownloads;
exports.downloadedRecordings = downloadedRecordings;
exports.downloadProgress = downloadProgress;
function downloadKey(recordingId, scope) {
    if (!recordingId.trim() || !scope.accountId.trim() || !scope.deviceId.trim())
        throw new Error("Downloads require canonical recording, account and device IDs");
    return JSON.stringify([scope.accountId, scope.deviceId, recordingId]);
}
/**
 * Provider aliases live separately from this manifest. One recording produces
 * one row and one artifact regardless of which shelf or provider initiated it.
 * Write the blob and completed manifest in one IndexedDB transaction in the adapter.
 */
function reduceDownloads(state, event) {
    const key = downloadKey(event.recordingId, event.scope);
    const entry = state[key];
    if (event.type === "remove") {
        if (!entry)
            return state;
        const next = { ...state };
        delete next[key];
        return next;
    }
    if (event.type === "enqueue") {
        if (entry && !["failed", "paused"].includes(entry.status))
            return state;
        return { ...state, [key]: entry ? { ...entry, status: "queued", operationId: undefined, error: undefined } : {
                recordingId: event.recordingId, scope: { ...event.scope }, status: "queued", downloadedBytes: 0, totalBytes: null,
            } };
    }
    if (!entry)
        return state;
    if (event.type === "start") {
        if (!event.operationId || !["queued", "paused", "failed"].includes(entry.status))
            return state;
        return { ...state, [key]: { ...entry, status: "downloading", operationId: event.operationId, error: undefined } };
    }
    if (entry.status !== "downloading" || entry.operationId !== event.operationId)
        return state;
    if (event.type === "progress") {
        if (!Number.isSafeInteger(event.downloadedBytes) || event.downloadedBytes < entry.downloadedBytes)
            return state;
        if (event.totalBytes !== null && (!Number.isSafeInteger(event.totalBytes) || event.totalBytes < event.downloadedBytes))
            return state;
        return { ...state, [key]: { ...entry, downloadedBytes: event.downloadedBytes, totalBytes: event.totalBytes } };
    }
    if (event.type === "complete") {
        if (!event.artifactId || !/^[a-f0-9]{64}$/i.test(event.sha256) || !Number.isSafeInteger(event.downloadedBytes) || event.downloadedBytes <= 0)
            return state;
        if (event.downloadedBytes < entry.downloadedBytes || (entry.totalBytes !== null && entry.totalBytes !== event.downloadedBytes))
            return state;
        return { ...state, [key]: { ...entry, status: "complete", downloadedBytes: event.downloadedBytes, totalBytes: event.downloadedBytes, artifactId: event.artifactId, sha256: event.sha256.toLowerCase() } };
    }
    return { ...state, [key]: { ...entry, status: event.type === "pause" ? "paused" : "failed", error: event.type === "fail" ? event.error ?? "Download failed" : undefined } };
}
function downloadedRecordings(state, scope) {
    return Object.values(state).filter((entry) => entry.scope.accountId === scope.accountId && entry.scope.deviceId === scope.deviceId && entry.status === "complete");
}
function downloadProgress(entry) {
    return entry.totalBytes && entry.totalBytes > 0 ? Math.min(1, entry.downloadedBytes / entry.totalBytes) : null;
}
