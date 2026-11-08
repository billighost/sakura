# Sakura's listening garden

Implemented on 8 November 2026. The product research and source evidence are in
[`PERSONALIZED-FEED-RESEARCH.md`](./PERSONALIZED-FEED-RESEARCH.md) and
[`PERSONALIZED-FEED-SOURCES.json`](./PERSONALIZED-FEED-SOURCES.json).

## Listening and discovery

Home and Discover now share an account-scoped, scrolling song feed. Home keeps
more familiar anchors; Discover increases exploration. Each song has a reason,
play, like and song-menu controls. Artist shelves distinguish actual recent
releases, unheard songs from familiar artists, and returning favourites. Existing
situational mixes and Bloom remain available.

Pages append unique canonical recording IDs without moving earlier songs. Signed
cursors reference bounded, expiring database snapshots. Changes to feed settings,
taste feedback or erased history invalidate those snapshots. Missing or exhausted
candidates have clear refresh and empty states. The feed never fills a page with
duplicate songs. Background catalog refresh uses exact provider identities and
verified ingestion to acquire additional candidates without blocking a page.

The initial candidate pool contains up to 2,500 verified recordings and reserves
space for unfamiliar songs. Further catalog acquisition appears in new feed
selections; an existing scrolling selection stays stable. Availability still
depends on the recording's audio providers.

## One taste model

`recommendations/personalization.ts` is a shared, deterministic ranking and
sequencing engine for feeds, queues and offline planning. It uses explicit likes,
artist/genre seeds, retained listening time, completion and skip history, recency,
and optional local-hour genre evidence. Artist spacing and genre continuity shape
the order. Unknown tags and dates remain unknown.

`app/feedPreferences.ts` owns defaults shared by the client and server:

| Control | Default |
| --- | ---: |
| Discovery | 0.35 |
| Artist variety | 0.65 |
| Repeat tolerance | 0.45 |
| Recent releases | 0.50 |
| Beyond familiar songs | 0.35 |
| Listening rhythm | Enabled |
| Learn from listening | Enabled |

Settings offer presets and individual controls with account-scoped offline
mirrors and server persistence. Preset changes preserve the learning choice.
Private sessions stop new listening records. Pausing learning also prevents new
records and removes listening evidence from recommendation ranking; explicit
likes and selected seeds remain useful.

## Listening journal

The player records actual playing increments, playback position, completion,
skips, source context and occurrence timestamps. Seeking cannot manufacture
listening time or turn a partial play into a completion. Terminal flags commit
once; paused/resumed transport recovery stays within the same event. Receipt
deduplication and existing payload hashes remain compatible.

Profile shows 30-day listening, local-hour habits with genre details, genre
shares, finished-play completion/skip rates, active days, top songs and artists,
and an evidence-based indication of how much history is available. These are
measurements, not prediction-accuracy scores or inferred moods. Lifetime totals
can include preserved imported listening; charts describe retained measurements.

## Smart soundtracks

Home, song shelves, liked songs, collections, downloads and the queue can generate
an ordered soundtrack. Starting one plays its first song; generating a queue
continuation preserves current playback and intentional manual picks. Replies
from an old account, superseded playback choice or erased taste cannot take over.

Collection queues remain within their supplied recording IDs. Downloads queues
verify complete account-owned device blobs before selection and playback, and
work offline through the same local planner. Their queue entries preserve a
local-only constraint across session restoration. Unsaved manual picks are kept
for later rather than introduced into a downloads soundtrack.

## Listener-owned data

Song menus can reduce a song's influence or exclude it for a day, week, 30 days,
or indefinitely. Exclusions remove both recommendation candidates and their
historical contribution to inferred taste while leaving deliberate playback
available. Settings/Profile list choices with undo controls.

Authenticated endpoints expose data export and confirmed clearing of history,
taste choices, or both for seven days, 30 days, or all time. Period clearing removes
whole listening sessions touching that window and reconciles retained summaries.
All-time clearing also removes imported listening aggregates. Undated imported
totals are preserved for period clears and explained in the confirmation dialog.
Likes, playlists, preferences and downloaded audio remain intact.

History reset also removes derived feed/mix snapshots and Bloom stories. Minimal
event/date deletion receipts prevent delayed devices restoring erased history.
Client outboxes and cached taste refresh to the authoritative account state.
Account advisory locks serialize history, feedback, consent, recommendation
generation and persisted Bloom snapshots so erasure cannot race with a new
snapshot of old measurements.

## Voice and interface review

The final copy review covers 27 product files, following
[`SAKURA-VOICE.md`](./SAKURA-VOICE.md). Home returns to “Let the world wait a
little”; Discover uses “A world of good sound”; Profile uses “Your music, over
time”. Invitations to stay and claims about the listener's personality were
replaced with calm introductions and clear action labels. Smart actions use the
ordinary queue icon, without sparkle or glowing decorations.

“Tune your feed” links to the visible feed controls inside Sakura's scrolling
layout. Fragment navigation waits for route content and skips hidden cached
targets; ordinary route scroll restoration remains available. Data clearing
uses a compact, bounded confirmation with the safe cancel choice focused.

## Verification commands

Final verification passed: the core and personalization tests, isolated
PostgreSQL product/data/service cases, account synchronization tests, ten
navigation regressions, TypeScript, ESLint, production build, and 29 browser
acceptance checks. ESLint has no errors and retains 14 existing warnings. The
browser run has no uncaught errors and verifies desktop, dark mode, and 390/320px
mobile layouts. The final voice review found no material wrapping or copy issues.

See [`PERSONALIZED-FEED-VERIFICATION.md`](./PERSONALIZED-FEED-VERIFICATION.md)
for the tested behavior and the boundaries of fixture and live-database evidence.

```powershell
npm test
npm run test:personalization:db
npm run test:sync
npm run test:product
npm run lint
npx tsc --noEmit
npm run build
$env:SAKURA_TEST_URL='http://localhost:3014'
npm run test:personalization:browser
```

The new database tests use isolated schemas and synthetic account fixtures. The
browser acceptance suite uses intercepted APIs and generated audio to verify
playback, scrolling, preferences, exclusions, confirmation dialogs, offline queue
boundaries, and desktop/mobile/dark layouts without changing a real listener.
Local screenshots are under `.local/`.

The additive schema migration has been applied with
`node scripts/rebuild-migrate.mjs --apply`; no existing account or library was
reset. This work is local and has not been deployed.

Mesh persistent memory was unavailable because the installed CLI supports an
older schema than this project's memory database. This document records the
implementation and handoff without modifying that database.
