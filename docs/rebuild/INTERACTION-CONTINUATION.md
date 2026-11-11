# Interaction and lyrics continuation — 2026-11-10

Recovered original request from local conversation `01a1c052-8cd5-77d3-a2ec-b75c2c56be53` (2026-11-09): persistent Japanese readings/full-player reading cue, artistic lyrics launcher, touch/mouse/keyboard interactions, custom dropdowns and slider targets, sticky collection/search controls, playback rewind/pitch reliability, provider recovery and final `api.lyrics.ovh` plain fallback. Later Airpeace conversations are unrelated. Mesh is unavailable; this file is the local handoff.

The pre-existing uncommitted implementation was preserved and reviewed. Capacity errors repeatedly interrupted subagents; the parent continued their work directly. The final follow-up in conversation `01a1c502-dd08-7483-b0e7-d68deaec4cdf` on 11 November explicitly requests completion and a GitHub push; publication is part of the recovered task.

## Implementation

- Same-device delayed listening saves rebase without restoring an older position. Repeated metadata events restore only once. Media Session Play is idempotent, playback rate stays at one, and choosing audio technology None survives an earlier pending save.
- Added three regression cases reproducing initial unknown/infinite duration progress frozen at zero and replacement-stream restore failure. Fixed restoration to retain naturally advancing playback and restore nonzero positions once with infinite duration. Full playback integration: **109 passed** (`.local/interaction-playback-final.log`). Earlier playback/audio/sync batch: **140 passed**.
- Japanese preference, reading cache/cue and launcher implemented. Eight focused reading tests passed. Browser checks passed in both themes on desktop/mobile: remembered reading after song changes, close/reopen, reload and a fresh browser device; explicit disable during a delayed dictionary response; artwork and mini-player swipes; full-player pull dismissal.
- Custom select browser checks: **8 groups passed**, zero page errors, including native mobile touch scrolling in long choice lists, desktop keyboard/wheel behavior, native-dialog top layer, 44px sliders and seek commit semantics (`.local/interaction-controls-final.log`). Fixed fixture hydration race, touch scrolling fighting pointer hover, and preserved mouse focus semantics.
- Lyrics primary-stage plus fallback-stage budget now fits the client deadline (12 seconds per provider stage, 29 seconds client total). All providers participate before a miss; outages/429 stay retryable. Final focused lyric/reading/shortcut/gesture tests: **86 passed**.
- **Live OVH success through actual GET route over local HTTP**: `node --import tsx scripts/rebuild-lyrics-live.ts`, HTTP 200, `provider=lyrics.ovh`, `timing=plain`, 40 lines for Coldplay / Yellow. This isolates synthetic auth and primary-provider 404s while the final OVH request is real/unmodified. Evidence `.local/lyrics-ovh-backend-live.json`. It does not claim production auth or primary-provider availability.
- Secondary pointers cancel pending song holds and sheet drags. Keyboard ownership uses modal opening order. Fixed corrupted shortcut hints and an immediate right-click being suppressed after a keyboard menu. **8 gesture groups passed**, zero page errors, including normal/reduced motion, nested/locked sheet ownership, keyboard/input ownership and secondary touches.
- Fixed native touch capture transferred from artwork images to their swipe surface: the child's bubbling capture-loss event no longer cancels the owning surface. Actual full-player and mini-player touch swipes now pass.
- Incorporated the listener's follow-up corrections: only the search field docks; sorting, layout, count and category controls scroll away. The docked field is **44px tall**, shares the page background and has no extra panel/artwork. Liked rows grow naturally in list/card/compact layouts; wheel scrolling moves the page, with no list scroller. **22 sticky/collection groups passed**, zero runtime errors, at 320/1440px widths and 620/1040px height checks.
- Lyrics transport background matches page paper; removed its surrounding shadow.
- Ignore `.next-*` generated build artifacts.

## Verification

- `npm test`: **586 passed**, zero skipped (39 core, 96 server, 268 application, 183 personalization cases). `.local/interaction-npm-test.log`.
- `npm run test:sync`: passed, including 17 listening-session race cases. `.local/interaction-sync-final.log`.
- `npx tsc --noEmit --incremental false`: passed. Final production build also completed TypeScript, compilation and prerendering. `.local/interaction-types.log`, `.local/interaction-build-final.log`.
- Normal authenticated request to the actual Next server: Coldplay / Yellow, HTTP 200, LRCLIB synced lyrics, 49 lines. `.local/lyrics-normal-backend-live.json`. A private synthetic account was used; its credentials remain ignored.
- Browser evidence: `.local/interaction-controls-final.log`, `.local/sticky-collections/report.json`, `.local/rebuild-gestures-report.json`, `.local/japanese-reading/report.json` and screenshots in their folders. Controls/sticky/gesture checks used the isolated development server on port 3027; final reading/background checks **passed against the production build** on port 3028 (11 groups, zero page errors).
- Final lint passed with **zero errors and 14 existing warnings**. `.local/interaction-lint.log`. The production reading check asserts that the lyric playback controls have the same computed background color as the page.

Temporary fixture routes were removed, generated tsconfig additions restored to the repository baseline, and screenshots reviewed. The installed Next 16.4.5 client/CSS/route/CLI guides were read as AGENTS.md requires. Use canonical Windows paths via `scripts/run-next.mjs`.

## Handoff

The recovered task and the listener's three layout refinements are complete. The isolated development server on port 3027 can be used for local review. GitHub publication targets `origin/master` under the listener's final follow-up. Mesh writes could not be used because the installed CLI cannot read this project's newer database schema; this report preserves the outcome and evidence.

## 11 November completion audit

- Recovered both complete conversation files, including the final explicit GitHub push request. The later mobile player/header request is a follow-up to implement after this publication.
- Fresh `npm test`: **586 passed**, zero failed/skipped. TypeScript and full lint passed; lint retains **14 warnings and zero errors**. The initial concurrent lint attempt raced browser fixture cleanup; the clean rerun passed.
- Fresh browser checks: **8 custom-control groups**, **8 gesture groups**, **11 Japanese-reading groups**, and **22 collection groups**. Japanese reading and control screenshots were inspected. API/account mutations use synthetic intercepted fixtures.
- Final independent review found and fixed same-browser playback ownership: page writers now have separate UUIDs, so another tab's newer song/seek wins over an old tab's checkpoint. A restored offline draft can finish its prior writer's acknowledgement and transfers to the new writer on acceptance. **21 coordinator tests** and **187 focused playback/lyrics/reading tests** passed, including four new ownership/recovery regressions.
- Fixed intermittent collection menu dismissal from a queued scroll event that happened before opening. The menu compares its anchor's current position with the opening position; actual later page scrolling still closes it. The collection browser suite reproduces both cases at 320px and 1440px.
- Repeated the live OVH request through the actual GET route over local HTTP: **HTTP 200, plain lyrics, 40 lines** for Coldplay / Yellow. Primary-provider misses and authentication are isolated; the OVH response is real.
- Fresh audit evidence remains under ignored `.local/continuation-audit-*.log`; the final collection evidence is `.local/continuation-sticky-final.log`. The separate `.next-continuation-build` production build passed compilation, TypeScript, and prerendering. Build-only tsconfig additions were restored before publication.

Do not overwrite other user changes or existing DB/library data. No second Telegram worker, deployments or destructive data actions are needed. Physical-device Safari is outside Chrome fixture verification.
