# Sakura Ink

A fresh music PWA with an ink-and-paper interface, light and dark themes, and a short opening that combines growing branches, gathered petals, bloom, and a passing breeze.

The production frontend is `src/rebuild/app` and `src/rebuild/player`. The replacement catalog, audio resolver, data APIs, and recommendation planner live under `src/rebuild`. The old application UI, player, catalog, downloads, and business logic have been removed.

## Run

```sh
npm install
npm run migrate
npm run dev
```

Open `http://localhost:3000`. Create a fresh account; the old accounts were cleared in the authorized reset.

For production, run `npm run build` and `npm start`.

## Configuration

Server-only environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL database for canonical recordings and account data |
| `AUTH_SECRET` or `NEXTAUTH_SECRET` | Session signing |
| `AUTH_URL` | Public app origin when deployment needs an explicit origin |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Federated Spotify catalog search and exact lookup |
| `TELEGRAM_WORKER_URL`, `WORKER_SECRET` | Connected single-owner audio worker and matching bearer secret |
| `TELEGRAM_BOT_USERNAME` | Primary source chat |
| `TELEGRAM_FALLBACK_BOTS` | Optional comma-separated fallback chats for the v2 worker |
| `SAKURA_REBUILD_AUDIO_ORIGINS` | Allowed HTTPS audio CDN origins |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional immutable, checksum-verified audio on the existing CDN account |
| `YOUTUBE_API_KEY` | Optional public YouTube playlist import |

No browser bundle receives provider credentials. Keep environment files and `.local/` private. Start only one process that owns a Telegram session; the Next app calls the existing worker rather than opening its own session.

## Product

Main routes: `/home`, `/discover`, `/search`, `/library`, `/liked`, `/library/downloaded`, `/playlist/[id]`, `/mix/[id]`, `/album/[id]`, `/artist/[id]`, `/track/[id]`, `/profile`, `/settings`, `/onboarding`, `/import`, `/offline`, `/bloom`, and `/bloom/[id]`. Public song and lyric cards use `/s/[slug]`. The full player and lyrics occupy the viewport. Song options appear in an anchored popover, including on a touch hold; the queue and sharing use bounded dialogs.

Sakura Bloom has weekly, monthly and yearly listening stories. Completed years remain in the archive, and the three artistic directions rotate through production stories. Home and Discover offer 20 situational mix definitions; Downloads builds 18 situations exclusively from complete device files. Sparse collections explain what is missing rather than repeating songs to fill them.

Home and Discover also offer personalized scrolling song feeds with recommendation reasons, artist/release shelves and configurable familiarity, artist variety, repeats and discovery. Smart soundtracks use the same listening evidence in Home, collections, liked songs and the queue; downloads soundtracks use only verified device files and work offline. Profile shows listening charts and genre/hour habits. Listeners can pause learning, exclude songs temporarily or indefinitely, export their personalization data, or clear selected history and taste choices with confirmation. These features use an additive migration and preserve existing libraries.

See [the discovery research](docs/rebuild/PERSONALIZED-FEED-RESEARCH.md), [implementation details](docs/rebuild/PERSONALIZED-FEED-IMPLEMENTATION.md), [verification results](docs/rebuild/PERSONALIZED-FEED-VERIFICATION.md), and [Sakura's voice guide](docs/rebuild/SAKURA-VOICE.md).

A canonical recording UUID identifies the exact recording; external provider appearances are references. Queue occurrences have their own IDs. Favorites and playlists can index catalog metadata without waiting for an audio download. A device download becomes ready only after complete-byte verification and SHA-256 hashing. Device data and cached resources are scoped to the account. Paused and buffering time is excluded from listening receipts.

Public playlist import previews metadata before creating a collection. Sharing prepares actual PNG images, public links, and WebCodecs video with actual selected audio when the browser supports the encoders. Unsupported video stays unavailable.

## Verification

```sh
npm test
npm run test:product
npm run test:personalization:db
npm run test:personalization:browser
node scripts/rebuild-export-smoke.mjs
```

The interaction checks use a running development server (`npm run dev -- --port 3027`) and synthetic browser fixtures. Run the checks in another terminal:

```powershell
$env:SAKURA_TEST_URL="http://127.0.0.1:3027"
npm run test:interactions:browser
node scripts/rebuild-japanese-reading-browser.mjs --viewport
node --import tsx scripts/rebuild-lyrics-live.ts
```

The live lyric check invokes the actual backend route over local HTTP, simulates primary-provider misses, and calls `lyrics.ovh` for real. See [interaction verification](docs/rebuild/INTERACTION-CONTINUATION.md) for the full scope.

The real Ink smoke (`npm run test:ink`) uses a private temporary account created by `node scripts/rebuild-test-session.mjs`. Its screenshots and reports stay under ignored `.local/`. Tests that access providers can fail when those external services are unavailable; fixture regressions are separate from live-provider evidence.

See `docs/rebuild/PRODUCTION-DATA.md`, `AUDIO-AUDIT.md`, `LYRICS-AUDIT.md`, `UI-VERIFICATION.md`, and `PRODUCT-AUDIT.md` for contracts, reset evidence, and operational limits. Live checks verify Finesse original, its Cardi B remix, INERTIA and Ye by exact catalog evidence, returned file tags, complete checksums, decoder duration and browser playback. They are not acoustic-fingerprint certification. The 30-song Japanese lyric corpus preserves source text/timing; rare poetic readings remain flagged for review.

## Data reset

The authorized reset removed old application rows, including accounts and listening history. A private earlier snapshot remains ignored and was not imported. Fresh migration installs the new schema; fresh catalog seeding uses exact online provider metadata. Reset is a separate explicit CLI operation (`scripts/rebuild-migrate-reset.mjs`) with target/inventory verification; no web endpoint resets or migrates the database.
