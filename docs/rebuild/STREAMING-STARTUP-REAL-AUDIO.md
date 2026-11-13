# Real-song streaming startup verification

The live transfer audit downloaded complete public, previously verified Finesse by Bruno Mars, INERTIA by SawanoHiroyuki[nZk] and REI, and Ye by Burna Boy on 13 November 2026. Every file matched its stored canonical byte length and SHA-256, passed the existing embedded metadata/container checks, and decoded completely with FFmpeg using `-xerror`. No user account, library, listening history, catalog ingestion, bot search, deployment or database write was required.

These are 44.1 kHz stereo MP3 files with embedded JPEG artwork. Their leading ID3 tags end at byte 159,628 for Finesse, 334,168 for INERTIA, and 75,074 for Ye. The first 32 and 64 KiB contain metadata and artwork rather than playable audio. Treating a successful 4 KiB transfer as playback startup therefore concealed a real container-level delay.

| Song | Complete bytes | Leading ID3 bytes | Verified complete SHA-256 |
| --- | ---: | ---: | --- |
| Finesse | 7,802,010 | 159,628 | `c39fec009224ce6f42fb43fc8f6290d75ff19d0d9cf432348a941785760c29aa` |
| INERTIA | 8,316,270 | 334,168 | `ab6be93def6032314b73b743dfa0c07da9885745c555c5c202a802ba2fc69a9f` |
| Ye | 9,342,273 | 75,074 | `40b45a7f60fa5866e9ca08914722f1d1830377849d73397bf48ceb61acbac62e` |

The three initial complete CDN transfers took 79.351, 23.517 and 15.855 seconds respectively. These are individual network samples rather than production percentiles. Subsequent exact 32 KiB ranges beginning after each ID3 block matched the corresponding bytes of the verified complete files and produced roughly 0.8 seconds of PCM. Those sparse checks completed in 423, 215 and 176 ms, including the local FFmpeg probe; response headers arrived after 249, 62 and 78 ms. The configured worker could not serve the historical v1 asset preflight, so real-file validation used the existing byte-identical immutable CDN assets.

`scripts/rebuild-real-audio-startup.mts --live` reads only existing public canonical assets and records real source ranges, complete transfers, checksums and decoder evidence. Complete local files are reused only after their size and checksum match; they are decoded and inspected again. `--audio-opening-only` probes the real sparse opening without repeating complete downloads. Private files and the detailed report stay under `.local/real-audio-startup`, which is excluded from source control.

`scripts/rebuild-real-audio-startup-browser.mjs` uses the actual Next MusicProvider, native Chrome MP3 decoder and production service worker. It replays these same checksum-verified complete songs through a controlled 64 KiB/s response stream. Account and API state is synthetic and stays within a private fixture boundary. Each song runs in fresh browser storage for both play-triggered work and manual-download-then-play. It records source hashes, network ranges, bytes sent at the first `playing` event, media events, saved fragments and whether the complete offline save existed at startup.

The optional continuity gate requires fifteen seconds of advancing native playback with no waiting underruns, then seeks near the actual end and requires playback to resume. This combines real song/container data with a repeatable slow delivery test; it does not claim that a replay measures current production network latency or physical AirPods behavior.

Run against a local Next server. In development, use the `localhost` upstream because Next 16.4 restricts HMR upgrade origins. The browser fixture itself uses an isolated loopback origin and forwards only read-only application resources; API writes are modeled locally.

```powershell
node --import tsx scripts/rebuild-real-audio-startup.mts --live
$env:SAKURA_TEST_URL = 'http://localhost:3000'
$env:SAKURA_REAL_AUDIO_CONTINUITY = '1'
$env:SAKURA_REAL_AUDIO_REQUIRE_FAST = '1'
$env:SAKURA_REAL_AUDIO_COMPLETE_SAVE = '1'
node scripts/rebuild-real-audio-startup-browser.mjs
```

The first integrated sparse-ID3 attempt exposed another delay: INERTIA received 32 KiB of genuine MPEG audio promptly, but Chrome did not emit metadata until the next enclosing 256 KiB original chunk completed. It started after 5.271 seconds. That observation required a further sparse continuation change; publishing the first audio fragment alone does not prove that the native decoder can start or continue without waiting.

The following attempt could start INERTIA promptly but still exhausted its initial audio after 3.953 seconds of media time, waiting 880 ms for a later full chunk. The test kept its no-underrun assertion. Publishing successive 32 KiB fragments throughout the existing bulk responses fixed that observed stall. The failed report remains `.local/real-audio-startup/sparse-window-underrun-report.json`; it is evidence of why the second change was required.

## Completed browser verification

The frozen client implementation passed all six original-file cases at 64 KiB/s per response. All started while the original first 256 KiB chunk was incomplete and before a complete offline save existed. Each native media element advanced continuously for fifteen seconds with no `waiting` events during ordinary playback, then successfully resumed near the end of the recording. Times are individual samples; the report records source hashes and the full request/event sequence.

