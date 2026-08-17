# Deploying the Telegram worker on Render

The worker is one long-lived Node process that holds the Telegram MTProto
session. Everything below exists to protect a single invariant:

> **Exactly one process, anywhere in the world, may hold the session at a time.**

Telegram permanently revokes an auth key the moment it sees that key on two live
connections. Not "rate-limits" — revokes. That is what `AUTH_KEY_DUPLICATED`
means, and it is why the session cannot live on Vercel: every serverless
instance has its own IP and its own memory, and a lock can serialise the
handshake but not the socket that outlives it.

Read the three findings below before you click anything. The first two decide
whether you need to spend money.

---

## 1. A disk is what makes redeploys safe — and a disk means a paid instance

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

Two more things a paid instance buys, which matter for a music app: the free tier
spins down after 15 minutes idle, so the first play after a quiet spell waits
~1 minute for a cold start, and Render states it "might restart a Free web service
at any time."

None of that is fatal, though — see §2. If you can't spend money right now, the
free tier works with one manual step per deploy.

There is no dollar figure in this document because Render does not publish one
anywhere in its docs — the prices live only on the JavaScript-rendered pricing
page. Check <https://render.com/pricing> yourself before committing.

## 2. If you can't pay for a disk: suspend before every deploy

Without a disk you get zero-downtime deploys whether you want them or not, and
Render's docs are explicit that this is not plan-dependent:

> All service types redeploy with zero downtime, unless they attach a persistent
> disk.

So every redeploy overlaps: your original instance "continues to receive all
incoming traffic while the new instance is spinning up," and only "after 60
seconds" does Render SIGTERM the old one. Sixty seconds of two processes holding
one auth key from two IPs. That is the revocation, on a timer.

There is a free way out, and it's manual. **Suspend the service, deploy, resume.**

1. Turn **auto-deploy off**: Settings → Build & Deploy → Auto-Deploy → **No**.
   This is the important half. Leave it on and a routine `git push` triggers an
   overlapping deploy behind your back — you'd find out when Telegram logs you
   out.
2. Service → top-right menu → **Suspend Service**. Wait for the logs to show
   `[tg] disconnected cleanly — session released`. That line is your proof the
   key is free; don't skip it.
3. Push your commit.
4. **Resume Service**, which deploys the latest commit.

The cost is a cold start instead of a seamless swap. The benefit is that the two
processes provably never overlap, which is the only thing that matters here.

The rest of the free tier's behaviour is safe by comparison: spin-down after 15
minutes idle, spin-up on the next request, and Render's "might restart a Free web
service at any time" are all *stop, then start* — sequential, so the key is
released before it's reclaimed. It's only **deploys** that overlap.

## 3. Bandwidth is the real ceiling, not CPU

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
| Instance Type   | **Starter** or higher if you can — **Free** works with §2's manual step |

Region is fixed once the service exists; changing it later means a new service.

Leave **Health Check Path** and **Docker Command** alone for now, and do not add
a `PORT` variable. Render's default expected port is 10000 and the image no longer
claims otherwise.

Setting Root Directory to `worker` also means commits that touch nothing under
`worker/` will not trigger a rebuild. That is deliberate — every rebuild is a
brief outage now, so app-only pushes should not cause one.

### 3. Add the disk, if you're paying — before the first successful deploy

Skip this on Free and follow §2 instead; the two are alternatives, not a pair.

Service → **Settings** → **Disks** → **Add Disk**:

| Field      | Value            |
| ---------- | ---------------- |
| Name       | `tg-session`     |
| Mount Path | `/var/data`      |
| Size       | `1 GB`           |

Size can be increased later but never decreased, so start small.

This is the step that disables zero-downtime deploys. Do not skip it and then
also skip §2 — one of the two has to be true, or a redeploy revokes the session.
And if you add a disk, add `SESSION_FILE=/var/data/session.json` to the
environment; without a disk, leave that variable out entirely.

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
| `SESSION_FILE`            | **only if you attached a disk** — see below         |
| `NODE_ENV`                | `production`                                       |

