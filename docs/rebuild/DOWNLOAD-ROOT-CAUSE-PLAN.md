# Download failures: investigation and proposed repair

Status: implemented and deployed after the user's Cloudflare approval. All five reported recordings passed complete transfer, full codec decoding, live production resolution and offline browser acceptance. See [the actual rollout](CLOUDFLARE-DOWNLOAD-ROLLOUT.md). The original investigation and proposed repair below were recorded on 2026-11-11 while Render was suspended.

## What is actually failing

All five reported recordings have existing canonical catalogue rows, **zero stored audio assets**, and failed source-resolution jobs. Fresh requests for each through the current `WorkerAudioDiscovery` return the same upstream **HTTP 503 HTML page**:

> Service Suspended
> This service has been suspended by its owner.

The worker's `/health` and authenticated `/v2/capabilities` return that page too. This failure occurs before the worker can search for or inspect a recording. **The user subsequently confirmed that Render suspended the worker because its bandwidth allowance was exhausted.** The HTTP trace itself establishes suspension; the bandwidth cause comes from the user's hosting-account information. Exact usage and recovery options should still be checked in the dashboard before deployment.

The current application misclassifies every HTTP 503 as `audio-worker-busy` in `src/rebuild/server/sources.ts:83`. `AudioResolutionJobs` wraps that as `no-ready-audio` with a `sourceReason`, and `responseIssue` ignores the source reason and shows the reported message: “We haven’t found a verified full recording yet.” This makes an infrastructure outage appear to be a problem with individual songs.

Deezer is a catalogue provider in this architecture. Spotify supplements catalogue search. The Telegram worker obtains audio, and Cloudinary can deliver a previously acquired, verified asset. Changing catalogue search cannot restore a suspended audio worker. The configured fallback bots also run inside that worker, so they do not provide independence from a worker outage.

There are additional historical identity failures that would remain after restoring service:

| Reported recording | Selected catalogue reference | Historical evidence and current replay |
| --- | --- | --- |
| sober / Norhan | Deezer `2394243075` | Recent jobs report `audio-worker-busy`; current catalogue metadata and Spotify ISRC counterpart are available. No earlier metadata mismatch was found in the inspected recent jobs. |
| The Endless Quest, `伴奏版` / 张碧晨 | Deezer `3920119021` | Earlier source candidates ended the long title with `…`, omitting the end of the title and instrumental designation. Current matching still rejects them for `title` after alias hydration. |
| Vibration / Fireboy Dml | Deezer `797948692` | Recent jobs report `audio-worker-busy`; the exact current row and Spotify ISRC counterpart exist. Capitalization of DML is already handled by normalization. |
| Yoga Music / the long Nature Sounds Relaxation artist credit | Deezer `134124440` | Earlier source candidates ended the performer at “Massage Therapy…”. Current matching still rejects them for `artist` after alias hydration. Exact catalogue credits contain one long provider artist name; arbitrarily splitting it into several artists would change its meaning. |
| Seul le temps de se détendre / Détente nature and featured artists | Deezer `2894768241` | Earlier candidates report `Musique naturelle, Naturaleza Sonidos`, a different credit. Current alias hydration does not establish that those names belong to the selected recording; rejection still reproduces. Equal title and 205-second duration are insufficient proof. |

The historical evidence is the application's stored worker-candidate response, not a new inspection of the underlying file. Whether the truncation was introduced by the bot, a message attribute, or the file's own tags cannot be determined until the worker is available and the file can be examined.

### Further defects and verification gaps

1. `parseRecordingTitle` recognizes English instrumental labels but **does not recognize `伴奏` or `伴奏版`**. Both currently produce an empty version kind. This prevents safe cross-language version matching and weakens the evidence used to admit aliases. Vocal and instrumental versions need an explicit distinction even when their durations are identical.
2. The local worker also reads title and performer from Telegram `DocumentAttributeAudio`. Deploying the existing local worker alone does not reconstruct text already truncated upstream. Its button parser requires recognizable metadata before requesting a file, which can prevent inspecting an otherwise useful candidate.
3. `AudioPromotions.completeAudio` verifies response shape, full byte count, and a SHA-256 digest. It does **not** decode the file or inspect embedded recording tags. A checksum proves byte integrity, not artist, vocal/instrumental identity, or audible completeness.
4. Full-file preparation shares a 110-second work window with source discovery. Slow acquisition can exhaust preparation time, leaving an otherwise playable source without the checksum required by offline saving. This is an architectural risk from the code, not the demonstrated cause of the current five failures.
5. The preceding audits used selected, fixed samples, mainly direct source discovery plus a 4 KiB opening range. The saved HOKO investigation already documented that direct discovery could pass while the production job failed. A successful start is not a completed offline save, and a completed byte transfer is not acoustic identification.
6. Previous documentation says the live worker lacked the latest local capabilities on 2026-11-08. Today's suspension prevents determining the deployed revision. A tested local change must be followed by deployment and a capability check before it can be credited with fixing live behavior.

