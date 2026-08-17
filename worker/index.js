"use strict";

/**
 * HTTP front door for the Telegram worker.
 *
 * Deliberately built on `node:http` with no framework. The entire surface is
 * seven routes, this runs on a free-tier container where every megabyte of
 * dependency is a slower cold boot, and streaming Range responses correctly is
 * easier when nothing sits between this code and the socket.
 *
 * Auth is a shared secret in two forms:
 *
 *   - `Authorization: Bearer <WORKER_SECRET>` for everything. Used by the
 *     Next.js server, which is the only caller that holds the secret.
 *   - An HMAC-signed, expiring URL for `GET /audio/:id` only. This lets Next.js
 *     hand a browser a URL it can fetch directly, so audio bytes never transit
 *     Vercel. On a free plan that is the difference between a bandwidth ceiling
 *     measured in songs and one measured in albums.
 *
 * `/health` is deliberately unauthenticated: platform health checks cannot
 * carry a secret, and the response says nothing an attacker can use.
 */

require("dotenv").config();

const http = require("node:http");
const crypto = require("node:crypto");
const { TelegramWorkerClient, DEFAULT_BOT } = require("./telegram");

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const WORKER_SECRET = process.env.WORKER_SECRET || "";
const SESSION_FILE = process.env.SESSION_FILE || "./data/session.json";
const MAX_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Wide-open CORS, and safe here.
 *
 * Every route that carries these headers is already gated on the shared secret
 * or an HMAC signature, so the browser's origin check is not what is protecting
 * anything. Blocking it would only break the one caller that needs it — the
 * offline download queue's `fetch()`, which must read `Content-Range` and
 * `X-Audio-Size` off the response to assemble a file.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Authorization",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, X-Audio-Size, X-Audio-Duration",
  "Access-Control-Max-Age": "86400",
};