**Do not set `PORT`.** Render injects `PORT=10000` and a runtime variable
overrides the image's `ENV`, so any value you set here just makes the port the
process binds disagree with the port Render probes. That is a fifteen-minute
deploy timeout, not an error message — see [When the deploy times
out](#when-the-deploy-times-out).

**Only set `SESSION_FILE` if you have a disk**, and then to a path inside the
mount (`/var/data/session.json`). With no disk, leave it unset: the image already
points it at `/data/session.json`, which the Dockerfile creates and chowns to the
container's non-root user.

It caches the session *after* Telegram's DC migration mutates it; without it,
every boot repeats that handshake. It is a cache, not the source of truth — the
file records a fingerprint of the env session string and is ignored when the
fingerprint stops matching, so rotating `TELEGRAM_SESSION_STRING` can never be
undone by a stale file. If the path is unwritable (a root-owned mount, or a
directory that doesn't exist) the worker logs one line and falls back to the
temp directory:

```
[tg] /var/data/session.json is not writable — caching the session at /tmp/sakura-tg-session.json instead
```

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

## When the deploy times out

The symptom, from a real deploy of this worker:

```
[boot] connecting to Telegram…
[tg] connected as @… — this process now owns the session
[boot] listening on 0.0.0.0:10000
==> Timed Out
[shutdown] SIGTERM — releasing session
==> Detected service running on port 10000
==> Docs on specifying a port: https://render.com/docs/web-services#port-binding
```

Everything the app logs says success, and the deploy still fails. Read the gap
between the timestamps: exactly fifteen minutes, which is Render's documented
limit for the start command. Render never accepted the service as live.

The cause was a **port mismatch**, and the last two lines are Render telling you
so. The image declared `EXPOSE 8080` and `ENV PORT=8080`; Render injects
`PORT=10000`, and a runtime variable overrides an image `ENV`, so the process
bound 10000 while the image still advertised 8080. Render probed the port it had
been told about, found nothing, and gave up — then reported which port the
process was *actually* on.

Both lines are gone from the Dockerfile now. `index.js` reads `PORT` and falls
back to 8080, so Render's 10000 is bound on Render, Fly's `internal_port = 8080`
matches the fallback on Fly, and nothing in the image can contradict the platform.
If you hit this again, the fix is never to set `PORT` — it's to make sure nothing
else claims a different one.

Other ways this deploy can stall, in the order worth checking:

- **`==> Timed Out` with no `listening` line at all.** The process never got
  past `client.start()`. Look for `AUTH_KEY_DUPLICATED` (revoked — mint a new
  session) or a `TELEGRAM_API_ID`/`API_HASH` error.
- **A login prompt in the logs.** The session string is missing or truncated.
  Re-paste it; a session string is long and dashboards can eat it.
- **Deploy cancelled rather than timed out.** That's the health check: Render
  "cancels your deploy" when `/health` "responds with an unexpected value (or
  doesn't respond at all)." `/health` returns 503 until the session is live, so
  this means Telegram refused the connection — read the `[tg]` line above it.
- **`EACCES: permission denied, mkdir '/var/data'`.** Cosmetic, and now
  self-correcting: you set `SESSION_FILE` to a disk path with no disk mounted.
  Unset it.


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
`TELEGRAM_SESSION_STRING` in Render, save. The cached session file's fingerprint
stops matching and it is ignored automatically. Saving an environment variable
restarts the service in place rather than running a new deploy alongside the old
one, so the two keys don't overlap — but if you're on Free and want certainty,
suspend first, save, then resume.

**Redeploying.** With a disk: a few seconds of downtime, automatic. Without one:
suspend → push → resume, per §2. Either way, Telegram-backed requests fail during
the gap; playback of already-cached audio does not.

**Never run two.** Not a second Render service, not a local `node index.js`
against the same session string while the deployed one is up, not a rollback that
runs alongside. One process. This is the whole design.

**Reading the logs.** `[tg] connected as … — this process now owns the session`
is the line that says the invariant holds, and `[tg] disconnected cleanly —
session released` is the line that says it's safe to start another. If you ever
see the first one twice without the second in between, something is wrong.

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
