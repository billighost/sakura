# Deploying the Telegram worker on Render

The worker is one long-lived Node process that holds the Telegram MTProto
session. Everything below exists to protect a single invariant:

> **Exactly one process, anywhere in the world, may hold the session at a time.**

Telegram permanently revokes an auth key the moment it sees that key on two live
connections. Not "rate-limits" — revokes. That is what `AUTH_KEY_DUPLICATED`
means, and it is why the session cannot live on Vercel: every serverless
instance has its own IP and its own memory, and a lock can serialise the
handshake but not the socket that outlives it.

Read the two findings below before you click anything. Both of them change what
you have to buy.

---

## 1. The worker needs a **paid** instance, and a **disk**

Render's default deploy behaviour would revoke the session on your first
redeploy. From Render's own docs:

> Adding a disk to a service prevents zero-downtime deploys. When you redeploy
> your service, Render stops the existing instance **before** bringing up the new
> instance. This instance swap takes a few seconds, during which your service is
> unavailable.

Read that again with the invariant in mind. **Without** a disk, Render starts the
new instance while the old one is still serving and only stops the old one once
the new one is healthy — two processes, two IPs, one auth key, revoked. **With** a
disk, Render stops the old one first. The few seconds of downtime that the docs
present as the cost is the thing we are buying.

And:

> You can attach a persistent disk to a paid Render web service, private
> service, or background worker.

So: **disk required → paid instance required.** The `starter` plan (512 MB, 0.5
CPU) is plenty — the worker streams bytes through without buffering files.

The free tier is unusable here for three separate reasons, any one of which is
fatal: no disk, it spins down after 15 minutes idle (a ~1 minute cold start on
every play), and Render states it "might restart a Free web service at any
time."

There is no dollar figure in this document because Render does not publish one
anywhere in its docs — the prices live only on the JavaScript-rendered pricing
page. Check <https://render.com/pricing> yourself before committing.

## 2. Bandwidth is the real ceiling, not CPU

Outbound bandwidth is billed against your **workspace plan**, not the instance:

| Workspace plan | Outbound / month |
| -------------- | ---------------- |
| Hobby          | 5 GB             |
| Pro            | 25 GB            |
| Scale          | 1 TB             |

Inbound is free. Unused allowance does not roll over. And:

> Without a payment method on file, Render spins down your workspace's services
> until the start of the next month.

For a music app, 5 GB is roughly **1,000 plays** at 5 MB a song. That is the
number to plan around. Two consequences:

- Keep `TELEGRAM_WORKER_DIRECT_AUDIO=1` on Vercel. It makes `/api/stream` answer
  with a 302 to a short-lived signed worker URL instead of piping the bytes
  through Vercel. The worker's egress is identical either way; proxying just adds
  a second charge on Vercel's side for the same bytes.
- The download cache matters more than it looks. Every song served from cache is
  a song that does not cross Render's meter.

---

## Step by step

### 1. Mint the session string

Do this **once**, locally, and treat the output like a password. It is a
credential for a real Telegram account.

```bash
cd worker
npm install
npm run login
```

It asks for the phone number, the code, and the 2FA password if the account has
one, then prints a session string.

**The string goes into exactly one place: Render's dashboard.** Not into a file,
not into `.env`, not into a chat message, not into Vercel. Every previous
`AUTH_KEY_DUPLICATED` you hit came from a second copy of one of these existing
somewhere it was forgotten about.

If a login prompt ever appears in the Render logs, the key was revoked and you
start again from this step.

### 2. Create the service

Dashboard → **New** → **Web Service** → connect `billighost/sakura`.

| Field           | Value                        |
| --------------- | ---------------------------- |
| Language        | **Docker**                   |
| Branch          | `master`                     |
| Root Directory  | `worker`                     |
| Region          | pick the one nearest Vercel — `Virginia (US East)` matches Vercel's `iad` default |
| Instance Type   | **Starter** or higher (not Free) |

Region is fixed once the service exists; changing it later means a new service.

Setting Root Directory to `worker` also means commits that touch nothing under
`worker/` will not trigger a rebuild. That is deliberate — every rebuild is a
brief outage now, so app-only pushes should not cause one.

### 3. Add the disk — do this before the first successful deploy

Service → **Settings** → **Disks** → **Add Disk**:

| Field      | Value            |
| ---------- | ---------------- |
| Name       | `tg-session`     |
| Mount Path | `/var/data`      |
| Size       | `1 GB`           |

Size can be increased later but never decreased, so start small.

This is the step that disables zero-downtime deploys. Do not skip it, and do not
remove the disk later to "get zero-downtime back" — that trade is the bug.

### 4. Paste the environment

Service → **Environment** → **Environment Variables** → **Add from .env**, and
paste the contents of `worker/.env.render`.

That file is generated with your real values already in it and is gitignored.
`TELEGRAM_SESSION_STRING` is deliberately left **empty** in it — fill that one in
by hand in the dashboard, from step 1.

What each key is for:

| Key                       | Notes                                              |
| ------------------------- | -------------------------------------------------- |
| `TELEGRAM_API_ID`         | from my.telegram.org, same as local                |
| `TELEGRAM_API_HASH`       | ditto                                              |
| `TELEGRAM_SESSION_STRING` | **paste by hand, here only**                       |
| `TELEGRAM_BOT_USERNAME`   | the bot the session talks to                       |
| `WORKER_SECRET`           | bearer token; must match Vercel byte for byte      |
| `SESSION_FILE`            | `/var/data/session.json` — must be inside the disk |
| `NODE_ENV`                | `production`                                       |
| `PORT`                    | `8080`                                             |

