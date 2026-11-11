# Sakura PWA upgrade and verification

Work completed on 11 November 2026 in the shared Sakura checkout, preserving the preceding agent's pushed repairs.

## Result

- The brand is a detailed SVG blossom with notched petals, veins and stamens; installed-app icons are generated from the same code. The opening draws an articulated tree, blooms 66 flowers, and carries 16 detached petals through a viewport-sized wind field. Skip, Escape, reduced motion and the once-per-tab preference remain available.
- Offline navigation renders the existing music screens through the native History API when Next's server navigation is unavailable. The service worker prepares visited documents and their dependencies, keeps cold deep links under their requested URLs, and preserves playback through Downloads, Search, Discover, artist and album navigation.
- Successful artwork, catalog/search results, lyrics, generated reading languages and synchronized lyric results reuse persistent identities across consumers and reopening. Mutable feeds still refresh; failed refreshes keep their saved fallback. Account changes and explicit erasure cannot reuse another account's data or resurrect deleted explanations.
- Plain lyrics and confirmed missing-lyrics results check for updates every seven days, sharing one request across consumers. Provider checks have a separate timestamp, so generating readings does not postpone the next lyric check. Age never removes a saved copy: a six-month-old plain lyric and its reading guide remain usable offline, and failed refreshes preserve them. Synced lyrics stay cached until an explicit refresh or a changed version.
- Listening uses durable event/sequence journals and explicit receipts. Favorite operation journals and a server receipt ledger preserve concurrent edits and prevent an old retried like from undoing a newer unlike. Queue and preference checkpoints retain their pending state until accepted. Independent sync categories retry on reopening, focus, foreground and reconnection.
- Playback choice timestamps are distinct from passive position checkpoint timestamps. A later checkpoint from an older playing device cannot overwrite a newer explicit song or seek choice on another device. Reserved ordering metadata lives in the existing session JSONB state and is stripped from public responses; no new session table migration is needed.
- Automatic queues prepare personalized continuations ahead of the last song, preserve intentional queue choices and rank downloaded songs when offline. Native media playback stays active during transitions; complete next-track bytes can be attached synchronously from a prepared local URL. Audio-session ownership and Web Audio interruption recovery keep the existing media element rather than reloading it. Explicit pause and lyric timing capture take precedence over continuation.
- Mobile track metadata keeps artist and album links on one subdued line. Download activity uses one botanical progress and pause/resume/retry control. The modal backdrop loses its blur as soon as closing starts; route transitions also no longer introduce blur.
- The fullscreen lyric studio supports editing, importing, exporting, draft recovery, a playback preview and manual line timing. Timing uses the media clock, restarts the song, and holds the selected song at its natural end for review. Publication requires an explicit action.
- LRCLIB challenge solving runs in a cancellable browser worker instead of exhausting the server request deadline. Publication validates exact recording metadata first, handles rejection/rate limits, and treats upstream acceptance as success even when indexing is delayed. Early title search and strict submitted-content readback handle newly indexed records without accepting another recording.

## Research

The installed Next.js 16.4.5 guides were read before implementation. Findings, source links and assessed additional PWA features are recorded in:

- [PWA and offline navigation research](../pwa-offline-research.md).
- [Durable sync and conflict policy](../offline-sync-research.md).
- [LRCLIB publishing protocol and timeout research](../lyrics-publishing-research.md).

## Verification

The final current-source `npm test` run passed **714 tests** and `npm run test:sync` passed **78 tests**. TypeScript passed; ESLint reported **zero errors and 15 existing warnings**. The production Next build passed compilation, TypeScript and all **62 pages**; all **seven actual service-worker browser journeys** passed with zero page errors. The additional provider/sync run passed 174 tests, its coordinator run passed 29, and outbox/evidence passed 23. Seven malformed-success favorite receipt cases verify that the original operation remains durable, replays with the same identity, and is retired only by a matching accepted receipt. Isolated browser fixtures use synthetic account APIs and generated audio; they clean up their temporary app routes.

Local evidence:

