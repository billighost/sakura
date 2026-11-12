# Upstash shared public metadata cache

Sakura keeps its existing in-process metadata cache first. On a local miss, configured Upstash Redis can reuse public catalog JSON prepared by another server instance, including after a cold start. Ordinary warm local hits make no Redis request.

The REST client uses `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on the server only. Keep those values in ignored local environment files and the deployment's secret environment settings; never use a `NEXT_PUBLIC_` variable. Restart the server after configuring credentials. Missing/invalid configuration disables the L2 cache, leaving ordinary providers operational.

Choose an Upstash region near the deployed application compute. Redis adds a network round trip: it helps when that round trip costs less than the provider work it replaces. Measure deployment-local cache hits before claiming a 100 ms end-to-end result.

Controls:

| Setting | Default | Behavior |
| --- | --- | --- |
| `SAKURA_REDIS_NAMESPACE` | `sakura:public:v1` | Separate environments/metadata schemas using a namespace; only alphanumeric, colon, underscore and hyphen are accepted. |
| `SAKURA_REDIS_TIMEOUT_MS` | 75 ms | Command deadline clamped to 10–250 ms. There are no SDK retries. |
| Outage cooldown | 30 seconds | After a timeout/error, subsequent calls bypass Redis until the cooldown ends. |
| Concurrent commands | 4 | Excess work bypasses Redis rather than queueing ahead of the interaction. |
| Payload limit | 256 KiB | Oversized or malformed JSON stays outside Redis. |
| Provider TTL | 300 seconds | Provider-owned finite expiry; records also carry a checked schema/expiration envelope. |
| Public reading TTL | 24 hours | Content-addressed pronunciation fields are bound to the exact ordered public text, language and engine version. |
| Public-source proof lifetime | 1 hour | A signed proof lets another serverless instance verify eligibility; edited, private, partial, forged or expired sources do not qualify. |

Allowed scopes are public Deezer metadata, public Spotify metadata, and text-derived reading transforms. Keys hash the caller's metadata key with SHA-256; search terms do not appear in Redis key names. Provider projections remove unused preview audio addresses, signed addresses, auth/account fields, and raw search pagination URLs while retaining pagination availability.

Private account/session state, favorites, settings, listening history, personalized feeds, password checks, Spotify tokens, signed playback targets, audio/video bytes and Telegram locators are excluded. Redis is never a source of authority for authentication, account deletion, playback ownership or durable receipts.

Callers await the bounded best-effort write so serverless execution can finish it. Write failures preserve the original provider result. The shared cache is optional and never returns an application error on its own. Provider code continues to parse/validate catalog metadata, reject provider errors, enforce request cancellation and clone results for independent callers.

Validation: `node --import tsx --test scripts/rebuild-redis-cache.test.ts` uses an injected fake REST transport and no real credentials or network. It covers namespace/key isolation, expiry, invalid/oversized values, private field exclusion, projection behavior, deadlines, saturation, and outage recovery. Deployment-local latency and command usage must be measured separately after provisioning.

## Provisioned environment

The free `sakura-cache` database is provisioned in `eu-central-1`, near the observed Frankfurt (`fra1`) Vercel functions for https://sakuraplayer.vercel.app/. Its REST connection passed PING. Local credentials are in ignored `.env.local`; the original `.env` remains untouched.

Production and preview Redis settings have been added and verified in the linked `sakuraplayer` Vercel project. Both credentials use secret environment storage. Production uses `sakura:public:v1`; preview uses `sakura:preview:public:v1`. Both use the 75 ms deadline. `node scripts/rebuild-vercel-redis-setup.mjs` configures these settings through secret stdin and sanitizes output; it does not deploy the application.

These environment settings apply to subsequent deployments. The performance code has not yet been deployed, and deployment-local cache latency is unmeasured. PING from this workstation took roughly 1.2–2.5 seconds, so the application retains fail-open deadlines, zero retries and outage cooldown rather than waiting for a distant cache.
