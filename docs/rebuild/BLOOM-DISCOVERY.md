# SakuraBloom and situational discovery

This implementation uses the actual audible increments Sakura records. It does
not substitute recording duration for listening time, infer a listener's mood,
invent demographic rankings, or make up period comparisons.

## Research verified on 7 November 2026

| Official reference | Verified behavior | Sakura decision |
| --- | --- | --- |
| [Spotify Wrapped](https://support.spotify.com/us/article/spotify-wrapped/) | Annual personalized listening presentation. | Offer an artistic yearly listening story and a completed-story archive. |
| [YouTube Music Recap](https://support.google.com/youtubemusic/answer/11418178?hl=en) | Yearly and seasonal personalized playlists and statistics use listening history; minimum history is required. | Treat a period with no recorded listening as empty, with a clear explanation. Do not copy another product's eligibility thresholds. |
| [Apple Music Replay](https://support.apple.com/en-us/109356) | Top songs, artists, albums, genres and stations use history, plays and time spent listening. Monthly/year-end insights and weekly updated playlists are available. | Calculate time, play count, distinct recordings and active days from the ledger; rank a song or primary artist using audible time. |
| [Bandcamp Daily](https://daily.bandcamp.com/) | Genre navigation, Essential Releases and Scene Reports provide multiple discovery entry points. | Present distinct genre and recording-version situations, each with an explicit metadata rule. |

The guessed Spotify daylist link returned 404. Spotify's guessed made-for-you
URL returned an HTTP 200 error page, and Bandcamp Discover returned a browser
challenge. Those pages are **unverified** and were not used as evidence. The
research script detects soft error pages rather than treating every HTTP 200 as
successful verification. Its local report is `.local/rebuild-research/discovery.json`.

## Calendar and chapters

`Africa/Lagos` is the default. An optional validated IANA timezone setting controls
local calendar boundaries. Weekly periods begin Monday and open after that week
ends. The completed week remains available Monday through Saturday and closes at
Sunday 00:00. Monthly periods open on the next month's first day and close seven
calendar days before the following first day. A completed year's recap opens on
January 1, remains available that year, and enters the archive if completed.

The server rejects access before publication (423) and after expiry (410).
Chapter reveals are sequential and idempotent; completion requires every chapter
to have been revealed. Unrevealed chapters expose their prompts, but hide the
stat and related recording. A nonempty story is captured on first open so its
chapter contents remain consistent across devices and reveal retries. Empty
periods are not frozen, so delayed offline listening can still create a story
during its availability window. Completed yearly stories remain accessible via
the archive endpoint after the normal opening window ends.

Audible increments optionally carry `occurredAt`, captured when the device
records the increment. This attributes delayed sync to the listening period
instead of the upload date. Existing clients and receipt hashes remain supported
when that field is absent. Old receipts use their recorded server creation time.
Increment timestamps are bounded and cannot lie in the future. A chunk is
attributed to its captured occurrence timestamp; a chunk spanning midnight is not
split into inferred wall-time segments.

Statistics describe this installation's retained history. The implementation
does not claim that a song was newly released just because it was first heard
here. Artist time uses primary credit to avoid multiplying the same listening
minute across collaborators. Genre time uses the first published genre tag and
does not claim to infer the acoustic characteristics of the recording.

## Mixes and artist identity

Twenty definitions cover everyday discovery, unfamiliar artists, unheard songs
from familiar artists, repeats, eight genre groups, a twenty-minute break,
acoustic/instrumental/live versions, favorites, forgotten favorites, recent first
listens and actual late-night history. Every ready mix has unique canonical IDs,
artist concentration limits and at most 20% overlap with any earlier ready mix,
measured against the shorter mix. Sparse candidates produce an insufficient
state; no duplicate filler or guessed tempo/mood label is added.

The pure offline planner uses only supplied local recording cards. The API takes
only requested canonical IDs and applies the account's likes, explicit-content
and feedback filters. Device code still verifies actual ready blobs before
playback because a server cannot prove local file availability from an ID list.

Artist cards group identical normalized display names into one selection with
stable provider keys and retained alternative references. This is display
grouping, never a durable merge of same-name artist identities. Exact optional
onboarding references prevent duplicate names from selecting multiple rows.
Recording cards expose each contributor's role, provider reference and canonical
artist ID when available. Commas inside an artist name are preserved.

All database changes are additive. No existing account, favorite, listening
total, download or playlist is reset by these features.

## Verified playback and cache boundaries

Canonical recording cards can carry a ready CDN source only for a public,
ready, full asset with a matching retained public source, byte count and SHA-256.
The projection requires the checksum verification marker and the exact versioned
Cloudinary path for the configured cloud, canonical recording and checksum. It
rejects transformations, query parameters, private assets and mismatched recording
versions. Its fallback addresses the same asset through the authenticated audio
gateway; it does not pick another version.

The isolated PostgreSQL product test covers valid public projection and rejection
of private owner assets, missing verification, wrong variants, wrong clouds and
unversioned URLs. It passes and cleans its owned fixtures. A separate read-only
projection check passes for the four promoted recordings: original Finesse,
Cardi B remix, INERTIA and Ye. Byte verification before and after promotion is
performed independently by the audio pipeline, rather than inferred by these
metadata projection checks.

The shared resource cache now discards responses from an invalidated generation,
coalesces refresh requests, serializes persisted writes and invalidations, and
clears stale snapshots after definitive missing or session responses. Expired
Bloom recovery, account-switch isolation and the browser invalidation race pass
the checks documented in `UI-VERIFICATION.md`.
