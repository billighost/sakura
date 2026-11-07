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
