# Sakura PWA and offline navigation audit

Reviewed the installed Next.js 16.4.5 documentation before changing its routing behavior, specifically `node_modules/next/dist/docs/01-app/02-guides/offline-support.md`, `01-getting-started/04-linking-and-navigating.md`, `02-guides/progressive-web-apps.md`, and the `useOffline` and `Link` API references.

## Findings and implementation

| Area | Finding | Change |
| --- | --- | --- |
| Offline clicks | The old worker deliberately bypassed RSC requests. Next's experimental offline support holds failed navigations pending until reconnection; it does not persist pages across a reload. Consequently, a Downloads link could freeze despite the document being available in another tab. | The shared route frame can render Sakura's existing client music pages directly from the URL, using the documented native History integration. This preserves the player provider, account and queue through offline navigation. |
| Cold launch and deep links | The old worker cached only full document navigations, so client-visited artist and album pages had no document entry. Unknown offline destinations redirected to `/offline`. | Client visits ask the worker to prepare their documents and hashed dependencies. A neutral `/offline` shell can also be served under the requested music URL, preserving artist/album identities, Search queries and browser history. |
| Query controls and shortcuts | Search tabs, Search typing and header/keyboard shortcuts used imperative server navigations. | Shared URL helpers keep these controls usable through native History while the offline shell is active. |
| Wi-Fi without internet | `navigator.onLine` can remain true when the origin cannot be reached. | Framework `useOffline` detection activates the local renderer. An interrupted link's recent target is retained so the first click can complete locally. |
| Static dependencies | The old cache evicted arbitrary entries after 250 requests, potentially deleting modules needed for offline pages. | Immutable hashed JavaScript/CSS/font assets have a dedicated cache without arbitrary entry eviction. A deployment does not delete the artwork cache or another open page's old dependencies. |
| Artwork | Multiple cards and player consumers could request the same image, and artwork was outside worker caching. | Successful image responses use a persistent cache first and share one in-flight fetch. Public local image assets use the same policy; error responses are never saved as artwork. |
| Account safety | Router payloads vary by router state; private JSON varies by account. | Account JSON remains in the application account-scoped store. RSC requests remain outside the shared worker cache. Redirected authentication documents cannot replace prepared music pages. |
| Updating | Registration swallowed every error and did not explicitly avoid the HTTP cache for worker updates. Development unregistered every worker at the origin. | Production registration sets `updateViaCache: "none"`, refreshes on visible reconnection, warms the shell, and keeps the player document running through controller changes. Development leaves unrelated registrations intact. |
| Installation | Existing manifest already offered standalone display, deep scope and shortcuts. Browser chrome followed the OS even when Sakura used an explicit different theme. | Added a scalable detailed SVG icon, Discover/Bloom shortcuts and an explicit preference for installing the PWA. Browser/status-bar colors follow Sakura's actual theme. Existing maskable PNG and Apple icon paths are preserved. |

## Additional PWA improvements assessed

- **Foreground reconnection drain and idempotent outboxes:** required for listening and library edits. Service-worker Background Sync has limited platform coverage, particularly on iOS, so it cannot be the only delivery path. Keep operations until an explicit matching server receipt and retry on foreground, connection recovery and normal usage.
- **Persistent device storage and portable backups:** reduce accidental eviction and give users control over their saved state. Browser storage quotas, site-data deletion and OS eviction mean an absolute guarantee of permanent device storage would be inaccurate. Storage failures should be visible, with redundant journals for small irreplaceable edits and listening evidence.
- **Clear offline readiness:** show which complete songs are verified locally, device storage usage, pending changes and backup/protection controls. A previously viewed catalog page can remain readable while undownloaded audio still needs a connection.
- **Media Session and audio lifecycle:** retain lock-screen controls and playback state independently of route rendering. Resume downloaded content using verified device bytes; avoid automatic document reloads during a worker update.
- **Reduced motion and installation surfaces:** detailed animation needs a complete still presentation and a skip path. Installation prompts should follow platform capability and user intent; an unsolicited permission prompt is unnecessary.
- **Push notifications, Web Share Target and file handlers:** useful possible future features, but require user-facing flows and server/platform support beyond this offline repair. No notification permission is requested by this change.

## Verification

- `scripts/rebuild-pwa.test.ts`: deep-link shell fallback, module warming, twenty consumers sharing one artwork fetch, persisted image reuse after worker restart, account/RSC cache isolation, quota handling and authentication redirect protection.
- `scripts/rebuild-pwa-browser.mjs`: built production pages behind a local synthetic API proxy, an actual service worker and browser offline mode. Covers cold Home, regular Downloads clicks, saved audio, artist/album navigation, Back/Forward, Search queries/tabs, cold deep links and reconnection without real account writes.
- Existing navigation and progressive-audio regression suites continue to verify fragment scrolling, welcome lifecycle, byte-range integrity and revoked playback capabilities.

## References

- Next.js [offline support](https://nextjs.org/docs/app/guides/offline-support): soft navigation retry differs from durable service-worker caching.
- Next.js [linking and navigating](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api): native History updates integrate with `usePathname` and `useSearchParams`.
- Next.js [PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps): manifest, installation, worker and platform guidance.
- MDN [Cache Storage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage), [storage persistence](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), [Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) and [worker registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register).
