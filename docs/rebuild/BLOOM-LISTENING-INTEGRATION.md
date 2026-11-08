# Bloom's listening record

Implemented 8 November 2026 as the second pass after `d578d0c`. The main
personalization implementation and verification reports describe the wider app
refinements. This document records the new Bloom measurement and story contract.

## Trustworthy measurements

New stories store a version 3 snapshot with an optional `BloomListeningProfile`.
The profile uses the selected calendar period and its saved IANA timezone:

- Actual audible milliseconds, distinct recordings, recorded active days and
  local-hour bands. A peak hour describes this period's measurements; it does not
  assert a daily routine, occupation, sleep pattern, mood or personality.
- Songs recorded in an earlier period or in multiple listening sessions during
  this one. A returning artist has an earlier dated listen under the same verified
  primary identity. Display-name similarity is not artist identity, and an
  unlinked main credit never inherits a featured artist's ID.
- First recorded songs and artists in retained dated history. Songs with
  unexplained imported totals or undated legacy chunks are excluded from first
  listen claims. Unmapped imported recordings leave discovery counters unknown
  because their current catalog identity cannot be proven.
- All distinct published genre tags. Each song's audible time is split equally
  across its unique tags, ignoring case variants and repeated tags. The remaining
  untagged or unavailable metadata time is kept unknown. Genre shares use the
  complete measured time as their denominator and never multiply minutes.
- The immediately preceding calendar week, month or year in the same timezone.
  Comparison records raw audible-time change and shared canonical songs/artists.
  There is no percent increase from an empty baseline, no listening target and no
  judgment about more or less listening. Calendar months and DST weeks can have
  different lengths, which the comparison explanation states.

New snapshots use `ListeningChunk.occurred_at` for date and hour attribution.
Legacy receipt creation timestamps remain receipt dates; they are not relabeled
as listening dates. Audible chunks are attributed by their recorded occurrence
timestamp; the service does not reconstruct an unsupported continuous wall-time
schedule from a song's duration or playback position.

Bloom uses retained listening history. Recommendation exclusions change ranking
and suggestions; they do not rewrite the music someone actually heard. Paused
learning and private listening reject new history while preserving the journal
already retained. Chosen genre/artist seeds do not become observed listening.
Completion and skip rates do not shape these worlds or judge the listener.

## Ten interpretations

Every world owns its drawings and staging. These are bounded artistic motifs,
rather than an assertion that every song produces exactly one drawn object.

| World | Listening evidence in its artwork |
| --- | --- |
| Sakura Afterglow | Returning artists form paired blossoms on existing branches; first recorded artists add buds. Recorded local hours change the afterglow. |
| Rainforest Reverie | Genre shares form tributary strokes; returning artists add lily-pad rings, and first recorded artists add flowers. Recorded hours light the painted river. |
| Velvet Disco | Genre shares colour the mirror facets and hour bands shape the stage beams. Returning artists become encore sleeves; first recorded artists add debut sleeves. |
| The Lantern Book | First recorded artists light new path lanterns. Artists shared across periods recur as ribbon bookmarks; earlier artists become procession companions. |
| River of Ink | Artists shared across periods form recurring pavilion landmarks. Returning songs retrace the brush current; first recorded artists add boats, while genre shares mix mineral washes. |
| Painted Courtyard | Returning songs become gold bindings around collected pieces; first recorded songs add bookmarks. Artists shared across periods add keepsake seals, and hours change courtyard light. |
| Monsoon Miniature | Published genre shares mix the folio's pigment pools. Returning songs become lotuses on the painted water, and recorded hours shape the garden light. |
| Tidal Dream | Returning songs curl into painted currents. First recorded songs become shoreline shells; recorded hours shape the water and shoreline light. |
| Paper Cosmos | Artist continuity links paper constellations and returning artists add orbital rings. First recorded artists add celestial marks; active days become calendar leaves, and hours rotate the observatory marker. |
| Prismatic Garden | Genre shares colour botanical panes, returning artists join the leadwork stems, and first recorded songs add botanical buds. Recorded hours change window light. |