## Evidence collected

- Read-only queries inspected the five canonical rows, their assets, and up to six recent jobs per recording. Database work used a read-only transaction; no library, account, settings, or listening data was changed.
- Fresh source-discovery requests reproduced the upstream suspension for **5/5 recordings**. Health and capability requests corroborated the outage.
- The actual `ProductionRecordingResolver`, `RecordingResolver`, and `AudioResolutionJobs` classes reproduced the complete `pending → failed → unavailable → misleading missing-audio message` chain for all five. This was a deterministic replay of the captured live 503 with catalogue snapshots and in-memory SQL writes, **not an authenticated live HTTP/browser download test**.
- Refreshing exact catalogue and artist aliases did not repair the historical truncated title, truncated artist, or unproven French artist mismatch.
- Three isolated diagnostic regressions currently fail as expected: suspended host classified as busy; infrastructure outage displayed as missing recording; Chinese instrumental version unrecognized.
- All **13 existing error and recording-job tests** passed. Their success alongside the new failing cases demonstrates the missing coverage.
- **Zero song audio bytes were transferred.** The suspended source prevents fresh full-file verification. Previous low-data audit notes were respected; existing byte-budget ledgers were not reset.

Sanitized findings are in [DOWNLOAD-ROOT-CAUSE-EVIDENCE.json](DOWNLOAD-ROOT-CAUSE-EVIDENCE.json). Private diagnostic scripts and traces are under `.local/download-root-audit*`, `.local/download-deeper-audit.mts`, `.local/download-production-replay.ts`, and `.local/download-root-regressions.ts`.

## Proposed implementation, in order

### 1. Restore and verify the audio worker

- The user confirmed bandwidth exhaustion, no payment card, and a requirement for hosted service. **Oracle is ruled out.** First validate a single SQLite-backed Cloudflare Durable Object as the Telegram owner; on-demand Vercel Daemons is a second researched route. See [WORKER-NO-CARD-WORKAROUNDS.md](WORKER-NO-CARD-WORKAROUNDS.md) for current free quotas, offline probe results, transport/update risks, and go/no-go checks.
- Inspect the current hosting event history, deployed commit, plan, and exact usage so the new host and bandwidth controls address the measured workload. Do not resume an exhausted service expecting the same free quota to behave differently.
- Deploy the reviewed worker changes and verify the exact expected protocol, features, allowed bot scopes, connection state, and build revision through health/capability responses. Add build revision reporting if absent.
- Keep exactly one main-DC connection owner for the existing Telegram authorization unless Telegram explicitly permits its documented bounded parallel/PFS mode. Current Telegram docs describe duplication from the same or different IPs, so an IP proxy alone is insufficient. A replacement must stop the old owner first; prove that update/eviction behavior cannot resurrect an old owner.
- Keep existing completed downloads and previously verified CDN assets usable during worker downtime. A gateway pointing back to the same unavailable worker does not count as an independent audio fallback.

Files: `worker/index.js`, `worker/README.md`, `DEPLOY-WORKER.md`, `render.yaml` or the selected hosting configuration. This step includes an operational change after plan approval; today's investigation did not resume, deploy, or create a service.

### 2. Preserve failure causes through the entire application

- Introduce typed source outcomes for infrastructure unavailable, worker disconnected, worker busy/queue full, provider rate limit, no source found, incomplete source metadata, identity conflict, preparation pending, and transfer/integrity failure.
- Treat an unexpected HTML/plain-text 503 as infrastructure unavailable. Recognize worker busy only from the appropriate structured worker response or rate-limit signal. Preserve a safe diagnostic code, retry advice, and request correlation; never expose raw upstream HTML or credentials to listeners.
- Use an explicit capability handshake with a bounded cache. A confirmed legacy worker may use compatibility mode; an arbitrary proxy 404/503 must not select or permanently cache a protocol downgrade.
- Carry outcomes through `AudioResolutionJobs`, resolver responses, playback resolution, and download storage. Persist a structured issue rather than relying on an error sentence surviving a reload.
- Show a service-availability message for an outage, a waiting/retry state for capacity or preparation, and a recording-availability message only after usable sources have actually been checked. Identity conflicts keep a recording-review state.

