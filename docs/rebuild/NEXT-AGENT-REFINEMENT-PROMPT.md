# Sakura: refinement and Bloom integration

Copy the prompt below into a new agent conversation in this repository.

---

You are working on Sakura at `C:\Users\bb201\Desktop\sakura`, with the repository at https://github.com/billighost/sakura. Give the recent personalization redesign a complete second implementation pass, then integrate its richer listening data into Sakura Bloom. Finish the improvements, verify them, and review your own result again. Do not stop at an audit, proposal, or list of suggestions.

Use as many subagents as useful. Delegate independent work such as backend and privacy review, playback/offline correctness, UX and responsive design, Bloom storytelling/worlds, copy, and browser verification. Give each agent clear ownership; coordinate shared files and contracts. You remain responsible for integration and the final result.

## Read and understand the existing work

Inspect the working tree and latest implementation commit before editing; preserve unrelated work. Read `AGENTS.md` and the relevant installed Next.js guides in `node_modules/next/dist/docs/`. This project's Next.js version has newer conventions; do not assume older APIs.

Read these handoff documents and verify their claims against the code:

- `docs/rebuild/PERSONALIZED-FEED-RESEARCH.md`
- `docs/rebuild/PERSONALIZED-FEED-SOURCES.json`
- `docs/rebuild/PERSONALIZED-FEED-IMPLEMENTATION.md`
- `docs/rebuild/PERSONALIZED-FEED-VERIFICATION.md`
- `docs/rebuild/SAKURA-VOICE.md`

Home and Discover now have continuous playable feeds, recommendation reasons, familiar-artist and verified-release shelves, and adjustable discovery. A shared ranking engine powers smart queues in Home, liked songs, collections, the queue, and verified device downloads. Actual audible listening, finishes, skips, playback positions, artists, genres, recency, and local listening hours feed the model and Profile charts. Settings offer detailed controls and defaults. Song exclusions can last a day, week, 30 days, or indefinitely; users can undo them, export data, and confirm selective clearing. Privacy, account boundaries, delayed-event deletion receipts, and manual queue preservation are important existing guarantees.

The previous pass passed the production build, TypeScript, tests, and 29 browser acceptance checks. Browser APIs/audio are controlled fixtures; separate database tests use isolated PostgreSQL schemas. Treat this evidence as a starting point, not proof that no bugs remain. Sakura development servers on ports 3014 and 3104 were stopped at handoff. Start a fresh project-owned server when needed and stop it when finished. Mesh memory was unavailable because its installed CLI could not read this project's newer memory schema; do not alter or downgrade that database to get around the error.

## Refine the implementation and experience

Use the app, inspect real code and contracts, and look for missed edge cases. Fix defects and improve the idea where evidence supports a better result. Check feed quality and variety, cold starts and sparse histories, pagination and invalidation, duplicated songs, false new-release labels, recommendation explanations, preference persistence, and cross-device behavior. Review playback races, skips versus failures, seek/mute/pause accounting, completion semantics, queue ordering, preserved manual picks, account switching, downloads-only playback, offline recovery, exclusions/expiry/undo, and selective clearing/export. Verify that late responses, pending offline events, or old snapshots cannot restore erased data or overwrite newer choices.

Give Home, Discover, Profile, Settings, song menus, saved music, downloads, and the player a careful visual and interaction pass. Find congestion, competing actions, repeated explanations, unclear hierarchy, awkward spacing, cramped cards, clipped text, tiny controls, unnecessary decorations, and screens that become tiring as the feed grows. Check common desktop/laptop sizes, short viewports, 390px and 320px phones, long titles, dark mode, keyboard/touch, focus, reduced motion, loading/errors, and empty states. Make the main action clear and move secondary detail into useful disclosure. Preserve meaningful features while simplifying presentation.

Follow Sakura's existing design system: composed typography, thoughtful space, ink and botanical details, familiar colors, and distinct artistic compositions. Let each page have its own character while belonging to Sakura. Aim for an exceptionally beautiful, quiet music player with effortless controls. Avoid a generic dashboard, uniform card grids everywhere, excessive badges, extra setup steps, or decorative effects that obscure use. Smart features use ordinary queue controls; keep sparkle/AI-glow icons out. Inspect performance, long-session feed growth, image loading, animation cost, and unnecessary network/database work.

## Integrate the new listening data into Sakura Bloom

Inspect `src/rebuild/bloom/service.ts`, `story.ts`, `snapshot.ts`, `comparisons.ts`, `uiTypes.ts`, the cinematic/story components, exports/covers, and `src/rebuild/bloom/worlds/`. Inspect `src/rebuild/data/listeningInsights.ts`, `listeningEvidence.ts`, `personalization.ts`, and the listening/taste state before deciding what is available. Determine what Bloom already uses and what meaningful new evidence it misses. Implement the data contracts, calculations, narration, visuals, interactions, and persistence together.

