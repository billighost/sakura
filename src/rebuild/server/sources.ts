import { randomUUID } from "node:crypto";
import { fetchAudioHeaders } from "../core/streaming";
import { assessAudioCandidate } from "../core/matching";
import type { CanonicalRecording, RecordingMetadata } from "../core/types";
import type { StoredAudioAsset, ReviewCandidate } from "./contracts";
import { parseRecordingMetadata, supportedAudioMime } from "./input";
import { readMetadataJson } from "./providers";

export type AudioDiscoveryResult = { status: "ready"; asset: StoredAudioAsset } | { status: "review"; candidates: readonly ReviewCandidate[] } | { status: "unavailable"; reason: string; retryable: boolean };
function row(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export interface AudioSourceDiscovery { discover(recording: CanonicalRecording, signal?: AbortSignal): Promise<AudioDiscoveryResult> }

/** Source discovery creates/locates a bot-chat audio message, never transfers its full file. */
export class WorkerAudioDiscovery implements AudioSourceDiscovery {
  private compatibility = false;
  constructor(private readonly configuration: { url: string; secret: string; primaryBot: string; fallbackBots?: readonly string[] } | null, private readonly fetcher: typeof fetch = fetch) {}
  private async post(path: string, body: unknown, signal?: AbortSignal) {
    if (!this.configuration) throw new Error("Audio worker is not configured");
    const base = new URL(this.configuration.url);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid audio worker configuration");
    const response = await fetchAudioHeaders(new URL(path, base).toString(), { method: "POST", signal, headerTimeoutMs: 48000, redirect: "error",
      headers: { Authorization: `Bearer ${this.configuration.secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, this.fetcher);
    const payload = row(await readMetadataJson(response));
    return { status: response.status, payload };
  }
  async discover(recording: CanonicalRecording, signal?: AbortSignal): Promise<AudioDiscoveryResult> {
    if (!this.configuration) return { status: "unavailable", reason: "audio-worker-not-configured", retryable: false };
    const reference = recording.references?.find((ref) => ref.provider === "deezer") ?? recording.references?.find((ref) => ref.provider === "spotify");
    if (!reference) return { status: "unavailable", reason: "recording-has-no-source-reference", retryable: false };
    let result: Record<string, unknown>;
    let protocol: "v1" | "v2" = "v2";
    if (!this.compatibility) {
      const response = await this.post("/v2/resolve", { reference, metadata: recording.metadata, deadlineMs: 35000,
        botScopes: [this.configuration.primaryBot, ...(this.configuration.fallbackBots ?? [])] }, signal);
      if (response.status === 404) this.compatibility = true;
      else {
        if (response.status === 429 || response.status === 503) return { status: "unavailable", reason: "audio-worker-busy", retryable: true };
        if (response.payload.status === "review") return { status: "review", candidates: Array.isArray(response.payload.candidates) ? response.payload.candidates as ReviewCandidate[] : [] };
        if (response.payload.status !== "ready") return { status: "unavailable", reason: String(response.payload.reason ?? "audio-source-unavailable"), retryable: true };
        result = row(response.payload.audio);
        return this.verifiedAsset(recording, result, "v2");
      }
    }
    // Current deployed worker receives the exact selected catalogue URL. We validate
    // its returned tags and /audio-info before accepting any audio; no fuzzy title lookup.
    protocol = "v1";
    const url = reference.provider === "deezer" ? `https://www.deezer.com/track/${reference.id}` : `https://open.spotify.com/track/${reference.id}`;
    const selected = await this.post("/search-and-select", { query: url, expectedTitle: recording.metadata.title, expectedArtist: recording.metadata.artists[0],
      targetDuration: recording.metadata.durationMs ? Math.round(recording.metadata.durationMs / 1000) : undefined, searchTimeoutMs: 15000, selectTimeoutMs: 25000, botUsername: this.configuration.primaryBot }, signal);
    if (selected.status !== 200 || selected.payload.error) return { status: "unavailable", reason: "audio-source-unavailable", retryable: true };
    const messageId = String(selected.payload.messageId ?? "");
    if (!/^[1-9]\d{0,14}$/.test(messageId)) return { status: "unavailable", reason: "audio-source-invalid-response", retryable: false };
    const info = await this.post("/audio-info", { messageId }, signal);
    if (info.status !== 200) return { status: "unavailable", reason: "audio-source-metadata-unavailable", retryable: true };
    result = { ...info.payload, messageId, chatScope: this.configuration.primaryBot };
    return this.verifiedAsset(recording, result, protocol);
  }
  private verifiedAsset(recording: CanonicalRecording, raw: Record<string, unknown>, protocol: "v1" | "v2"): AudioDiscoveryResult {
    let metadata: RecordingMetadata;
    try {
      metadata = parseRecordingMetadata(raw.metadata ?? { title: raw.title, artists: [raw.artist],artistsComplete:false,durationMs: Math.round(Number(raw.duration) * 1000) });
      if(metadata.artistsComplete===undefined)metadata={...metadata,artistsComplete:false};
    }
    catch { return { status: "unavailable", reason: "audio-source-invalid-metadata", retryable: false }; }
    const messageId = String(raw.messageId ?? "");
    const chatScope = String(raw.chatScope ?? "");
    const mimeType = String(raw.mimeType ?? "");
    const sizeBytes = Number(raw.size ?? raw.sizeBytes);
    if (!/^[1-9]\d{0,14}$/.test(messageId) || !/^[a-zA-Z0-9_]{3,64}$/.test(chatScope) || !supportedAudioMime(mimeType) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 4096) return { status: "unavailable", reason: "audio-source-invalid-response", retryable: false };
    const sourceReference = { provider: "telegram" as const, id: messageId, scope: chatScope.toLowerCase() };
    const assessment = assessAudioCandidate(recording, { candidateId: messageId, metadata, audioKind: "full", references: [sourceReference] });
    if (!assessment.acceptable) return { status: "review", candidates: [{ title: metadata.title, artists: metadata.artists, durationMs: metadata.durationMs ?? null, reasons: assessment.reasons }] };
    const assetId = randomUUID();
    return { status: "ready", asset: { assetId,recordingId: recording.recordingId,candidate: { candidateId: assetId,metadata,references: [sourceReference],audioKind: "full" },
      locator: { kind: "telegram-worker",messageId,chatScope: chatScope.toLowerCase(),protocol },state: "ready",verifiedAt: new Date().toISOString(),mimeType,sizeBytes,ownerAccountId: null } };
  }
}