Files: `src/rebuild/server/contracts.ts`, `sources.ts`, `jobs.ts`, `runtime.ts`; `src/rebuild/app/errors.ts`, `MusicContext.tsx`, `downloadTypes.ts`, `downloadEngine.ts`, `downloadPresentation.ts`.

### 3. Recover complete source identity without accepting arbitrary matches

- Represent metadata completeness/provenance for each source field: complete file tag, message attribute, truncated text, missing field, or independently verified catalogue evidence. Truncated text is an evidence gap to investigate, not proof of a different recording and not proof of the requested one.
- Allow the worker to acquire a bounded candidate for inspection when a button or message has incomplete display text. The candidate remains unverified until file evidence passes; selecting it for inspection does not authorize playback, saving, or alias binding.
- Read embedded tags using a bounded probe where the container permits it; fall back to the acquired full file when necessary. Prefer complete embedded title, performer/credits, version, and identifiers over truncated message display attributes. Record contradictions instead of silently overwriting them with the requested metadata.
- Reuse the existing exact catalogue/ISRC/artist proof layer for published alternative spellings. Add stronger checks for conflicting or reused identifiers and changed credits before treating different artist names as an alias. Preserve the catalogue row the user selected.
- Never turn a title prefix, equal duration, a fuzzy search hit, a button label, or the requested Deezer ID into returned-file identity proof. If neither complete tags nor independently corroborated identity can establish the exact recording, continue to another source or return an explicit unverified outcome.
- Diagnose the French candidate's own file tags and identifiers. Accept it only if evidence establishes the selected recording and credits; otherwise seek a different verified source. Do not hard-code the three problematic song names into matching.

Files: `worker/rebuild/service.cjs`, worker file-metadata helper to be added, `src/rebuild/server/sources.ts`, `metadata-aliases.ts`, `artist-aliases.ts`, and `src/rebuild/core/matching.ts`. The worker image must include the chosen supported parser; `ffprobe` is available locally but is not currently installed in the worker image.

### 4. Make version parsing consistent across providers and worker builds

- Recognize Chinese instrumental markers and their version suffixes as instrumental evidence. Extend the same controlled, documented approach for other established localized version terms encountered in the audit.
- Normalize equivalent generic version labels consistently in both `identity.ts` and `matching.ts`. Preserve named remix, edit, language, and edition distinctions; do not remove every parenthetical phrase.
- Require compatible version evidence when admitting alternate catalogue spellings. Missing/truncated version information cannot authorize a vocal recording for an instrumental request.
- Revalidate affected stored aliases after the parser/evidence version changes. Use a targeted, versioned migration or read-time revalidation; preserve canonical IDs and complete offline artifacts. Review suspect aliases/assets before invalidating them.
- Regenerate the worker's shared matching core with `scripts/build-rebuild-worker.cjs`, run both core/worker tests, and deploy that generated code alongside the server changes.

Files: `src/rebuild/core/identity.ts`, `matching.ts`, `types.ts` if completeness fields are shared, `src/rebuild/server/input.ts`, and generated `worker/rebuild/core/*`.

### 5. Make discovery, full-file verification, and saving recoverable stages

- Give source discovery and full-file verification separate persisted stages and leases. A useful source should not be discarded because catalogue enrichment consumed a preparation window. Use progress/idle deadlines and an explicit bounded total acquisition budget rather than increasing one undifferentiated timeout again.
- Run resumable acquisition/verification on the persistent worker when the file needs more time than an application request allows. Persist progress and immutable source identity; application routes poll bounded status responses. Keep cancellation and ownership explicit.
- Verify full file size, SHA-256, container readability, and decoded duration before calling an offline artifact complete. Corroborate available embedded tags against the selected recording. Probe/decode representative positions and the ending to catch a mislabeled preview or corrupt/truncated media container.
- Keep byte integrity and recording identity as separate evidence. Chromaprint/AcoustID can add corroboration when a known reference exists; it cannot prove every obscure recording, and should not be a mandatory dependency that makes missing fingerprint coverage a new outage.
- Coalesce verification by immutable source/document identity so repeated resolve requests and multiple listeners do not repeatedly acquire the same full file. Reuse an existing verified checksum and stored asset. Keep storage/transfer limits and cleanup explicit.
- CDN publication is an optional delivery stage after source verification. Its quota or upload failure must not revoke a verified original or cause a repeated source search. Full verification must still finish before an offline save is reported complete.

