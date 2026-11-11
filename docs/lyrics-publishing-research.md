# LRCLIB publishing repair

Research checked on 11 November 2026:

- [LRCLIB's current API reference](https://lrclib.net/docs.md) requires a fresh, single-use `X-Publish-Token`; challenges expire after five minutes. `201 Created` confirms publication. A subsequent delayed lookup does not mean the publication failed.
- [LRCGET's official solver](https://github.com/tranxuanthang/lrcget/blob/main/src-tauri/src/lrclib/challenge_solver.rs) hashes the prefix concatenated with a **decimal** nonce and compares the 256-bit SHA-256 digest to the supplied target.
- The live challenge endpoint returned target `000000FF00000000000000000000000000000000000000000000000000000000`. Its expected work is approximately 16.8 million hashes. A local Node benchmark measured approximately 260,000 hashes per second, so average solving time exceeds the old 25-second budget and approaches/exceeds a 60-second server request lifetime. This explains frequent upload failure; extending a spinner alone would not fix it.
- LRCLIB documents `IncorrectPublishTokenError`, `ValidationError`, `429` with `Retry-After`, and possible non-JSON edge failures. Client errors now distinguish these cases without displaying raw upstream HTML.
- The installed Next.js 16.4.5 route-handler guide was reviewed before changing endpoints. Publishing and challenge endpoints use authenticated, uncached POST requests, check request origin and account ownership, and keep upstream calls on the server.

The new flow validates recording details and LRC before preparing a challenge, computes the proof in a cancellable browser worker with a four-minute limit, then submits the prepared token through the existing verified-recording publication endpoint. The worker keeps the interface and music responsive. The public lyric studio explicitly starts publication and retains its device draft if work expires, is cancelled, or the connection fails. The helper never automatically republishes an uncertain upload.

Thirteen focused tests verify native SHA-256 parity across block boundaries, official nonce format, validation before upstream traffic, exact plain-text preservation, cancellation, accurate rejection, rate limits, confirmed publication with delayed indexing, and server cache refresh policy. Chrome and WebKit independently verified a real worker proof with WebCrypto, observed responsive main-thread timers during work, and verified bounded expiry. See `scripts/rebuild-lyric-publish.test.ts`, `scripts/rebuild-lyric-publish-browser.mjs`, and `.local/lyric-publish/report.json`. Tests use synthetic challenges and mocked upstream publication; no test lyrics were posted to the public database.

The user separately authorized a real publication of their supplied plain lyrics for **Never Be Friends (feat. Josh Arce)**. The Deezer catalog verified Norhan, Mawi and Josh Arce, album/title identity, 157-second duration and ISRC `QZK6Q2365622`. Sakura's authenticated challenge/publication flow published that exact recording once, and LRCLIB's public search returned record `40279485` with all 1,710 source characters, 85 lines and the final newline unchanged. Its signature and ID lookup initially returned 404 even while title-only search exposed the full new record. Discovery now tries title-only search early and still verifies every returned recording's title, artist, album, duration and edition; publication readback also searches by title and accepts only the exact submitted lyric content. Sakura then returned the same LRCLIB record with the full three-artist identity, proving the feature works beyond the upload response. Evidence is in `.local/never-be-friends-publication-report.json` without account credentials.

Limits: challenge solving can take time on slower phones and can still expire; the editor keeps the draft for retry. The browser worker eliminates the server's short proof-of-work deadline rather than claiming LRCLIB or the device always finishes within a fixed duration.

## Deployed app and cache audit

The user reported that their current deployed app still did not show the uploaded lyrics. A fresh authenticated API context tested the exact current lyric query, including all three artist credits, album, 157-second duration and `version=Original recording`:

| Target | Ordinary request | Explicit `refresh=1` |
| --- | --- | --- |
| `https://sakuraplayer.vercel.app` as deployed on 11 November 2026 | 503, approximately 24 seconds | 503, approximately 24 seconds |
| Latest local code | 200, LRCLIB `40279485`, exact 85 lines | 200, LRCLIB `40279485`, exact 85 lines |

The deployed response reported unavailable providers, and `/lyric-publish-worker.js` returned 404, confirming that this deployment did not contain the new publication/discovery code. These requests used a new authenticated API context and bypassed the page's cache: the older deployed server's late title search was the decisive failure. Clearing browser caches alone could not fix that server implementation. The metadata-only audit is saved in `.local/never-be-friends-deployed-lyrics-report.json`; authentication values are excluded.

The requested cache policy now applies on the server as well as the client: validated synced lyrics remain reusable; plain lyrics and confirmed missing results expire after seven days; explicit refresh bypasses either policy immediately. Provider outages are never stored as confirmed missing results, and an outage cannot erase a previous verified lyric. These are bounded in-process server caches; the persistent browser cache supplies continuity across app visits and server restarts.
