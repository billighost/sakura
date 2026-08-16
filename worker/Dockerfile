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
ENV PORT=8080

USER node

EXPOSE 8080

# No init system and no process manager on purpose: this must be ONE process.
# A supervisor that restarts it while the old one is still draining would put two
# connections on the same auth key, which is the exact failure being designed out.
CMD ["node", "index.js"]