Files: `src/rebuild/server/jobs.ts`, `promotion.ts`, `gateway.ts`, worker job/verification code, necessary versioned database migration, and `src/rebuild/app/downloadEngine.ts`/`recordingJob.ts`.

### 6. Recover automatically without retry storms

- Use shared health/circuit-breaker state so a worker outage does not create a fresh futile search for each track, tab, and retry click. Probe recovery with backoff and jitter; retain requested saves in a waiting state.
- Respect provider retry advice and bot cooldowns. Infrastructure waits must not spend the recording's candidate-search attempt budget. Persist useful source attempts and rejection categories so later retries avoid repeating the same failed strategy indefinitely.
- On service recovery, resume requested saves at bounded concurrency. Preserve verified chunks when the immutable source fingerprint matches; discard only incompatible chunks if the source changes. Keep current cancellation, account isolation, tab coordination, and atomic completion guarantees.
- Retain safe source outcomes, attempt counts, deployed build revision, and timings in diagnostics. Add health/usage monitoring and operator-visible alerts for suspension, session failure, saturation, and widespread resolution failure. No email/Slack messages will be sent without separate authorization.

Files: worker queue/service, `src/rebuild/server/jobs.ts` and health state, `src/rebuild/app/downloadEngine.ts`, download persistence/presentation, and deployment diagnostics.

### 7. Keep catalogue choice separate from audio-source coverage

Recommendation: **retain Deezer and configured Spotify catalogue federation for this repair**. Make provider capabilities explicit and keep source discovery behind an extensible adapter. Add an audio provider only after demonstrating exact-recording coverage, download permission/capability, and acceptable limits.

Apple's public search API is a useful optional metadata experiment, especially for alternate display titles. It should not be the primary repair and cannot authorize a cross-provider identity binding from title/artist similarity alone. Adding Apple would require explicit provider types, exact-reference parsing, catalogue adapters, metadata-only handling, and provenance tests.

| Option | What the research established | Recommendation |
| --- | --- | --- |
| Deezer | Current exact rows exist for all five selected references. The app uses catalogue metadata; the developer documentation page requires login, limiting public documentation inspection. | Keep as a catalogue source; monitor its availability separately. |
| Spotify Web API | Current exact/ISRC counterparts exist for sober and Vibration; the official track endpoint supplies catalogue metadata and a deprecated, nullable 30-second preview. Current quota docs describe development-mode restrictions. | Keep the existing configured supplement; it does not supply downloadable full files through this API. |
| Apple iTunes Search | Five metadata-only US-market searches found likely corresponding metadata for sober, Vibration, and the Chinese vocal/instrumental releases. No exact match for either relaxation target appeared in those bounded results. The archived docs specify approximately 20 calls/minute and promotional preview restrictions. No preview audio was fetched. | Optional metadata experiment; this small result does not establish superior overall coverage or exact cross-provider identity. |
| MusicBrainz | Recording identifiers, artist aliases, and relationships can corroborate identity. Public API documentation states a one-request/second IP limit and distinguishes noncommercial/commercial use. It does not supply song audio. | Continue using cached, rate-limited identity evidence. |
| Audius | A real Vibration search returned three uploads from unverified accounts, no ISRC, and `is_downloadable: false` for each. Title similarity is insufficient authenticity evidence. | Consider only verified, eligible catalogue entries; reject these observed uploads as replacement download sources. |
| Jamendo | Official API documents artist-controlled `audiodownload_allowed`, download URLs, licensing fields, and a client ID requirement. Its catalogue is a separate offering; no exact coverage for these five was established. | Possible additional catalogue of eligible music, not an assumed mainstream replacement. |
| Chromaprint/AcoustID | Fingerprint lookup can return MusicBrainz evidence where known fingerprints exist. AcoustID documents API-key, rate-limit, and usage conditions. It supplies identity evidence rather than audio. | Optional corroboration with clear confidence/coverage limits. |

No investigated free API establishes universal, authentic, full-file coverage for the existing catalogue. Another bot inside the same worker improves catalogue coverage only when that bot can supply the recording; another host using the same session must not overlap ownership. Independent sources require their own valid identity and acquisition evidence.

