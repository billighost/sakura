# Thirty-recording download acceptance

The final low-data audit passed **30/30 download starts** after selecting each fixed recording from Sakura's actual search API. It transferred exactly **122,880 audio bytes (120 KiB)**: one 4,096-byte range per recording. It preserved the **26 complete files** verified earlier; those files were not downloaded again.

```powershell
node --import tsx scripts/rebuild-download-acceptance.ts --live --start-only --resume --base http://127.0.0.1:3015 --session-file .local/download-api-session.json
node scripts/rebuild-download-review.mjs
```

Open the review address printed by the second command, normally `http://127.0.0.1:3097`. The page has the existing complete audio files, metadata/transfer evidence, category and song filters, and a listening checklist. Notes stay in this browser and can be exported as JSON. The review server binds only to the local machine.

The fixed seed `sakura-2026-11-08` selects exactly ten famous recordings, ten remixes/live/instrumental/TV recordings, and ten multilingual or lesser-known recordings. Japanese and Korean are included. Failed targets were never replaced with easier songs.

Every startup result records its actual `/api/v2/search?kind=tracks&q=...` query and exact selected provider reference, title, primary artist, duration and version. Source metadata must pass the shared recording matcher. Search summaries omitted REI's contribution on three INERTIA versions; those targets followed the app's normal metadata-only `/api/v2/recordings/index` step to hydrate the full credits before source verification. These requests may index verified catalogue entries. No personal library, account, settings or listening-history writes occurred.

The audio request must return `206`, the exact expected `Content-Range`, audio MIME type and `Content-Length: 4096`. The reader cancels immediately after 4 KiB and rejects full-file responses, oversized bodies and truncated bodies. A persisted ledger reserves each range before requesting it and limits the audit to 120 KiB. Completed startup evidence is reused on resume. No resolve POST, background audio job, source promotion, image fetch or full-file network transfer is performed by the current audit; `--full` is rejected.

**A successful startup does not verify a complete audio file or its acoustic identity.** The earlier 26 complete files separately passed source metadata, full byte count, SHA-256, `ffprobe` embedded tags/duration and independent first-range equality. Listen to the beginning, middle and ending of those files, mark **Correct recording** or **Wrong / uncertain**, and export the review. Check featured voices, exact remix/live arrangements, instrumental vocals, language and TV/full-length distinctions.

Evidence:

- `docs/rebuild/DOWNLOAD-STARTUP-ACCEPTANCE.json`: final search-first startup audit, all 30 passed.
- `.local/audio-review/startup-report.json` and `startup-budget.json`: local results and 120 KiB ledger.
- `.local/audio-review/report.json`: preserved earlier full-file audit, 26 verified complete files.
- `.local/audio-review/index.html`: listening review with full-file and startup-only evidence clearly distinguished.
- `scripts/rebuild-download-start.test.ts`: cancellation, full-response rejection and range-size tests.

Full audio files, authentication data and local review notes remain outside git. The worker's existing single-owner Telegram session was used throughout; no new session or external worker deployment occurred.
