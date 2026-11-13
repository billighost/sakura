# Routing, resource ownership and public-share verification

Implemented from the approved 12 November performance review. The identified
production baseline is the primary agent's build of `5229fdb` on local port 3117.
No deployment, live data mutation, push or migration was performed.

| Plan item | Final behavior |
| --- | --- |
| R1/R3 data intent | Liked intent warms only liked membership. Top Songs warms `/api/v2/profile`, matching its screen, rather than the invalid `mixes/top-songs` identity. The React owner separately removes Liked's unused all-library subscription. |
| R2 onboarding | Artist search requests `kind=artists` using the canonical resource key. Main Search still prepares all entity types. |
| R4 resource ownership | `loadResource(account,path,boolean)` remains compatible. Its additional options accept `force`, `signal` and `kind`. Visible hooks, retry, subscriber-triggered refresh, route speculation, Search paging, Library paging, Mix Quick Play and collection actions own cancellable leases. One consumer leaving cannot cancel another. The last owner releases transport and detaches the operation; a late transport response cannot block or overwrite a subsequent request. |
| R5 presentation | Equivalent room refreshes share a read and application. Captured local state and server receipt timestamps fence old reads. Unchanged receipts avoid storage writes. A newer pending edit drains behind an older write. Playlist retry/invalidation cleanup is owned by the React screen changes. |
| R7 public share | The authoritative public card streams independently of the optional account-dependent action. Existing/deleted/unavailable accounts select the appropriate safe action without gating public lyrics/artwork/title. Share revocation still requires the authoritative read. |
| D1 compatibility | Old persistent resource envelopes are normalized with `normalizeProductDto`; canonical card objects remain shared. Changed legacy envelopes are persisted in canonical form. |
| F4 integration | Route cache announcements include the loaded static assets and the completeness flag collected by `cacheClientAssets`. Service-worker ownership and retirement remain in the offline subsystem. |

The subscriber-refresh regression also exposed a pre-existing revocation bug:
ordinary invalidation sets `updatedAt` to zero, which previously satisfied
`updatedAt <= revokedAt` even when the revocation value was zero. The check now
requires a positive revocation. Useful stale content remains during ordinary
refresh; actual missing/session/expiry/erasure fences continue to drop it.

## Evidence and limits

These are current function/count or local fixture observations, not production
latency percentiles. The browser intercepts every API, blocks root/shared Server
Component endpoints that could read a database, uses a synthetic signed account,
and disables service workers.

| Check | Observation |
| --- | --- |
| Onboarding provider selection | Actual injected catalog helper: four upstream requests for all kinds, two for artists only, identical one-artist result. |
| Shared resource | Two owners share one fetch. Cancelling speculation leaves the visible owner alive. A sole cancelled owner settles before an ignored-abort transport finishes; the next request proceeds and its result survives the old response. |
| Subscriber invalidation | Leaving the last subscribed room aborts its automatic refresh; ordinary invalidation retains usable previous content. |
| Presentation refresh | Baseline actual VM function starts two GETs for two simultaneous triggers; current implementation starts one. An unchanged receipt writes nothing. Older reads do not replace newer acknowledged choices. |
| Public streaming | Actual current page/component source with React streaming and mocked Next/auth/share dependencies paints public content before delayed account completion; deleted/unavailable accounts use sign-in actions; invalid/revoked shares remain unavailable. This is not a production Next RSC benchmark. |
| Production Search baseline | Two query edits and three tab changes already start zero `/search` RSC requests. Native history replacement also starts zero. Other recorded RSC requests are automatic destination prefetches, identified by their prefetch headers. |
| Production stalled paging baseline | The new query makes zero pagination requests during the 750 ms observation before its abandoned old page is released. The old request blocks the paging control; a manual request can continue after release. |
| Production onboarding baseline | Search request lacks `kind`; the integrated current build must demonstrate `kind=artists`. |

The focused resource, prefetch, presentation and streaming suites passed 38 checks
before the final subscriber regression was added. The final resource suite passed
all 18 checks, including that regression and the existing revocation/erasure
cases. Scoped lint passed with no findings, and the scoped diff whitespace check
passed. Full TypeScript, production build and integrated browser comparisons are
the primary agent's final gates.

## Conditional choices retained

R6 native query-history replacement was deliberately rejected: the current
installed router already avoids the proposed `/search` round trips in the safe
production fixture. The existing debounce, router/offline behavior and modified
link interactions remain intact. Large member-search architecture remains
measurement-gated after the membership DTO and rendering improvements.

A6 root/login authority remains unchanged. API interception cannot isolate the
root's Server Component account read, and artificially blocking root prefetch
distorts login router traces. Those observations cannot justify relaxing fresh
account checks or claiming a measured login improvement.

Reproduce the production comparison after the integrated build is ready:

```powershell
$env:SAKURA_TEST_URL='http://127.0.0.1:<current-port>'
$env:SAKURA_ROUTING_EXPECT_OPTIMIZED='1'
$env:SAKURA_ROUTING_REPORT='.local/routing-review-current.json'
node scripts/rebuild-routing-review-browser.mjs
```

The optimized assertion requires new-query paging to proceed before the old page
is released and every onboarding search to request artists only. Raw baseline
details are in ignored `.local/routing-review-baseline.json`. The shared-streaming
suite must also be included in the repository's relevant test gate.