### 8. Require evidence that closes the gaps before calling the repair finished

1. Move the three currently failing diagnostic cases into maintained suites and make them pass. Add fixtures for the actual long Chinese title, long Yoga artist, French credit mismatch, common short titles, and identical-duration vocal/instrumental pairs.
2. Add generated/property-driven matching cases for long metadata, Unicode, combined known credits, localized versions, and conflicting identifiers. Include negative controls: covers, remixes, missing version tags, previews, unrelated artists, and arbitrary prefix matches must remain unverified.
3. Exercise the actual production resolver/job/verification path under host HTML 503, cold start, unknown capability/scopes, disconnect, rate limit, queue expiry, recovery, slow acquisition, interrupted preparation, corrupt media, checksum change, and CDN failure. Assert precise outcomes and bounded retries.
4. Use real browser download controls against the application routes and reviewed worker build. Verify IndexedDB completion, SHA-256, one canonical save across aliases/tabs, reload/resume, cancel, account isolation, and offline playback through the ending. Fixtures can supply reproducible fault cases without consuming song bandwidth.
5. After restoration, check the five unchanged exact selected references live. Acquire full recordings where verified sources exist; report any source absence honestly. Record source identity, decoded duration, byte count, checksum, selected version, and listening review. A source unavailable for one target remains an open coverage issue; a different version does not count as fixing it.
6. Add a held-out, stratified sample beyond these five and the old thirty-song fixtures: new releases, obscure artists, long credits/titles, relaxation music, multilingual recordings, and version pairs. Report catalogue coverage, acquisition coverage, metadata/identity confidence, and full-save success separately. Never improve the success rate by excluding failed targets from the denominator.
7. Set a transfer budget from source sizes before real full-file checks, reuse verified local files, and distinguish startup-only runs from complete-save runs. Keep the previous capped ledgers intact. The completed repair needs a full-save audit; metadata-only evidence cannot substitute for it.
8. Run appropriate core/server/worker/download tests, TypeScript, build, and focused lint; verify capabilities on the deployed revision and run the live/browser acceptance there. Do not certify production from a local worker test.

Completion criteria: infrastructure failures retain their real cause; requests recover without uncontrolled retries; truncated metadata follows a safe inspection path; instrumental/vocal identity is enforced; files complete only after integrity/container checks; selected-recording identity is supported by recorded evidence; reported targets and held-out coverage are accounted for through the production path; and the deployed build matches the reviewed implementation.

## Decisions included in this approval

- Proceed with the worker/infrastructure, identity, job recovery, and acceptance work above; keep the current catalogue providers initially.
- Prepare the no-card Cloudflare Durable Object proof described in the updated hosting proposal, then migrate only after its runtime and ownership gates pass. The current offline adapter/bundle probes do not certify live safety. No paid hosting or device-based deployment fits the user's constraints.
- Treat Apple metadata support as an optional follow-up experiment rather than a prerequisite for fixing downloads. Additional audio sources need demonstrated coverage and identity evidence.
- Preserve existing user data and verified offline files; use versioned, targeted evidence revalidation instead of deleting the catalogue or download database.

This plan can prevent the demonstrated application failure patterns and make external outages recoverable and accurately reported. It cannot guarantee that every recording will always have a free, available source, or that external providers will never go offline. Missing evidence must remain visible rather than being resolved by saving a different song.

## Primary research sources

Retrieved on 2026-11-11; results of live metadata queries are included in the sanitized evidence file.

- [Render free instance limits and suspension conditions](https://render.com/docs/free)
- [Render disk and instance/deploy limitations](https://render.com/docs/disks)
- [Render deployment behavior](https://render.com/docs/deploys)
- [Spotify exact track endpoint, preview field, and policy notes](https://developer.spotify.com/documentation/web-api/reference/get-track)
- [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Deezer developer track documentation entry](https://developers.deezer.com/api/track) — login required in the fetched page
- [Apple archived Search API and limits](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)
- [Apple archived Search API usage terms](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) and [rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [Audius developer overview](https://docs.audius.co/developers/introduction/overview/) and [observed Vibration search](https://api.audius.co/v1/tracks/search?query=Vibration%20Fireboy%20DML&app_name=sakura_research&limit=5)
- [Jamendo tracks API and download eligibility](https://developer.jamendo.com/v3.0/tracks)
- [AcoustID fingerprint service](https://acoustid.org/webservice)