Each world also has its own introduction, reveal headings, comparison headings
and closing scene. Song rankings and replay controls retain real catalog titles
and artist names. Heading selection accepts the chapter ID to distinguish, for
example, recorded-play counts from listening hours, and illustrative durations
from a measured comparison with the previous period.

## Disclosure, persistence and deletion

The profile is stored with the derived story, then disclosed cumulatively as the
relevant chapters open. Genre, hour, discovery, return and prior-period fields
cannot appear through the public recap before their reveal. Artist continuity
uses its own chapter ID, so an ordinary other-artists reveal does not disclose
return measurements. A completed archive may use the full stored profile in its
preview, cover and export; old snapshots have no profile and keep neutral art.

Version 1 and 2 snapshots remain readable without a migration or rewritten
measurements. Their saved timezone and original world choices remain authoritative.
Empty periods are not persisted, allowing genuinely late offline listening to
create a story later while its opening window is available.

Bloom generation, lists, archives, reveals and completion use the account history
advisory lock shared with consent/history clearing. Reveals and completion check
again after acquiring their mutation lock; deletion in the gap returns a clear
404 instead of a server error or recreated derived data. Client invalidation and
audio/export safeguards are documented in the integrated verification report.

One aggregate retained-history scan replaces the former per-recording first-date
subqueries. Empty periods avoid loading historical artwork and hour projections.
World drawings cap motifs according to device quality, preserve original audio
controls, and have stable reduced-motion presentations.

The final responsive pass lets all ten story layouts grow for long chapters,
keeps mobile finales below fixed controls, and preserves the Lantern Book's
paper contrast. Cinematic chapter/world changes reset scroll while continuous
reading keeps its position. Pause also freezes in-progress camera/light
transitions through Web Animations. Archive/poster and cover selectors retain
their authored layout; the final forty covers were regenerated and verified.

## Regression evidence

The new pure suite has ten checks, alongside the fourteen existing Bloom cases.
They cover multi-tag arithmetic, unknown metadata/imports, earlier artist identity,
hour attribution, adjacent DST/calendar windows, staged disclosure, sparse stories,
world-specific narration and compatible snapshots. A reference-only main artist
cannot inherit a linked featured artist's portrait; safe matching main portraits
remain available.

The new isolated PostgreSQL suite passes eleven cases. It uses a fresh schema and
synthetic account IDs, then removes only that schema and those owned accounts.
Each run records its exact owned IDs and cleanup status in an ignored
`.local/bloom-db-fixture-*.json` file for recovery if PostgreSQL is unavailable.
Cases cover exclusion/history separation, consent, undated chunks, imported
residuals, unmapped imports, legacy archives, Home readiness and cover isolation,
and real history deletion between the initial read and a reveal/completion
transaction. The integrated final run is recorded in the main verification
report. The production browser matrix passes 54 journeys and 29 additional
gates with no page or hydration errors; it records 313 screenshots and ten
1080×1920 image exports across the ten worlds.

Final pixel review found a Prismatic Garden closing line below the fixed export
page. The compositor now fits the complete content column after images and fonts
settle. A separate production regression passes 82 exports across all ten worlds
at desktop and 320px: rich, long multilingual, sparse, and legacy stories, plus
two recording-only older archives. Both the rendered layout and serialized clone
retain every title, credit, winner image, and closing line without clipping.

```powershell
node --import tsx --test scripts/rebuild-bloom-listening.test.ts scripts/rebuild-bloom.test.ts
node --import tsx --test scripts/rebuild-bloom-listening-db.test.ts
npm run test:bloom:exports:browser
```

No production data was reset or manually deployed. The completed changes are
delivered to the requested GitHub repository. Browser APIs and audio remain
controlled fixtures; those checks prove actual client behavior and rendering, not
live catalog-provider availability. No new external source claims are required:
period arithmetic, identity and genre attribution are directly verified in these
tests. Mesh's incompatible database was left unchanged.
