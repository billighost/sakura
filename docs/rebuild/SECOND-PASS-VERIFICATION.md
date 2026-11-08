# Personalization and Bloom: second implementation pass

Work began from `d578d0c` with a clean working tree. The original production build
and 29 browser checks were treated as baseline evidence. This pass read the
repository instructions, installed Next.js guides, research, implementation,
verification, and Sakura voice documents before changing the product.

## Automated evidence

- Core 39, server 96, app 170, and personalization 164 tests passed in the final
  `npm test` run: 469 passing tests. Subsequent targeted verification checks the
  final rendered copy.
- Account synchronization passed 31 client cases and 13 listening-sync cases.
- The isolated product database suite passed all 14 cases and cleaned its owned
  schema/accounts. It covers collections, delayed events, privacy, mixes, Bloom
  reveals/archives, exact artist credits, and verified public playback projection.
- Listening/data database tests passed 19 cases, including partial erasure,
  retained exclusions, precise mutation ordering, disabled/private history,
  redacted data export, and delayed-event deletion receipts.
- Feed, account-sync, Bloom, and Search database suites passed 15, eight, eleven,
  and six cases respectively. Together with product, listening/data and initial
  taste, the database-oriented suites pass 79 checks; eight are pure contract
  checks inside those suites.
- Initial-taste database tests passed six cases in an isolated serial run. A
  fixture with 1,502 newer catalog recordings retained older chosen artists and
  returned 40 visible feed items with zero fabricated listening. Its feed request
  took 5.316 seconds in that run; earlier timeouts were confounded by overlapping
  remote database suites, so this is not a measured speedup claim.
- The authored-cover tests pass for all ten worlds, both palettes and both sizes.
  Forty bounded WebPs total 1,427,856 bytes; source revision is `06efeae23820`.
  All twenty world/palette source hashes were refreshed after the story-layout
  fixes. Visual comparison preserves the original compositions and lettering.
- The final real-provider harness passes 94 cases, including audible boundaries,
  queue restrictions, account isolation, microsecond clear/reply ordering,
  partial-clear exclusions/undo, held-outbox restoration, and timezone/late-history
  shelf refreshes. The harness mounts the actual MusicContext with controlled
  browser/audio/storage services; it does not contact live music providers.
- Full TypeScript, production build, and ESLint pass. ESLint retains 14 existing
  warnings and no errors.
- Downloads pass 204 application regressions and 55 worker regressions.

Read-only inspection confirms `ListeningPrivacyWindow` and preference
`field_revisions` are installed in the configured application schema. The schema
changes are additive and the migration remains idempotent. No real account was
reset; deletion verification uses isolated synthetic fixtures.

Tests use real PostgreSQL in isolated generated schemas, synthetic account IDs,
and fixture journals. They do not clear or reset a real listener's account.
Database suites run serially because overlapping remote connections produced
timeouts and stalled test transactions. Cleanup targets only verified owned
fixtures; older unrelated remnants are preserved. A final product-suite repeat
hit a connection-handshake failure before its cases started. The serial rerun
passed 14/14 after adding test-only fixture journaling and guaranteed pool
closure. Final read-only inspection found no owned test schemas, waiting locks,
or idle transactions; two pre-existing unrelated taste fixtures were preserved.

## Production browser evidence

The final server runs the project-owned `.next-bloom-build` production build.
An earlier production build and a separate development server were stopped when
their verification phases ended. Product API writes are intercepted and accounts
are synthetic; the database checks above independently verify service persistence.

- Personalization passes 58 checks with no page or hydration errors. Screenshots
  cover desktop, laptop, short viewports, 390px/320px phones, long titles, dark
  mode, and reduced motion. Home's current/upcoming Bloom cards sit ahead of the
  long feed and show authored artwork, dates, availability, and clear actions.
- Bloom passes 54 production journeys, 29 additional interaction/layout gates,
  and ten 1080×1920 PNG exports with no page or hydration errors. Its report
  records 313 screenshots and 302 scene geometry observations. All ten worlds
  cover rich, sparse, and legacy stories at desktop and 390px/320px widths;
  targeted journeys include a short laptop, ordinary motion, the lowest drawing
  quality, two-tab clearing, stale story replies, and old recording-only archives.
