# Sakura audio on Cloudflare Workers Free

Production Worker: https://sakura-audio.bb2010ng.workers.dev

Sakura remains on Vercel. This package runs the Telegram protocol inside one
SQLite Durable Object, addressed by a private stable identifier derived from the
authorization key. Every app environment using that key must use this same
Worker. Cloudflare does not promise a fixed egress IP; the protection is exclusive
connection ownership and fenced replacement, including file requests on the main
Telegram data centre.

## Install and configure

From the repository root, install the app and existing worker dependencies:

```powershell
npm ci
npm --prefix worker ci
npm install --global wrangler@4.105.0
wrangler login
```

The private root `.env` supplies `WORKER_SECRET`, `TELEGRAM_API_ID`,
`TELEGRAM_API_HASH`, `TELEGRAM_SESSION_STRING`, `TELEGRAM_BOT_USERNAME`, and
optional comma-separated `TELEGRAM_FALLBACK_BOTS`. Never commit this file or
paste credentials into chat. Cloudflare receives secrets through a temporary
ignored bulk file, which the deployment script removes afterward. The live
session and media-DC keys persist privately in Durable Object storage.

Before importing the authorization, explicitly stop Render and any local owner.
Then deploy from the repository root:

```powershell
node worker/cloudflare/deploy.mjs --enable --old-owner-stopped
```

This stages a disabled Worker, installs secrets, and enables acquisition. Keep
the Worker name and binding/migration stable. A replacement fences old transport
writes and waits up to 35 seconds after the latest write before reconnecting.
Per-client retirement blocks old reconnects and late session writes. RPC and
connection deadlines release stalled conversations; identical concurrent opens
share one client initialization.

Use the resulting HTTPS URL as `TELEGRAM_WORKER_URL` in Vercel Production and
Preview, retain the matching `WORKER_SECRET`, then redeploy Sakura. Do not run
another worker with the same authorization for a preview or test environment.

## Verification

```powershell
node scripts/build-rebuild-worker.cjs
npm --prefix worker test
node --test worker/cloudflare/deadline.test.mjs worker/cloudflare/tags.test.mjs worker/cloudflare/transport.test.mjs
node --import tsx --test scripts/rebuild-download-root.test.ts scripts/rebuild-audio-inspection.test.ts
```

To test the actual local Workers runtime, create an ignored
`worker/cloudflare/.dev.vars` containing only
`WORKER_SECRET="synthetic-runtime-proof-secret-123456"`, then run:

```powershell
wrangler dev --config worker/cloudflare/wrangler.proof.jsonc --port 8788 --local
```

In another terminal:

```powershell
node --test worker/cloudflare/runtime.test.mjs
```

The separate proof configuration disables real Telegram acquisition. Its
hosted TCP check sends only an unauthenticated `req_pq` handshake. Delete a
temporary hosted proof Worker after testing; its synthetic secret is public.
Production cannot invoke these proof endpoints.

`scripts/rebuild-cloudflare-audio-audit.mts` consumes the private discovery
snapshot, resumes exact ranges, validates full file structure/tags/duration,
decodes the complete file using locally installed FFmpeg, and records every
received audio byte against a persistent 50 MiB cap. It reuses verified files
and never resets the ledger.

## Operational limits

Authenticated `POST /v2/capabilities` reports acquisition state, connection
state, fatal session state, allowed bot scopes, and deployed revision. A public
`/health` reports router availability only. `POST /v2/source-audit` is an
authenticated, read-only diagnostic over up to 64 recent audio documents.

Audio stays outside Vercel when the browser uses signed Worker/CDN URLs.
New and resumed downloads try the resolved direct URL first, with the app
proxy retained as an alternate. Vercel still serves app/API requests, handles
initial full-file preparation and CDN verification/upload, and carries audio
when the proxy is needed; its transfer and compute quotas remain relevant.
Cloudflare streams with backpressure, limits simultaneous transfers to two,
and never stores whole songs in the Durable Object. Truncated bot attributes
can recover from up to 1 MiB of the file's own embedded tags, including artwork;
prefix matches only permit inspection and never authorize a recording.

Workers Free has quotas: currently 100,000 Durable Object requests/day,
13,000 GB-seconds/day, and SQLite storage limits. There is no added Worker
egress charge in the reviewed pricing. Telegram bot limits and existing
Cloudinary/Vercel allowances still apply. A free deployment cannot guarantee
every source stays available. Infrastructure failure, throttling, and an
unverified recording now have distinct outcomes; incomplete bytes never become
a completed offline save.

SQLite migrations use `new_sqlite_classes`, which is compatible with Workers
Free. No Containers, paid plan, payment card, or device kept running is required.