if (!WORKER_SECRET || WORKER_SECRET.length < 24) {
  console.error(
    "WORKER_SECRET must be set and at least 24 characters. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
  process.exit(1);
}

const client = new TelegramWorkerClient({
  apiId: parseInt(process.env.TELEGRAM_API_ID || "0", 10),
  apiHash: process.env.TELEGRAM_API_HASH || "",
  sessionString: (process.env.TELEGRAM_SESSION_STRING || "").trim(),
  sessionFile: SESSION_FILE,
});

// ── Auth ────────────────────────────────────────────────────────────────────

/** Constant-time compare that also tolerates length mismatches without leaking. */
function secretMatches(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(WORKER_SECRET).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearerOf(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function signAudio(messageId, expSeconds) {
  return crypto
    .createHmac("sha256", WORKER_SECRET)
    .update(`${messageId}:${expSeconds}`)
    .digest("hex");
}

/**
 * A signed audio URL is valid when the HMAC matches and it has not expired.
 *
 * The expiry is in the signed payload rather than checked separately, so it
 * cannot be edited by whoever holds the URL. Short lifetimes are the point: a
 * leaked URL stops working, and it grants read access to one message id rather
 * than to the worker.
 */
function audioSignatureValid(messageId, query) {
  const exp = parseInt(query.get("exp") || "0", 10);
  const sig = query.get("sig") || "";
  if (!exp || !sig) return false;
  if (Date.now() / 1000 > exp) return false;

  const expected = signAudio(messageId, exp);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

// ── Small HTTP helpers ──────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Map a thrown error onto a status code.
 *
 * The distinction that matters to the caller is retriable vs not. A revoked
 * session (503) needs an operator; "no results found" (404) is a normal answer
 * to an unusual query and must not look like an outage in the caller's logs.
 */
function statusForError(err) {
  const msg = String(err?.message || err);
  if (/AUTH_KEY_DUPLICATED/.test(msg)) return 503;
  if (/not found or has no media|No results found|not found/i.test(msg)) return 404;
  if (/requires channel subscription/i.test(msg)) return 424;
  if (/rate-limited|limit reached/i.test(msg)) return 429;
  if (/did not respond|not received within|TIMEOUT/i.test(msg)) return 504;
  return 500;
}

function fail(res, err, context) {
  const status = statusForError(err);
  const msg = String(err?.message || err);
  // 5xx is ours to investigate; 4xx is the caller's business and would just be
  // noise at error level.
  const log = status >= 500 ? console.error : console.warn;
  log(`[http] ${context} -> ${status}: ${msg.slice(0, 300)}`);
  if (!res.headersSent) sendJson(res, status, { error: msg });
  else res.end();
}

/** `bytes=start-end` → absolute byte offsets, or null when unparseable. */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;

  let start;
  let end;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === "" ? size - 1 : parseInt(rawEnd, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return { unsatisfiable: true };
  return { start, end: Math.min(end, size - 1) };
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function handleAudio(req, res, messageId, query, isHead) {
  const info = await client.getAudioInfo(messageId);
  const size = info.size;
  if (!size) throw new Error(`Message ${messageId} has no downloadable audio`);

  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": info.mimeType || "audio/mpeg",
    "X-Audio-Size": String(size),
    "X-Audio-Duration": String(info.duration || 0),
    // The bytes for a given message id never change, so a long cache is safe.
    // `private` because the signed URL is per-listener, not shareable.
    "Cache-Control": "private, max-age=86400",
    // A plain `<audio src>` needs no CORS, but the offline download queue uses
    // `fetch()`, which does — and without `Expose-Headers` it cannot read the
    // size or range it needs to assemble the file. `*` is not a widening here:
    // reaching this route already requires a valid signature or the secret.
    ...CORS_HEADERS,
  };

  const range = parseRange(req.headers.range, size);

  if (range?.unsatisfiable) {
    res.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${size}` });
    res.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const length = end - start + 1;

  if (isHead) {
    res.writeHead(range ? 206 : 200, {
      ...baseHeaders,
      "Content-Length": String(length),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    res.end();
    return;
  }

  const { stream } = await client.getAudioStream(messageId, start, length);

  res.writeHead(range ? 206 : 200, {
    ...baseHeaders,
    "Content-Length": String(length),
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });

  // A listener who skips to the next track aborts mid-response. Without this the
  // generator keeps pulling chunks from Telegram into a socket nobody is
  // reading, which is both wasted bandwidth and a slow leak of open downloads.
  const abort = () => stream.destroy();
  res.on("close", abort);

  stream.on("error", (err) => {
    console.error(`[http] audio ${messageId} stream error: ${err.message}`);
    res.destroy();
  });

  stream.pipe(res);
}

async function handleImport(req, res, body) {
  if (!body.url) throw new Error("Missing url");

  // NDJSON rather than a single JSON array, because an import can run for
  // minutes and the caller wants to show tracks as they land. One object per
  // line means the reader needs no streaming parser.
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });

  const write = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
  };

  // Some proxies hold a response until the first byte arrives. Sending the
  // header line immediately keeps the connection demonstrably alive during the
  // 20s+ before the bot's first track shows up.
  write({ type: "start" });

  try {
    const tracks = await client.importPlaylist(
      body.url,
      (track) => write({ type: "track", track }),
      body.botUsername || DEFAULT_BOT,
    );
    write({ type: "done", count: tracks.length });
  } catch (err) {
    console.warn(`[http] import failed: ${err.message}`);
    write({ type: "error", message: String(err?.message || err) });
  } finally {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method || "GET";

  /*
   * One line per request, always.
   *
   * Two Render deploys of this worker died at the 15-minute start timeout while
   * every application log line said the process was healthy and listening. The
   * logs could not answer the only question that mattered — whether the platform
   * was making requests at all, and what it got back — because the worker only
   * logged failures. A silent success and a request that never arrived looked
   * identical. They aren't, and now they don't.
   *
   * Registered on `finish` so it reports the status actually written, from
   * whichever branch below wrote it, without threading a logger through all of
   * them.
   */
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(
      `[http] ${method} ${pathname} -> ${res.statusCode} (${Date.now() - startedAt}ms)`,
    );
  });

  /*
   * Platform probes, unauthenticated on purpose: a health check cannot carry a
   * bearer token.
   *
   * `/` and `/healthz` answer the same as `/health` because everything else here
   * replies 401, and a platform whose health check path is set to `/` — the
   * default in more than one dashboard — would read that 401 as "not ready" and
   * retry until the deploy timed out. Matching the probe to the path is the
   * operator's job; surviving a wrong one is cheap insurance, and none of these
   * three reveal anything a caller doesn't already know.
   */
  if (pathname === "/health" || pathname === "/healthz" || pathname === "/") {
    const h = client.health();
    sendJson(res, h.ok ? 200 : 503, h);
    return;
  }

  const audioMatch = /^\/audio\/(\d+)$/.exec(pathname);

  // ── Preflight. Answered before auth on purpose: a browser never attaches the
  //    Authorization header or the query string to an OPTIONS probe, so checking
  //    credentials here would fail every legitimate cross-origin audio fetch.
  if (method === "OPTIONS") {
    res.writeHead(204, { ...CORS_HEADERS, "Content-Length": "0" });
    res.end();
    return;
  }

  // ── Auth
  const hasBearer = secretMatches(bearerOf(req));
  const signedOk =
    audioMatch && (method === "GET" || method === "HEAD")
      ? audioSignatureValid(audioMatch[1], url.searchParams)
      : false;

  if (!hasBearer && !signedOk) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  // ── A revoked session is terminal. Say so once, clearly, instead of failing
  //    each route in its own way.
  const health = client.health();
  if (health.fatal) {
    sendJson(res, 503, { error: health.fatal });
    return;
  }

  try {
    if (audioMatch && (method === "GET" || method === "HEAD")) {
      const messageId = parseInt(audioMatch[1], 10);
      if (!messageId || messageId <= 0) {
        sendJson(res, 400, { error: "Invalid messageId" });
        return;
      }
      await handleAudio(req, res, messageId, url.searchParams, method === "HEAD");
      return;
    }

    if (method !== "POST") {
      sendJson(res, 404, { error: `No route for ${method} ${pathname}` });
      return;
    }

    const body = await readJsonBody(req);

    switch (pathname) {
      case "/search": {
        if (!body.query) throw new Error("Missing query");
        const out = await client.searchMusic(
          body.query,
          body.timeoutMs ?? 20000,
          body.botUsername,
        );
        sendJson(res, 200, out);
        return;
      }

      case "/search-and-select": {
        if (!body.query) throw new Error("Missing query");
        const out = await client.searchAndSelect({
          query: body.query,
          targetDuration: body.targetDuration,
          searchTimeoutMs: body.searchTimeoutMs ?? 10000,
          selectTimeoutMs: body.selectTimeoutMs ?? 60000,
          expectedTitle: body.expectedTitle,
          expectedArtist: body.expectedArtist,
          botUsername: body.botUsername,
        });
        sendJson(res, 200, out);
        return;
      }

      case "/select": {
        const msgId = parseInt(body.buttonMessageId, 10);
        if (!msgId) throw new Error("Missing buttonMessageId");
        const out = await client.selectResult(
          msgId,
          body.buttonIndex ?? 0,
          body.timeoutMs ?? 60000,
          body.botUsername,
        );
        sendJson(res, 200, out);
        return;
      }

      case "/import":
        await handleImport(req, res, body);
        return;

      case "/audio-info": {
        const msgId = parseInt(body.messageId, 10);
        if (!msgId) throw new Error("Missing messageId");
        sendJson(res, 200, await client.getAudioInfo(msgId));
        return;
      }

      /**
       * Mint a short-lived signed URL the browser can hit directly.
       *
       * The caller decides the lifetime; the default covers a long track plus
       * seeking without being worth hoarding. Only the worker can produce these,
       * because only the worker and the Next.js server share the secret.
       */
      case "/sign-audio": {
        const msgId = parseInt(body.messageId, 10);
        if (!msgId) throw new Error("Missing messageId");
        const ttl = Math.min(Math.max(body.ttlSeconds ?? 3600, 60), 86400);
        const exp = Math.floor(Date.now() / 1000) + ttl;
        sendJson(res, 200, {
          path: `/audio/${msgId}?exp=${exp}&sig=${signAudio(msgId, exp)}`,
          expiresAt: exp,
        });
        return;
      }

      case "/download": {
        const msgId = parseInt(body.messageId, 10);
        if (!msgId) throw new Error("Missing messageId");
        const { stream, size, mimeType } = await client.getAudioStream(msgId);
        res.writeHead(200, {
          "Content-Type": mimeType || "application/octet-stream",
          "Content-Length": String(size),
          "Cache-Control": "no-store",
        });
        res.on("close", () => stream.destroy());
        stream.on("error", (err) => {
          console.error(`[http] download ${msgId} error: ${err.message}`);
          res.destroy();
        });
        stream.pipe(res);
        return;
      }

      default:
        sendJson(res, 404, { error: `No route for ${method} ${pathname}` });
        return;
    }
  } catch (err) {
    fail(res, err, `${method} ${pathname}`);
  }
});

// An import or a `/select` legitimately runs for minutes while the bot works, so
// Node's default 5-minute request timeout is disabled and the per-operation
// deadlines in telegram.js are the only ones that apply.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 75_000;

/**
 * Connect before listening.
 *
 * Refusing traffic until the session is live means a bad session string is a
 * failed deploy the operator sees immediately, rather than a healthy-looking
 * container that 500s on the first song.
 */
async function main() {
  console.log("[boot] connecting to Telegram…");
  await client.start();

  server.listen(PORT, HOST, () => {
    const addr = server.address();
    console.log(
      `[boot] listening on ${HOST}:${PORT}` +
        (addr && typeof addr === "object"
          ? ` (bound ${addr.address}:${addr.port} ${addr.family}, PORT env ${process.env.PORT ?? "unset"})`
          : ""),
    );
    void selfProbe();
  });
}

/**
 * Ask ourselves for /health over real TCP, once, right after binding.
 *
 * This exists because two Render deploys timed out after fifteen minutes with
 * the process reporting itself listening the whole time, and there was no way to
 * tell from the logs whether the socket was genuinely accepting connections. A
 * successful probe moves the fault outside the container — to the port the
 * platform expects, the health check path it asks for, or its routing — and a
 * failed one puts it squarely in here. Either answer saves a deploy cycle.
 */
function selfProbe() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: "/health", method: "GET", timeout: 5000 },
      (res) => {
        res.resume();
        console.log(`[boot] self-probe GET /health -> ${res.statusCode}`);
        resolve();
      },
    );
    req.on("timeout", () => {
      console.error("[boot] self-probe timed out — the socket is not accepting connections");
      req.destroy();
      resolve();
    });
    req.on("error", (err) => {
      console.error(`[boot] self-probe failed: ${err.message}`);
      resolve();
    });
    req.end();
  });
}

let shuttingDown = false;

/**
 * Disconnect cleanly on the way out.
 *
 * This is the one piece of shutdown that genuinely matters: a clean MTProto
 * disconnect tells Telegram the key is no longer in use, so a redeploy's new
 * container does not briefly look like a second consumer of the same key.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — releasing session`);

  server.close();
  const timer = setTimeout(() => process.exit(0), 8000);
  timer.unref();

  try {
    await client.stop();
  } catch {
    /* exiting anyway */
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/**
 * Report unexpected background failures instead of hiding them.
 *
 * The Next.js version intercepted AUTH_KEY_DUPLICATED here and logged a warning,
 * which meant the single most important failure in the system was invisible
 * until someone noticed downloads had stopped. Logging it at error level with
 * the fix in the message is the whole point of catching it.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason?.errorMessage || reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

main().catch((err) => {
  console.error("[boot] failed to start:", err?.message || err);
  process.exit(1);
});
