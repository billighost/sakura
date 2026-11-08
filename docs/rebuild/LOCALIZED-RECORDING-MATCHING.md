# Localized recording matching

Japanese recordings were being rejected because the catalogue and audio source
used different official names for the same recording. The captured failures were
metadata failures, before any audio was transferred.

| Catalogue display | Received audio tags | Catalogue / source duration | Rejection |
| --- | --- | --- | --- |
| 咆哮 - HOKO / TOMONARI SORA | HOKO / 友成空 | 209766 / 209000 ms | title, artist |
| 睨めっ娘 / TOMONARI SORA | 睨めっ娘 / 友成空 | 158850 / 159000 ms | artist |
| 鬼ノ宴 / TOMONARI SORA | 鬼ノ宴 / 友成空 | 175998 / 176000 ms | artist |
| 文明開化 / East West | East West / 友成空 | 148000 ms catalogue row | artist spelling affected search |

The actual search/source observations are in
`TOMONARI-METADATA-ACCEPTANCE.json`. HOKO uses ISRC `JPB602501985`, 睨めっ娘 uses
`JPB602401364`, and 鬼ノ宴 uses `JPB602400319`. The native East West catalogue row
is Deezer `3609044902`.

MusicBrainz independently maps the exact Spotify artist URL for
`2UMMVk4WPg6pKXQGvufnuG` to artist
`12a72f22-33c3-468e-8a3b-1ed6c11fcfef`, whose official name is `友成空` and whose
primary English artist alias is `Tomonari Sora`. That artist also has an exact
Deezer URL relation for `224043425`. These are provider identities and published
aliases, rather than generated transliterations.

## General matching contract

Trusted exact catalogue reads may add `metadata.verifiedAliases`. Each entry
contains one complete alternate metadata snapshot and the recording references
that authorize it. The shared core accepts an alias only when it shares an
exact Deezer/Spotify catalogue row or an authoritative ISRC/MusicBrainz recording
identifier with the request. Provider ID formats are validated.

The alias must retain complete credits and the original credit count, recording
version, known explicit edition and duration. Source matching can recover only
title/artist spelling differences. A source that fails another original gate
remains rejected, including a preview, missing duration, changed duration,
conflicting identifier, wrong mix, live version, remaster or guest credit.
Duration tolerances cannot accumulate across aliases.
Explicit language performances such as `English ver.`, `日本語版` and
`한국어 버전` remain distinct version labels. A generic `Acoustic ver.` merely
repeats its acoustic kind; named mixes, venues, years and Nightcore retain their
significant labels.

Aliases belong to the trusted request, and source-provided alias claims are
ignored. Public expected metadata strips them. Validated aliases are projected
without nested alias fields so persistence cannot create recursive metadata.
The server owns catalogue and artist identity lookups, trusted parsing,
persistence and compatibility recovery.

## Recording titles with independently verified artist names

A shared ISRC can prove an alternate title while both catalogues still publish
only an English artist name. The server now joins that exact recording evidence
to the credited artist's exact MusicBrainz catalogue URL. The URL must identify
one artist, and that artist must link back to the same Spotify or Deezer URL.
The catalogue credit must match the artist's published name or a current primary
artist-name alias before another published primary spelling can replace it.
Every resulting recording snapshot retains the same complete, ordered credits,
ISRC, duration, explicit edition and version. Artist MusicBrainz IDs never become
recording identifiers. Ambiguous relations, missing reciprocal proof, nicknames,
historical names, unproved guests and malformed catalogue IDs cannot authorize a
replacement.

The captured Mandarin failure demonstrates this general join: Spotify
`5pIcwtJYNJx93l420oR2Vm` publishes `晴天`, Deezer `2602471112` publishes `Sunny Day`,
and both return ISRC `TWK970300503`. Their credited artist IDs are Spotify
`2elBjNSdBE2Y3f0j1mjrql` and Deezer `69175`. MusicBrainz artist
`a223958d-5c56-4b2c-a30a-87e357bc121b` has reciprocal relations for those IDs,
official name `周杰倫` and current primary English alias `Jay Chou`. No runtime
song or artist table is configured. Audio startup acceptance is recorded in the
separate multilingual audit.

Public metadata lookups have bounded response sizes and timeouts. MusicBrainz
requests share a process-wide queue limited to one request per second. Successful
artist names and exact recording rows have separate caches, allowing temporary
artist lookup failures to retry while reusing already verified catalogue data.

## Worker contract

The worker preserves matching proof references separately from searchable
catalogue links. Its request cache key includes sorted, deduplicated proof IDs
and alias evidence, preventing requests with conflicting proofs from sharing a
successful flight. Native metadata queries are derived only from validated
aliases. The legacy selection adapter also accepts complete metadata and
recording references.

Deployed support is identified by the `verified-metadata-aliases` capability.
The existing remote worker checked on 2026-11-08 still returned 404 for
`/v2/capabilities` and lacked protocol features in `/health`; it did not contain
these local worker changes. The server compatibility path is therefore required
until the updated worker is deployed.

## Verification

Core regressions cover the captured Japanese metadata tuples and a Korean
spelling pair. Negative cases cover guessed romanization, missing and conflicting
proof, source-injected aliases, malformed catalogue IDs, changed duration,
previews, named mixes, remaster years, guest credits and recursive alias copies.
Worker tests exercise proof propagation, native search queries and isolation of
flights with different authority evidence. Run `node scripts/test-rebuild-core.cjs`
and `npm --prefix worker test`.

Server regressions also cover the Mandarin title/artist join, reciprocal identity
failures, ordered guests, independent metadata retries and caller cancellation.
Run `node scripts/test-rebuild-server.cjs`.

This worker investigation made metadata requests only and transferred no audio.
The root acceptance audit owns the requested 4 KiB starts and its shared data cap.
