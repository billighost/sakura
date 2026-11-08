# Sakura Telegram Worker

The rebuilt `/v2/resolve` keeps the requested recording's title, native writing,
ordered credits, version and duration intact. It tries exact catalogue links,
then exact metadata queries, and continues to another supported bot when an
earlier result has the wrong tags. A rejected result is never made playable.
Duplicate requests share one search; verified recent documents and successful
resolutions avoid repeat bot messages. Conversations serialize per bot chat,
while independent chats and audio ranges run concurrently.

Localized title and artist spellings can arrive as server-verified metadata
aliases. Each complete alias must share an exact catalogue row or an
authoritative recording identifier with the request; version, credits, known
explicit edition and duration remain checked. The worker never creates guessed
transliterations or treats an album title as a song title. Capabilities report
`verified-metadata-aliases` when this matching support is deployed.

`POST /v2/capabilities` returns the deployed protocol and supported bot scopes;
`/health` includes the same capability summary. Unsupported fallback scopes do
not disable a supported primary chat. Waiting jobs have deadlines, so an expired
request never sends a later bot query.

Each resolve caller also has its own response deadline, including callers that
join an existing search. Expiring one caller keeps the shared chat operation
queued until its RPC settles. Late replies cannot trigger another query or
callback, return ready after the source deadline, or enter the successful cache.

Audio `GET`/`HEAD` responses include a strong document `ETag`. `If-Match` rejects
replaced documents with 412, and `If-Range` only returns partial bytes for the
same document. Expired Telegram file references refresh and resume at the last
emitted byte; a changed document ID, size, MIME or recording tag stops the
transfer. Opening a stream checks the document snapshot used for its headers.
Caller disconnects destroy the byte stream, including while a reference refresh
is pending, and cannot start another download after that refresh finishes.

New document-bound playback URLs include `documentTag`, the strong document
ETag, in their HMAC. Native GET and HEAD requests enforce that tag as `If-Match`,
so a replaced file returns 412 before audio bytes. The app checks the returned
tag and signature and uses its authenticated gateway when an older worker
cannot mint a bound URL. Existing unbound v2 URLs retain their original expiry.

Run `npm --prefix worker test` from the repository root. These tests use fake
Telegram documents and clients, and never connect a second MTProto session.

The single process that owns the Telegram MTProto session.

## Why this exists

Telegram **permanently revokes** an auth key the moment it sees that key on two
live connections from different IPs. It doesn't warn or throttle — it revokes,
and the only cure is generating a new session by hand.

Running MTProto inside Vercel route handlers cannot satisfy that rule:

- Vercel runs **many instances concurrently**, each with its own `globalThis`,
  each on its own IP.
- A distributed lock around `connect()` doesn't help. It serialises the
  *handshake*, but the socket outlives the lock — instance A is still connected
  on IP A when instance B takes the lock and connects on IP B.
- **Preview deployments** inherit the same env vars by default, so they're a
  third fleet holding the same key.

This worker replaces all of that with one process, one connection, for its whole
lifetime. `AUTH_KEY_DUPLICATED` isn't defended against here — it's unreachable.

## Setup

### 1. Mint a session string

On your own machine:

```bash
cd worker
npm install
cp .env.example .env      # fill in TELEGRAM_API_ID and TELEGRAM_API_HASH
npm run login
```

It prints a `TELEGRAM_SESSION_STRING`. **That string goes in exactly one place.**

### 2. Deploy

**On Render:** follow [`../DEPLOY-WORKER.md`](../DEPLOY-WORKER.md). Render needs
two things Fly doesn't, and both cost money: a **paid** instance and an attached
**disk**. The disk isn't for storage — it's the only documented way to stop
Render's zero-downtime deploy running the old and new instance side by side,
which would hold one auth key on two IPs and revoke it. `render.yaml` at the repo
root encodes the whole configuration.

**On Fly:**

```bash
fly launch --no-deploy       # first time only; keeps the fly.toml in this dir
fly volumes create tg_data --size 1 --region iad   # optional, see below

fly secrets set \
  TELEGRAM_API_ID='...' \
  TELEGRAM_API_HASH='...' \
  TELEGRAM_SESSION_STRING='...' \
  TELEGRAM_BOT_USERNAME='musicshuntersbot' \
  WORKER_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

fly deploy
```

Whatever the platform, two settings are non-negotiable: **max 1 instance**, and
**no overlap between the old and new instance during a deploy**. Check how your
platform rolls deploys before trusting it — the sensible default everywhere else
is the dangerous one here.

### 3. Point the app at it

In Vercel (all three environments):

```
TELEGRAM_WORKER_URL=https://sakura-tg-worker.onrender.com
WORKER_SECRET=<the same secret>
TELEGRAM_WORKER_DIRECT_AUDIO=1
```