| Area | Evidence |
| --- | --- |
| Production offline pages, links, history, artwork and reconnection | `.local/pwa-offline-browser-report.json` |
| Shared persistent resources; cold reload with zero provider requests; retention of 150 lyric entries | `.local/resource-cache/report.json` |
| Cold Home/Discover feed and hero restoration; erasure and reconnect | `.local/offline-feed/report.json` |
| Eleven actual song endings, including five offline cycles; manual choices and pause | `.local/autoplay-browser-report.json` |
| Tree growth, flowering and fullscreen wind at desktop, 390px, 320px, landscape and dark theme | `.local/opening-art-review/report.json` |
| Compact track metadata and real download pause/resume/cancel at 320px, 390px and desktop | `.local/mobile-download-layout/report.json` |
| Lyric editor, playback preview, manual tap timing and two intercepted publications | `.local/lyric-studio-review/report.json` |
| Actual worker proof correctness, UI responsiveness and deadline on Chrome/WebKit | `.local/lyric-publish/report.json` |
| Weekly plain/missing updates; six-month-old offline copy retained; year-old synced copy retained | `.local/lyric-cache-policy/report.json` |

Reproducible commands are available as `test:pwa:browser`, `test:pwa:ux` and `test:lyrics:studio:browser`. The PWA browser test requires a production server; UX fixtures require a development server. Set `SAKURA_TEST_URL` to the corresponding server URL.

## Authorized live publication

At the user's explicit request, Sakura's authenticated search/index/challenge/publish API published the supplied plain lyrics for **Never Be Friends (feat. Josh Arce)** by **Norhan, Mawi and Josh Arce**. The verified catalog identity is Deezer **2263276967**, ISRC **QZK6Q2365622**, duration **157 seconds**, Sakura recording **071de023-d226-4219-8970-7ba12d8034ad**.

The one accepted upload is LRCLIB record **40279485**. Public search readback and Sakura's lyrics endpoint both returned the supplied text unchanged: **1,710 characters and 85 lines**, including the final newline. SHA-256: `8dec832b389cacc5fde0e783ccc6808a6ba0dfdd1c3fac4a6290356c13611bfa`. No timestamps were invented and the accepted upload was not resubmitted. Evidence is in `.local/never-be-friends-publication-report.json`; it contains no account secrets.

The current hosted release at `https://sakuraplayer.vercel.app` was tested in a fresh authenticated API context. It returned HTTP 503 both ordinarily and with `refresh=1`; its new worker URL also returned 404. This rules out the browser's saved lyric copy as the sole cause and confirms the deployed application still predates these fixes. Evidence is `.local/never-be-friends-deployed-lyrics-report.json`. Local successful readback and the public LRCLIB publication are distinct from deploying the application changes.

## Release and handoff

After the user requested the GitHub push, the existing `npm run migrate` workflow successfully installed the additive schema in the configured database, including `sakura_v2."FavoriteOperationReceipt"`. It reported `legacyDataChanged: false`; no reset or destructive migration was performed. Apply the same migration before releasing this code to any other database.

The public lyric submission was explicitly authorized. Application code is prepared in the checkout; deployment is a separate release step. Physical iPhone background playback has not been tested: desktop browser visibility, native audio transitions and available browser engines were verified. Persistent storage reduces eviction risk, but browsers and users can still clear site data. Missing undownloaded audio continues to require a connection.

The user also requested workspace cleanup. Owned verification servers were stopped, but automatic approval review rejected deletion of the generated `.next-pwa-dev` directory with `blocked by policy`, including a narrowly scoped attempt against its verified absolute path. Disk cleanup therefore remains outstanding. Generated Next builds, incremental files, screenshots and logs remain local and excluded from Git; source, reusable tests, submitted lyric text, configuration and database/download records were preserved.

Handoff: the PWA, visuals, cache, offline sync, continuous playback, mobile layout and lyric studio changes are implemented and covered by the retained checks. The user authorized committing and pushing the complete source changes to GitHub. Preserve the operation receipt migration and the publication's exact verified recording identity when releasing.
