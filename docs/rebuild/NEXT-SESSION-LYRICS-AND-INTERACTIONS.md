# Prompt for the next Sakura session

Copy the text below into a new coding session in
`C:\Users\bb201\Desktop\sakura`, or ask that session to read this file and carry
out the request.

---

Please investigate and fully fix Sakura's lyrics, player interactions, album
navigation, collection artwork and collection searching. Reproduce the actual
problems, explain their root causes, implement durable fixes, run meaningful
regressions and browser checks, and commit/push the completed changes to GitHub.
Do not stop at a plan or patch just the named song. Investigate the current
implementation yourself; the pointers below are starting evidence, not a
prescribed solution.

Work in `C:\Users\bb201\Desktop\sakura`. Read the repository's AGENTS.md and
the relevant installed Next.js guides in `node_modules/next/dist/docs/` before
editing code. Check the current Git state and preserve other work. Apply the
Mesh skill if available; it was unavailable during this handoff because the
client supported schema 3 while the database was schema 6. Do not wipe or
downgrade its database to make it work.

## 1. Lyrics that exist but are not found

Some songs have lyrics available elsewhere, but Sakura says it cannot find
them. Find representative real failures and trace the entire request: recording
metadata, query construction, provider responses, candidate selection,
edition/version checks, lyric parsing, timeouts, retries, background jobs and
both server and device caches. Determine whether the issue is coverage,
search strategy, missing metadata, matching, premature rejection, stale
negative caches, or transport failure.

Try a bounded set of useful search variants before declaring lyrics missing:
title with the primary artist, title with individual credited artists,
appropriate album information, original-language and verified alternate titles,
and normalization of punctuation, Unicode, feature credits and catalogue-added
descriptions. Keep significant recording distinctions such as live, remix,
instrumental, acoustic and sped-up. Search more broadly while preserving
verification. Do not remove matching gates indiscriminately or return another
performer's song, an unrelated same-title song, or vocal lyrics as verified
lyrics for an instrumental recording. Offer verified plain lyrics when synced
lyrics are unavailable. Distinguish a provider outage from a proven absence.

Research additional free lyric providers if existing coverage is inadequate.
Use current provider documentation and verify credentials/card requirements,
limits, language coverage and practical availability. The user has no payment
card or paid-service budget. Demonstrate improved discovery on several real
examples plus negative examples that still reject wrong recordings. Document
any gaps that third-party availability prevents you from fixing.

Starting points: `src/rebuild/lyrics/{service,provider,request,fallbacks}.ts`,
`src/rebuild/player/useLyrics.ts`, lyric API routes, matching and caches.

## 2. Missing Chinese transliteration/reading guide

The reported title is:

`众里寻他千百度(电视剧《逐玉》爱情主题曲) (The Endless Quest (Love Theme Song from the TV Series ''Pursuit of Jade'')) (伴奏版)`

Artist: `张碧晨`.

It plays, but there is no transliteration button in the lyrics view. Current
inspection found that `LyricsView.tsx` and `FullPlayer.tsx` gate their reading
buttons on `hasJapanese`; `useJapaneseReading.ts` and `useLyrics.ts` request
Japanese readings with `language: "ja"`. There is no Chinese Pinyin path.
The title ends in `伴奏版`, meaning instrumental version: first verify whether
the displayed words belong to this edition. Do not use vocal lyrics to conceal
an instrumental identity problem.

Implement accurate language-aware reading support for Chinese vocal lyrics
and assess other relevant languages. Do not identify every Han-character line
as Japanese. Preserve Japanese reading quality and preferences, original lyric
text, timing, sharing, mixed-language lines, caching and retry behavior. Reading
preferences should work consistently in the full player, lyrics view and any
existing lyric preview that supports readings. Transliteration is different
from translation; label it clearly. Handle names and uncertain pronunciations
honestly. Test an actual Chinese vocal recording and a Japanese recording.

## 3. Recommendation controls in the full player

Expose the existing track recommendation/taste controls directly in the full
player as well as the track-row context menu. Reuse the actual current actions,
account persistence and feedback behavior. Make the control usable by touch
and keyboard, and apply it to the currently playing recording. Verify updates
while songs change and recommendations refresh.

## 4. Intermittent keyboard shortcuts

Space sometimes fails to pause in the lyrics view, or performs another action.
Investigate the real focused element after opening lyrics, clicking a line,
scrolling, interacting with transport controls, and opening nested dialogs.
Inspect global listeners, focus traps, preventDefault/propagation, native
button activation, sliders, repeat events, IME composition and keyboard layouts.
Test all advertised shortcuts, not only Space.

