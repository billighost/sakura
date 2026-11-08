# Artist-based starting taste

Implemented in the second personalization pass. Choosing artists in onboarding now creates a small, account-owned starting recipe from verified catalog recordings. It supplies recommendations before there is listening history; it never creates plays, listening time, dates, completions, skips, or Bloom evidence.

## Three distinct sources

- **Chosen artists:** existing `seedArtists` and exact `seedArtistSelections` remain the listener's choices. Their published catalog genres produce a separate, server-derived `initialTasteProfile` in the existing preferences JSON.
- **Chosen genres:** `seedGenres` remains an explicit choice. Generation does not fill or change it. Its ranking influence is stronger than the artist-derived recipe when the two compete.
- **Observed listening:** retained audible measurements continue through the existing listening service. Charts and Bloom use this evidence and remain empty after artist selection alone. Disabling learning retains deliberate choices while preventing history from contributing to recommendation ranking.

The recipe records its `chosen-artists` origin, version, selection signature, source recording/artist IDs, and bounded genre weights. It does not infer moods, acoustic qualities, personality, schedules, or preferences from skips.

## Identity, exclusions, and refresh

Exact provider references take priority over names. A same-name artist or featured guest cannot supply the chosen primary artist's initial genres. Legacy name choices still work alongside exact choices. The shared ranker also fixes an unlinked primary artist incorrectly inheriting the first linked guest's listening influence.

Each chosen artist contributes equally; each recording divides its contribution across unique genre tags. Missing tags remain unknown. Explicit filtering happens before the catalog query's per-artist limit, so clean recordings beyond the first explicit recordings can still supply evidence.

Source provenance contains the recording ID and every linked artist credit. Active recording or artist blocks/snoozes remove that source's genre influence when consumed. Expired restrictions and undo restore eligibility. These are recommendation restrictions; they do not erase or rewrite recorded listening or Bloom history.

Settings changes generate the recipe transactionally under the existing account history/privacy lock and settings revision check. Existing accounts acquire a missing recipe lazily under the same public lock; the metadata write also checks the observed revision and refetches if it loses. Optional catalog enrichment refreshes the recipe for the account's **current** choices after provider work finishes. Refresh does not stamp a new listener preference revision or invalidate an existing scrolling feed snapshot.

## Bounds and connected surfaces

Generation reads at most eight verified primary recordings for each of twenty choices: at most 160 recording sources, twelve unique tags per source, and twelve resulting genre weights. No provider requests occur during generation or preview.

Home/Discover and local soundtrack ranking consume the shared recipe. Feed candidate acquisition reserves its verified sources alongside the existing 1,000 known and 1,500 unexplored candidate reservoirs. Mix generation prioritizes those sources inside its existing 2,500-card bound. Catalog warming includes mixed exact and legacy choices within twenty artist requests.

Search uses the same genre helper and retains its bounded chosen-artist/catalog reservoir. Artist buttons distinguish chosen music, liked music, recorded listening, genre connections, and catalog entry points. Restricted collections and downloaded soundtracks still return only songs allowed by their requested source.

Onboarding includes a debounced, optional catalog preview without another required setup step. `/api/v2/onboarding/preview` accepts only artist choices and returns up to four genre names plus catalog-match counts. It does not save preferences or listening. Account/selection changes abort obsolete requests and hide results from older selections. Artist removal controls are at least 44px; long names wrap, and artist buttons have complete accessible names. An account-keyed onboarding child resets unsaved choices when the account changes.

Sparse/growing Profiles show chosen artists and their available catalog genres in a native disclosure, separately from measured charts. The UI explicitly explains that charts and Bloom use saved listening.

## Browser cache and synchronization

`settingsFields` remains the writable preference whitelist. `fullSettings` separately validates bounded read-only recipe metadata and accepts it only when its signature matches the current artist choices and explicit-content setting. Full account cache snapshots retain it; pending patches, legacy draft fallbacks, and preference rebasing strip it. The server rejects client-supplied `initialTasteProfile`.

The existing per-account cache keys, request cancellation, CAS revisions, and field revisions remain in use. Applying an offline artist edit removes an older recipe immediately, so reconnecting or a delayed response cannot use a recipe for the previous choices. Recipe metadata does not masquerade as a listener edit.

## Verification at handoff

- **Passed:** thirteen pure regressions in `scripts/rebuild-initial-taste.test.ts`: exact/legacy identity, sparse/unknown tags, equal contribution, unique tags, explicit filtering, stale recipes, provenance/expiry exclusions, disabled learning, shared feed/Search/local ranking, stronger explicit genres, honest genre explanations, read-only cache/PATCH paths, and primary-guest attribution. The earlier combined run of the then-twelve new cases plus thirty-eight existing feed/Search/preferences cases passed all fifty.
- **Passed:** full TypeScript after the final UI integration; scoped ESLint for new data, recommendation, preview, browser-fixture, and UI changes. Broader `MusicContext` lint reported existing warnings and no errors.
- **Passed:** six isolated PostgreSQL cases in `scripts/rebuild-initial-taste-db.test.ts`: persisted recipe with zero listening/Bloom rows; read-only preview and clean candidate filtering; stale CAS/read-only rejection; empty recipe enrichment without preference revision changes; lazy existing-account generation; and preservation of older chosen recordings behind 1,502 newer catalog fixtures. Full and lean ranking projections preserve identity, metadata and genre evidence. The final feed suite passes all fifteen cases after the projection change.
- **Passed:** thirty-seven final production checks in `scripts/rebuild-onboarding-preview-browser.mjs`, run with `node --import tsx`. Controlled signed-account fixtures exercise 1280px, 390px, and 320px layouts, delayed preview cancellation, mounted remote changes including change-and-revert, current-draft retry, saving a distinct recipe, empty measured charts, connected Search, long names, and 44px removal targets. All fifteen screenshots were inspected. Save controls meet 44px with passing light/dark contrast. Evidence is in `.local/onboarding-preview-browser-report.json`.

Catalog tags and provider availability remain genuine limits. The recipe is a bounded starting sample, not a claim about the artist's complete catalog or the listener's measured history. Browser fixtures prove client behavior; isolated PostgreSQL tests separately verify persistence and measurement boundaries. Live provider quality is not established by either fixture suite.