- After the export correction, the dedicated production suite passes all 82 PNG
  exports with no clipping or browser errors: every world at desktop and 320px
  widths with rich, long multilingual, sparse, and legacy data, plus two old
  recording-only stories. It measures both the rendered composition and the
  styled serialized clone. Full titles, artist credits, artwork, and each world's
  closing remain inside the 1080×1920 image. Evidence is recorded separately in
  `.local/bloom-export-review/after/report.json`; pre-fix PNGs are preserved.
- Focused production checks verify primary-artist navigation with an unlinked
  lead, Deezer and Spotify references, and a linked guest. The 320×640 clearing
  dialog keeps both 44px actions visible, focuses cancellation, shows the
  irreversible warning immediately, and performs no deletion on cancellation.
- Onboarding passes 37 production checks with zero browser errors; all fifteen
  screenshots were inspected. Delayed previews, mounted remote changes including
  change-and-revert, current-draft retry, generated taste, empty measured charts,
  and connected Search pass. Save measures 44px with 5.74:1 contrast in light and
  9.17:1 in dark mode; removal targets meet 44px.

Final pixel review found and corrected defects that the initial journeys missed:
an oversized sparse-Profile icon, an invisible onboarding Save background, tall
mobile finales behind fixed controls, reading text beneath the footer, and
carried cinema scroll position. All ten worlds now grow for long story content;
the production matrix proves footer reachability and Next scroll reset. Scene
transitions freeze on pause alongside CSS keyframes. Cover and poster layouts
preserve their authored compositions. Personal inspection also caught a clipped
Prismatic Garden export closing line; export content now fits its fixed page
after artwork and fonts load, preserving full metadata.

Browser geometry checks distinguish decorative pseudo-element ink from actual
text, cards, controls, and viewport overflow. Calendar tests establish real local
midnight/DST openings; controlled Home timestamps exercise display formatting and
do not establish the live schedule independently.

## Implementation and independent review

Independent owners reviewed backend/privacy, playback/offline behavior,
preferences, onboarding, Search artists, responsive UX, Bloom data and worlds,
copy, and browser behavior. Material findings were implemented, including
primary/guest attribution, stale onboarding drafts/retries, exclusions retained
after partial clearing, precise delayed-clear ordering, empty-period honesty,
cached-story refresh identity, manual Bloom audio while paused, and Home shelf
calendar invalidation. World narration was checked against actual artwork.

The ten distinct mappings and archive compatibility are documented in
[`BLOOM-LISTENING-INTEGRATION.md`](./BLOOM-LISTENING-INTEGRATION.md). The catalog-based
onboarding recipe and its separation from listening are documented in
[`INITIAL-TASTE-IMPLEMENTATION.md`](./INITIAL-TASTE-IMPLEMENTATION.md).

Official media and database evidence is recorded in
[`REFINEMENT-SOURCES.json`](./REFINEMENT-SOURCES.json); the original recommendation
research and voice sources remain authoritative. Mesh memory could not read the
newer project schema. Its database was not changed or downgraded; these documents
provide implementation continuity instead.

## Evidence limits

Controlled browser responses and generated complete audio verify the real client
code, interactions, layouts, and exports. They do not establish live catalog
quality, external audio/CDN availability, or listening statistics for a real
account. Published catalog tags can be missing, and the starting taste is a
bounded artist sample. Bloom uses retained dated audible listening, preserves
unknown metadata/import dates, and does not invent personality, moods, habits,
or acoustic properties. No manual deployment was performed. GitHub delivery and
the verification server shutdown are recorded below.

## Delivery

The completed implementation, reusable regressions, authored cover assets, and
verification documents are delivered on `master` in the requested GitHub
repository. Ignored local reports, build output, environment files, and Mesh
databases are excluded from the commit. Verification servers are stopped after
the final checks.