Starting points: `src/rebuild/app/PlaybackKeyboard.tsx`,
`playbackShortcuts.ts`, player dialog lifecycle and lyric-line buttons.
The current interactive-target guard excludes buttons, including lyric lines;
this is a lead to reproduce, not permission to override every control's keys.

Provide a consistent shortcut policy: play/pause should work in the listening
and lyrics contexts without first hovering the transport button; typing and
native form/control navigation must stay usable. The user's earlier wording
also mentioned keys tied to hovering an item. If adding item-specific shortcuts,
make their scope explicit and give keyboard users an equivalent focused-item
path. Clarify only if that choice materially changes the requested behavior.
Remap conflicting commands when justified, and update help, labels and tooltips.
Ensure one key press causes one action. Verify behavior in the browser after
mouse, touch and keyboard interactions.

## 5. Clickable album names throughout Sakura

Album names on track rows and every relevant track surface should open the
correct album page. Audit list/card layouts, track detail, player, lyrics,
queue, search, downloads, mixes and playlists. Use verified album IDs/provider
references, not title-only navigation. Handle missing album references without
broken links. Clicking an album must not also play the row or select it. Keep
accessible link semantics and handle dialog navigation correctly.

## 6. Collection collage artwork

Mix detail pages lack the expected collage cover; playlists and other
collections may have the same inconsistency. Audit list cards and detail
heroes, their API data, loaded member tracks and existing artwork helpers.
Reuse the current artwork system when appropriate. Collections without a
dedicated cover should show a stable collage from distinct available member
artwork. Keep explicit/custom covers, avoid repeated tiles when possible, and
handle zero, one, two, three or four images, broken images, unloaded pages,
offline views and collection edits. Preserve existing album and artist covers.

Starting points: `CollectionRoom.tsx`, `playlistArtwork.ts`, collection/mix
pages, collection data responses and artwork tests. A collage helper already
exists; determine where it is disconnected or given incomplete data.

## 7. Search within mixes, downloads and other collections

Collection search must find member tracks by song title, any credited artist
name and album name. Audit mixes, playlists, likes, saved downloads, download
activity, albums and other searchable collections. Include useful existing
metadata such as version labels or verified alternate names where available.
Make normalization and multi-word behavior consistent, with helpful
placeholders/empty states. Preserve ordering, pagination, selection and playback
context, and search the intended collection rather than only its visible page.
Avoid fetching the external catalogue for every keystroke.

Current `TrackCollection.tsx` and `DownloadsRoom.tsx` already include artist and
album fields in their basic filter. Reproduce the user's failure and look for
other search paths, missing hydrated metadata, normalization differences,
pagination or misleading copy before assuming those fields need adding there.
Test actual artist-only and album-only queries, collaborators, accents,
non-Latin text and multi-word queries across the affected pages, including
offline downloads.

## Preserve the deployed download repair

Read `docs/rebuild/CLOUDFLARE-DOWNLOAD-ROLLOUT.md`, its evidence JSON and
`worker/cloudflare/README.md`. Production is
`https://sakuraplayer.vercel.app`; Telegram acquisition is
`https://sakura-audio.bb2010ng.workers.dev`. One SQLite Durable Object owns the
Telegram authorization. Render/local owners were stopped. Never run a second
owner using the same authorization or create one for preview tests. Use the
separate acquisition-disabled proof configuration for transport experiments.

The five reported failed recordings have verified complete files and live CDN
preparation. Preserve canonical recording IDs, authentication, account scopes,
libraries, saved offline audio, strict recording identity, checksum/container
checks and the primary direct-CDN download path with proxy fallback. Never clear
all caches/accounts or accept previews and wrong editions to make tests pass.
Secrets and private audit files live in ignored `.env*` and `.local/`; do not
print, commit or include them in reports. Reuse existing verified media for
browser checks and respect the persistent source-audit byte cap. Additional
live audio/provider tests must be bounded and honestly account for traffic.

## Completion evidence

Run the checks appropriate to the changes, including meaningful regression
tests and browser verification of real focus behavior, navigation and artwork.
Separate mocked/provider fixtures from live evidence. Recheck relevant playback
and download regressions after changing shared player or track components.
Explain each root cause, what changed and which examples now work. Report
remaining provider or language limitations without promising every song will
always have lyrics. Commit and push the finished work; report the commit and
deployment status truthfully. Add a durable handoff with any remaining issues.