Cover all ten worlds actually registered in the project: Sakura Afterglow, Rainforest Reverie, Velvet Disco, The Lantern Book, River of Ink, Painted Courtyard, Monsoon Miniature, Tidal Dream, Paper Cosmos, and Prismatic Garden. Study each world's artistic language and scenes. Each world must translate useful listening evidence into a fitting experience, rather than show the same chart, badge, narration, or animation with different colors. Build a brief mapping for every world from trustworthy data to its own story/scene and then implement it.

Examples to explore, where the actual world supports them: return visits as recurring branches or motifs; listening hours as changing light or scenes; genre breadth as meaningful variety in painted elements; artist continuity as recurring landmarks, performers, or celestial arrangements; discovering new artists as new paths or additions to a collection. These are starting ideas, not a template. Use the world's existing composition, pacing, interaction, and accessibility to choose a coherent interpretation. Find other worthwhile integration points beyond obvious statistics: scene transitions, reveals, chapter order, period comparisons, the finale, archive previews, covers, sharing, and replayable listening moments. Add only what improves the experience.

Make Bloom more memorable through purposeful staging, beautiful art direction, meaningful reveals, and listener-specific details. Never invent an emotion, personality, life event, favorite genre, acoustic property, or listening habit unsupported by evidence. Explicitly distinguish observed listening from chosen preferences. Do not present completion/skip rates as a judgment of the listener or as proof that they dislike a song. Replays and seeking mean audible time differs from song duration. Handle multi-genre attribution without multiplying listening minutes. Use the correct period and timezone; keep missing tags/dates unknown and sparse periods honest. A quiet, well-designed empty story is better than invented statistics.

Preserve private listening, disabled learning, active taste exclusions, account isolation, retained-history semantics, and erasure of derived stories. Revisit the difference between retained listening history, recommendation evidence, and explicit taste choices; do not accidentally rewrite history when filtering recommendations. Bloom's existing deletion/snapshot locks must remain correct. Evolve persisted and archived snapshots compatibly, including old/undated imports and legacy worlds. Use additive migrations when needed, never a reset of real user data. Preserve audio controls, archive behavior, cover/share exports, and lower-performance/reduced-motion experiences.

## Improve copy, then check it again after implementation

Sakura is a quiet, comfortable place to listen. Use `SAKURA-VOICE.md` as the foundation. Keep the calm setting, clear actions, and recognizable “Find my soundtrack.” Avoid pleading invitations such as “stay for a song,” claims that music “feels like you,” or wording that begs for attention. Bloom can be more expressive, but each world's narration must fit that world and the actual listening evidence. Give its introductions, transitions, reveals, comparisons, and closing moments a thoughtful rewrite where needed. Avoid repeated generic poetic lines across worlds.

After functionality and visuals are complete, have a dedicated agent review every affected visible string across Sakura again, including menus, settings, descriptions, charts, empty/loading/error states, privacy controls, confirmations, and Bloom. A nontechnical listener should understand the copy immediately. Replace unnecessary technical terms such as affinity, canonical IDs, telemetry, ingestion, evidence confidence, and snapshot with plain descriptions of the user-visible behavior. Keep technical detail in code/developer documentation unless it helps the listener make a real decision. Do not rename catalog titles, artists, or lyrics. Verify the revised text in the rendered interface for wrapping and density.

## Verify, iterate, and deliver

Run appropriate existing tests and meaningful new regressions for discovered defects, including `npm test`, `npm run test:sync`, `npm run test:product`, `npm run test:personalization:db`, and relevant Bloom/browser/export suites. Run lint, TypeScript, and the production build. Use isolated data for database tests and user-data clearing; distinguish fixture evidence from actual provider behavior. Inspect actual desktop/mobile/dark screenshots and real interactions, rather than relying on compilation or mocked components alone.

When the integrated work passes, give it another independent review for missed bugs, clutter, weak artistic integration, inaccessible controls, misleading numbers, technical language, and copy inconsistency. Fix material findings and recheck what changed. Research official sources when useful and record verified evidence; do not claim unavailable sources were read. Avoid unnecessary permission questions for authorized reversible implementation work. Do not deploy or push new changes unless I ask in this new conversation.

Update the project handoff and verification documentation. Finish with a concise account of what improved, how each Bloom world uses the richer data, what was tested, and any genuine limitations. Deliver working, coherent improvements across the whole experience, with no unfinished placeholders or invented personalization.
