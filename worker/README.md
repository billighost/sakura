# Sakura Telegram Worker

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

Render and Railway work the same way — Docker image, one instance, same env vars.
Whatever the platform, the non-negotiable setting is **max 1 instance**.

### 3. Point the app at it

In Vercel (all three environments):

```
TELEGRAM_WORKER_URL=https://sakura-telegram-worker.fly.dev
WORKER_SECRET=<the same secret>
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

**Logs:** `fly logs`. Everything is prefixed — `[boot]`, `[tg]`, `[http]`,
`[shutdown]`.

**Health:** `curl https://<app>.fly.dev/health`. `ok: false` with a `fatal`
message means the session was revoked; a new one is the only fix.

**Never scale past one machine.** `fly scale count 2` revokes the session on the
spot. `fly.toml` pins `max_machines_running = 1`.

**Restarts are safe.** `SIGTERM` disconnects cleanly first, so Telegram sees the
key released before the replacement container claims it.

**The volume is optional.** A DC migration mutates the session; caching it at
`SESSION_FILE` means a restart skips that handshake. Without a volume the
migration just repeats on boot, which is harmless. The cache is keyed by a
fingerprint of `TELEGRAM_SESSION_STRING`, so rotating the secret automatically
invalidates it — a stale cached session can never resurrect a key you've
replaced.

## If AUTH_KEY_DUPLICATED happens anyway

With one instance the only remaining explanation is a **second consumer** of the
same string. Check, in order:

1. A Vercel env var that still holds `TELEGRAM_SESSION_STRING` (all three
   environments — Production, Preview *and* Development).
2. A local `.env` with the string in it, on any machine.
3. A second worker instance, or another platform still running an old copy.
4. Somebody logged into that Telegram account with the same session elsewhere.

Then mint a new session (`npm run login`) and set it on the worker only.
