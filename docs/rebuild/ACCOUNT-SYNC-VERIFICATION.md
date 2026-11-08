# Account listening and artistic controls

Sakura restores account preferences and the current listening session from local storage before refreshing them from the server. Downloads remain on the device and belong to the account that saved them. Signing out forgets the active account without deleting its saved audio.

## Behavior

- Shared search fields have a botanical underline, clear button, and Escape-to-clear behavior. Clearing returns focus to the field; the main search also clears the URL query.
- Home branches grow on arrival. Reduced motion immediately shows the completed branch.
- Thin custom scrollbars, botanical sliders, petal switches and selection markers, and shaped buttons replace default controls. Playback and volume retain keyboard focus feedback without a rectangular interaction outline.
- Theme, onboarding status, sound preferences, volume, shuffle, repeat, preview volume/loop, and sleep-timer preferences have account-scoped local mirrors and server persistence.
- Listening sessions preserve queue occurrences, previous songs, current song, position, and the active sleep deadline. Restored playback is paused until the listener chooses to play.
- Sessions, settings, favorites, and page resources refresh on focus, connection recovery, and every 15 seconds while visible. Session revision checks prevent an older device checkpoint overwriting a newer session; explicit new listening choices can take ownership.
- Playback checkpoints and listening-history delivery have synchronous local mirrors. Account headers and generation guards prevent delayed requests applying another account's state.
- Downloads coalesce requests from different controls and catalog aliases, verify full file size and checksum, and run at most three transfers at once. Canceling/removing a download waits for its transfer to finish before deleting the artifact.
- Likes, queue additions, authentication, playlist creation/import, and share preparation guard repeated actions. Playlist creation/import carry a stable request ID for retries.

## Verification on 2026-11-07

| Check | Result |
| --- | --- |
| `npm test` | 187 tests passed |
| `npm run test:sync` | 11 tests passed |
| `npm run test:sync:db` | 4 tests passed against an isolated schema with fixture cleanup |
| `npm run test:sync:browser` | 18 checks passed, zero page errors |
| Audio playback integration | 7 checks passed with intercepted synthetic accounts and local WAV audio |
| `npx tsc --noEmit --incremental false` | Passed |
| Scoped ESLint | Zero errors; existing image/navigation/hook warnings remain |

The browser checks use the real Home, Search, Downloads, Onboarding, and Settings pages and two independent desktop/phone browser contexts. They verify the Ye/Work handover, previous-song playback, volume/shuffle/repeat synchronization, reopening at 6.5 seconds, a single transfer for repeated download requests, account switching, preserved offline audio playback, delayed-backend theme loading, clear-button focus, keyboard discovery control, completed vine growth, and 390px/320px settings layouts without horizontal overflow.

Local screenshots and machine-readable evidence are in ignored `.local/sync-browser-report.json`, `.local/sync-settings-390.png`, `.local/sync-settings-320.png`, and `.local/audio-technology/playback-report.json`. The listening-session table was confirmed installed in the configured database. One initial database connection timed out; the subsequent read and complete isolated database suite passed.

The final combined production build, TypeScript check and full ESLint completed
successfully after all ten Bloom worlds were integrated. ESLint reports zero
errors and 11 warnings. See [cinematic release verification](BLOOM-CINEMATIC-VERIFICATION.md).

## Follow-up verification on 2026-11-08

The follow-up fixes actual gaps in the first implementation. Chrome now renders
4px scrollbars because both standard scrollbar properties are reset before the
WebKit sizing rules apply. Home vines pause while the opening covers the page,
then grow visibly. Search clear buttons have 44px targets; Library, liked songs,
and collection pages now have clearable filters. Remaining progress, checkbox,
form, and disclosure controls share the botanical styling, with keyboard feedback
on sliders and no rectangular pointer-focus border.

Listening intent retains its original timestamp through passive checkpoints.
Server clock calibration and monotonic timing prevent a sleeping device or a
clock change from replacing newer listening. Preference acknowledgements retain
edits made during an earlier save. Invalid cached settings and sessions are
ignored. Account-scoped favorite drafts preserve offline likes, replay their
explicit desired state on reconnect, and acknowledge only the matching operation.

Canceled downloads remove queued rows and stop stalled reads promptly. Canonical
download/removal guards prevent alias races. Both accounts on the same phone keep
their own saved audio across sign-out and repeated switching. History delivery has
deadlines, coalesces exact chunks, and preserves unsent data. Logout gives flushing
up to five seconds before signing out.

Screen operations are locked synchronously and reject results after navigation or
account changes. Import previews belong to the submitted URL; editing it cancels
the preview. Registration retries avoid recreating an already created account.
Sharing and exporting guard duplicate presses. Full playlists accept repeated
additions without exceeding capacity or advancing revision for unchanged state.

| Final check | Result |
| --- | --- |
| `npm test` | 187 passed |
| `npm run test:sync` | 35 passed |
| `npm run test:sync:db` | 6 passed in an isolated schema |
| `npm run test:sync:browser` | 23 passed; zero page errors |
| Isolated artistic-control browser checks | 4 passed |
| Production Home, Search, and Settings browser checks | 5 passed; zero page errors |
| TypeScript | Passed |
| Full ESLint | Zero errors; 11 existing warnings |
| Production build, `.next-bloom-build` | Passed; 50 pages generated |

The database suite covers exact concurrent history receipts, independent account
settings, listening compare-and-swap, request-ID playlist creation, and repeated
mutations at the 2000-song playlist limit. A cold connection timeout occurred on
one run; the final suite passed after warming the connection through the existing
bounded read-only retry. Test cleanup also handles setup failure safely.

Browser fixtures generate their own tone and authentication token and intercept
account APIs; they do not depend on private audio or a real test account. The final
checks exercise two separate devices and two shared-phone accounts. Production
styling was checked at 1280px, 390px, and 320px. Local evidence is in
`.local/sync-browser-report.json`, `.local/artistic-ui-report.json`, and
`.local/sync-production-report.json`. The temporary test route was removed.

Library filters search loaded pages; Show more stays available when a filter has
no matches. Listening sessions retain a bounded 80-entry queue snapshot around the
current song; the listening journal is saved separately in the database. Restored
audio stays paused until the listener presses play. Downloads stay on their device.