`SESSION_FILE` caches the session *after* Telegram's DC migration mutates it.
Without it every boot repeats the migration handshake. It is a cache, not the
source of truth: the file records a fingerprint of the env session string, and a
file whose fingerprint no longer matches is ignored — so rotating
`TELEGRAM_SESSION_STRING` cannot be undone by a stale file. If the logs say
`could not persist session: EACCES`, the mount is not writable by the container's
`node` user; the worker carries on regardless and you lose one handshake per
boot.

### 5. Health check

Service → **Settings** → **Health Check Path** → `/health`.

`/health` is unauthenticated on purpose — platform probes cannot carry a bearer
token. It returns 503 while the Telegram client is disconnected and 200 once the
session is held, and the process connects *before* it starts listening. So a
revoked or missing session fails the deploy loudly instead of leaving a worker up
that 500s on every request.

Be aware of the interaction with the disk: because the old instance is stopped
first, a deploy that fails its health check leaves the worker **down**, not rolled
back. Check the logs when a deploy goes red.

### 6. Verify it, before touching Vercel

Grab the URL Render assigns (`https://sakura-tg-worker.onrender.com`) and:

```bash
curl -s https://sakura-tg-worker.onrender.com/health
```

Expect `200` and a body reporting `ok: true`. The logs should show:

```
[boot] connecting to Telegram…
[tg] connected as @… — this process now owns the session
[boot] listening on 0.0.0.0:8080
```

If `/health` returns 503, read the log line above it — a revoked key, a wrong
`TELEGRAM_API_ID`/`HASH` pair, and a truncated session string all look different
there.

### 7. Point Vercel at it

From `worker/.env.vercel` (also gitignored, also pre-filled), add to the Sakura
project in **all three** environments — Production, Preview and Development:

```bash
vercel env add TELEGRAM_WORKER_URL production        # https://sakura-tg-worker.onrender.com
vercel env add WORKER_SECRET production              # identical to the worker's copy
vercel env add TELEGRAM_WORKER_DIRECT_AUDIO production   # 1
```

No trailing slash on the URL. If `WORKER_SECRET` differs by even one character,
every Telegram-backed feature returns 401.

All three environments, including Preview, because a preview deployment with no
worker URL is a deployment whose Telegram features are simply broken — and
previews are where you would notice least.

### 8. Remove the old credentials — the actual fix

This is the step that ends the recurring error. As long as these exist anywhere,
something can still open a second connection:

```bash
vercel env rm TELEGRAM_SESSION_STRING production
vercel env rm TELEGRAM_SESSION_STRING preview
vercel env rm TELEGRAM_SESSION_STRING development
vercel env rm TELEGRAM_API_ID  production   # and preview, development
vercel env rm TELEGRAM_API_HASH production  # and preview, development
```

Then delete the same three keys from your local `.env`.

The app has **no in-process Telegram fallback any more**, deliberately — a
fallback able to open an MTProto connection from Vercel would recreate the entire
problem, and would fire on the day nobody expected it: a forgotten `.env`, a
rollback, a preview build. If `TELEGRAM_SESSION_STRING` is present in a Vercel
environment, the app logs an error about it on boot. Believe the log.

Keep `TELEGRAM_BOT_USERNAME` on Vercel — the app uses it to build the fallback
bot chain and it is not a secret.

---

## Deploying with the blueprint instead

`render.yaml` at the repo root encodes every setting above. Dashboard → **New**
→ **Blueprint** → select the repo, and Render prompts for the four `sync: false`
secrets.

The trade-off: the blueprint asks for secrets one field at a time, so you cannot
use the `.env` paste from step 4. Use the manual flow if you want the paste; keep
`render.yaml` either way, because it is where the reasoning for the disk, the
instance count and the shutdown delay is written down.

## Operating it

**Rotating the session.** Run `npm run login` again, update
`TELEGRAM_SESSION_STRING` in Render, save. Render restarts the service — old
instance stopped first, so the two keys never overlap. The cached session file's
fingerprint stops matching and it is ignored automatically.

**Redeploying.** Expect a few seconds of downtime. During it, Telegram-backed
requests from the app fail; playback of already-cached audio does not.

**Never run two.** Not a second Render service, not a local `node index.js`
against the same session string while the deployed one is up, not a rollback that
runs alongside. One process. This is the whole design.

**Reading the logs.** `[tg] connected as … — this process now owns the session`
is the line that says the invariant holds. If you ever see it twice without a
shutdown in between, something is wrong.

## What went wrong the previous three times

Worth keeping, because each fix was locally reasonable and still failed:

1. **Separate prod and local session strings.** Vercel still ran many concurrent
   instances of the production one.
2. **Session moved into Redis with the env var as a fallback.** The fallback
   fired, and the lock serialised the handshake while the socket outlived it.
3. **A distributed lock around connect.** Same reason: the lock releases, the
   TCP connection does not.

The pattern is that all three tried to coordinate *many* processes. The only
thing that works is having *one*.
