# Sakura Ink implementation

The selected Ink design is now the production application. The earlier application UI, player, catalog, download code and generated Prisma business models were removed. New app pages, authentication, shell, player and APIs are independent implementations under `src/rebuild` and the new App Router groups.

## Interface and flows

The shell keeps one player alive across pages. Home, discovery, search, artist/album/recording details, mixes, playlists, favorites, downloads, import, onboarding, profile and preferences use real account data. Dialogs cover the full player, queue, lyrics, song actions and image/video/link sharing. Public cards retain the canonical recording. Library pages have explicit pagination rather than hiding later songs. New playlist creation opens that playlist; page navigation uses scoped cached data and restores scroll.

The opening combines branch growth, gathered petals, ink bloom and passing breeze. Its complete parent sequence lasts 3.2 seconds, runs once per session, supports Skip/Escape, and honors system and app reduced motion. Replay it from settings. Both appearance modes are supported, including dialogs and export cards. Installation icons use the new vector blossom.

## Playback and data

Canonical UUIDs identify recordings, provider references identify catalog appearances, queue occurrences have independent IDs, and local downloads have canonical device keys. Audio matching retains version/featured credits, validated duration and exact provider/ISRC evidence. Search can find original Ye through the catalog fallback without treating a cover as the original.

Ready audio streams immediately through its verified source. One following queue source is warmed during playback. Failed or silent direct streams retry the **same recording and asset** through the authenticated gateway; a progress-reset 12-second watchdog handles connections that never emit a media error. Uncertain sources remain review/unavailable. Offline files become ready only after complete byte-count verification and SHA-256 hashing. Paused/buffering time is excluded from incremental listening receipts; background media-time progress is preserved and long increments split into bounded idempotent chunks.

The authorized old-data reset cleared 48 application tables and reconciled counts to zero. Old accounts/listening history were not restored. Fresh registration and metadata seeding start new account/library identities. Earlier private snapshots and test artifacts remain ignored.

## Providers and infrastructure

| Service | Actual role |
| --- | --- |
| Deezer public API and image CDN | Catalog search, exact recording metadata, artist/album images |
| Spotify Web API and image CDN | Server-side catalog fallback and exact metadata; no Spotify audio streaming |
| LRCLib | Exact/validated synchronized and plain lyrics |
| Telegram / connected source worker | Full audio retrieval and ranged delivery |
| Cloudinary, existing Free account | Immutable full audio after complete source and CDN checksum verification; Telegram remains the fallback |
| Kuromoji IPADIC and WanaKana | Local Japanese morphology and romanization; no paid language API |
| Neon PostgreSQL | Account/library data, canonical identity, listening receipts and audio jobs |
| Render | Existing single-owner audio worker, retained at the user's request |
| Google Fonts via next/font | Inter and Fraunces fetched at build time and served locally |
| Public Spotify, Deezer and YouTube playlist sources | Explicit playlist-link import; optional YouTube Data API quota when configured |

No paid music or lyrics API was added. Spotify is metadata fallback, not an audio subscription integration. Actual hosting plan billing is external account state; the user explicitly retained the existing Render fallback. Next runs locally for review; the new worker v2 source is ready, while the connected deployment currently uses validated v1 compatibility.

## Validation and limits

Production builds on Next 16.4.5. Critical/high production dependency findings were patched; `npm audit --omit=dev` returns zero. Moderate findings remain in development-only ESLint transitive tooling. Scoped application lint has no errors; warnings identify intentional remote images, long-lived player refs and effect callbacks.

Evidence is split between pure regressions, isolated PostgreSQL/HTTP checks, mocked browser dialog fixtures, live provider checks and full-file/audio decoder checks. See the existing per-area audit and JSON reports for their scope. The 30-song Japanese corpus preserves text/timing and improves contextual readings; rare singer-intended/poetic pronunciations still need review. This is not a claim of perfect automatic romanization or acoustic fingerprint certification. New audio preparation and external service outages can still cause cold-start delays; ready-source latency and offline playback are tested independently.