### 4. Remove the session from everywhere else

This is the step that stops the error coming back:

```bash
vercel env rm TELEGRAM_SESSION_STRING production
vercel env rm TELEGRAM_SESSION_STRING preview
vercel env rm TELEGRAM_SESSION_STRING development
```

And delete `TELEGRAM_SESSION_STRING` from your local `.env`. Local development
points `TELEGRAM_WORKER_URL` at the deployed worker — one session, one process,
regardless of where the app runs.

Vercel no longer needs `TELEGRAM_API_ID` or `TELEGRAM_API_HASH` either.

## API

Everything except `/health` requires `Authorization: Bearer $WORKER_SECRET`.

| Route | Body / params | Returns |
|---|---|---|
| `GET /health` | — | `{ok, connected, fatal, uptimeSec, queueDepth}`; 503 when unhealthy |
| `POST /search` | `{query, timeoutMs?, botUsername?}` | `{buttonMessageId, buttons[]}` |
| `POST /search-and-select` | `{query, targetDuration?, expectedTitle?, expectedArtist?, searchTimeoutMs?, selectTimeoutMs?, botUsername?}` | `MusicResult` |
| `POST /select` | `{buttonMessageId, buttonIndex, timeoutMs?, botUsername?}` | `MusicResult` |
| `POST /import` | `{url, botUsername?}` | NDJSON: `{type:"start"}`, `{type:"track",track}`…, `{type:"done",count}` or `{type:"error",message}` |
| `POST /audio-info` | `{messageId}` | `{size, mimeType, title, artist, duration}` |
| `POST /sign-audio` | `{messageId, ttlSeconds?}` | `{path, expiresAt}` |
| `POST /v2/audio-info` | `{messageId, chatScope, refresh?}` | Verified document identity, metadata, size and MIME |
| `POST /v2/sign-audio` | `{messageId, chatScope, documentTag?, ttlSeconds?}` | `{path, expiresAt}` with signed document precondition when supplied |
| `GET\|HEAD /v2/audio/:scope/:id` | Signed URL or bearer; `Range`, `If-Range`, `If-Match` | 200/206/412/416 audio |
| `POST /download` | `{messageId}` | raw bytes, `Content-Length` set |
| `GET\|HEAD /audio/:id` | `Range` header honoured | 200/206/416 audio |

### Signed audio URLs

`POST /sign-audio` returns a path carrying an HMAC and an expiry. Hand that to a
browser and it fetches audio **directly from the worker**, so the bytes never
transit Vercel — on a free plan that's the difference between a bandwidth ceiling
measured in songs and one measured in albums. The signature covers the message id
*and* the expiry, so neither can be edited by whoever holds the URL.

## Status codes

Errors are mapped so the caller can tell retriable from terminal:

| Code | Meaning |
|---|---|
| 404 | Message or track not found |
| 424 | Bot demands a channel subscription — needs a human |
| 429 | Bot's own rate limit hit |
| 503 | Session revoked (`fatal`) — needs a new session string |
| 504 | Bot didn't answer in time |

## Operations

**Logs:** `fly logs`, or Render's Logs tab. Everything is prefixed — `[boot]`,
`[tg]`, `[http]`, `[shutdown]`. `[tg] connected as … — this process now owns the
session` is the line that says the invariant holds.

**Health:** `curl https://<host>/health`. `ok: false` with a `fatal` message means
the session was revoked; a new one is the only fix.

**Never scale past one machine.** `fly scale count 2` revokes the session on the
spot. `fly.toml` pins `max_machines_running = 1`; `render.yaml` pins
`numInstances: 1`, and an attached disk makes Render refuse to scale out anyway.

**Restarts are safe.** `SIGTERM` disconnects cleanly first, so Telegram sees the
key released before the replacement container claims it.

**The disk is optional on Fly, mandatory on Render.** A DC migration mutates the
session; caching it at `SESSION_FILE` means a restart skips that handshake.
Without a volume the migration just repeats on boot, which is harmless — so on Fly
it's a small optimisation. On Render the disk is load-bearing for a completely
different reason: attaching one is what disables zero-downtime deploys. Either
way the cache is keyed by a fingerprint of `TELEGRAM_SESSION_STRING`, so rotating
the secret automatically invalidates it — a stale cached session can never
resurrect a key you've replaced.

## If AUTH_KEY_DUPLICATED happens anyway

With one instance the only remaining explanation is a **second consumer** of the
same string. Check, in order:

1. A Vercel env var that still holds `TELEGRAM_SESSION_STRING` (all three
   environments — Production, Preview *and* Development).
2. A local `.env` with the string in it, on any machine.
3. A second worker instance, or another platform still running an old copy.
4. Somebody logged into that Telegram account with the same session elsewhere.

Then mint a new session (`npm run login`) and set it on the worker only.