| Song | Action | First `playing` | Total source bytes at startup | Full file fraction | Tail seek resumed |
| --- | --- | ---: | ---: | ---: | ---: |
| Finesse | Play | 4.106 s | 425,984 | 5.46% | 4.094 s |
| Finesse | Manual download, then play | 1.241 s | 278,528 | 3.57% | 4.434 s |
| INERTIA | Play | 2.963 s | 425,984 | 5.12% | 4.881 s |
| INERTIA | Manual download, then play | 2.168 s | 491,520 | 5.91% | 4.338 s |
| Ye | Play | 2.055 s | 278,528 | 2.98% | 4.030 s |
| Ye | Manual download, then play | 1.745 s | 311,296 | 3.33% | 3.711 s |

The INERTIA manual case then accelerated only the remaining replay delivery to complete the save. The actual IndexedDB Blob contained all original 8,316,270 bytes and matched the canonical complete SHA-256. With the browser offline, a fresh native Audio element decoded that saved Blob, advanced beyond one second, retained the correct full duration and reported no media error. This verifies that the playback view omitted artwork without modifying or truncating the completed download.

Two additional native application cases passed:

- An actual upstream INERTIA case fetched real, exact public CDN ranges through the fixture transport rather than replaying the local file. It started after 3.861 seconds at 655,360 received bytes, played continuously for fifteen seconds without underruns, and resumed a near-end seek after 2.181 seconds.
- A derived INERTIA fixture removed the leading ID3 tag after verifying the original complete file, then used a separate synthetic asset ID and checksum. The zero-offset audio case started after 3.485 seconds at 196,608 bytes, played continuously for fifteen seconds and resumed its near-end seek after 3.019 seconds. It demonstrates the same fragment path for an MP3 without leading artwork; it is not presented as another canonical provider file.

The existing private synthetic account session also remained valid for a read-only request to the actual Next audio gateway. `GET /api/v2/recordings/{INERTIA recording ID}/audio?assetId={public CDN asset ID}` with `Range: bytes=334168-366935` and `X-Sakura-Playback: 1` returned 206 and the exact original 32,768 bytes, canonical total size, MIME type and sparse SHA-256. Headers arrived after 5.015 seconds and the complete range after 5.180 seconds in that sample. Next used a chunked response and omitted optional Content-Length, so the check validated the actual body length. No cookie or token was included in the report.

Reports:

- `.local/real-audio-startup/browser-report.json`: six original-file cases and complete manual save/offline evidence.
- `.local/real-audio-startup/live-upstream-browser-report.json`: actual upstream ranges and native application playback.
- `.local/real-audio-startup/untagged-browser-report.json`: derived zero-offset MP3.
- `.local/real-audio-startup/gateway-report.json`: real authenticated Next gateway, exact public asset bytes.

For the extra cases, select INERTIA/play and set `SAKURA_REAL_AUDIO_LIVE_SOURCE=1` for real upstream transport, or `SAKURA_REAL_AUDIO_STRIP_TAGS=1` for the derived tag-free replay. These modes are mutually exclusive. The ordinary npm entry points are `test:downloads:real` for the provider audit and `test:downloads:real:browser` for the six-case replay.

The final provider-slot and bulk-boundary change received a separate INERTIA application check after the client and backend were frozen again. At the same controlled 64 KiB/s response rate, it emitted `playing` after 3.001 seconds at 212,992 total source bytes (2.56% of the original file), while the first 256 KiB chunk remained incomplete and before a complete save existed. Native playback advanced 15.124 seconds during the continuity interval with zero waiting underruns, then resumed the near-end seek after 4.455 seconds. It reported no media errors, alerts, page errors or unexpected API writes. `.local/real-audio-startup/post-boundary-inertia-browser-report.json` records this final code's source hashes and full event/range sequence; the six-case, complete-save/offline, live-upstream and derived-file results above remain separate evidence from the preceding frozen implementation.

## Final integration checks

The final frozen code passed `npm run test:downloads` (359 application tests and 71 worker tests), `npm run test:performance` (221 tests), and `npm run test:pwa` (183 application tests and 47 synchronization/journal tests). All completed with zero failures or skips. The strict server runner separately passed 104 tests, and the focused Cloudflare transport batch passed 13 tests.

`npm run lint` completed with zero errors and 23 existing warnings. An isolated production build using `SAKURA_BUILD_DIR=.next-performance-prod` completed successfully, including TypeScript and all 65 static-page generation steps. Prerendering logged handled product and lyrics data-read errors; the build still exited zero. Build output and test logs remain private under `.local/playback-fix-*.log`. No source dependency or lockfile changes were needed. These checks verify the local implementation; physical iPhone/AirPods output switching is still unverified as described in `AUDIO-OUTPUT-STABILITY.md`.
