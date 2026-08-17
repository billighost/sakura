# syntax=docker/dockerfile:1

# Alpine keeps the image small enough that a redeploy is a few seconds rather
# than a minute — which matters, because every restart is a brief window where
# the session is handed from the old container to the new one.
FROM node:22-alpine

WORKDIR /app

# Copy manifests first so `npm ci` is cached independently of source changes.
COPY package.json package-lock.json* ./

# `npm ci` when a lockfile exists, `npm install` otherwise — the worker has four
# dependencies and no build step, so both are fast.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY telegram.js index.js login.js ./

# Where the cached (post-DC-migration) session lives. Mount a volume here to
# skip the migration handshake on every boot; without one it is simply re-derived
# from TELEGRAM_SESSION_STRING, which is harmless.
RUN mkdir -p /data && chown node:node /data
ENV SESSION_FILE=/data/session.json
ENV NODE_ENV=production

USER node

# No ENV PORT and no EXPOSE, deliberately.
#
# Both used to say 8080, and on Render that combination fails the deploy. Render
# injects PORT=10000 into the container, which overrides an image ENV, so the
# process listened on 10000 while the image still advertised 8080 — the platform
# probed the port it had been told about, found nothing, and timed out after
# fifteen minutes with "Detected service running on port 10000".
#
# index.js reads PORT and falls back to 8080, so: Render sets it to 10000 and
# that is what gets bound; Fly doesn't set it and fly.toml's internal_port 8080
# matches the fallback; locally it is 8080. EXPOSE publishes nothing on its own,
# it only declares intent — and a declaration that can be wrong is worse here
# than no declaration at all.

# No init system and no process manager on purpose: this must be ONE process.
# A supervisor that restarts it while the old one is still draining would put two
# connections on the same auth key, which is the exact failure being designed out.
CMD ["node", "index.js"]
