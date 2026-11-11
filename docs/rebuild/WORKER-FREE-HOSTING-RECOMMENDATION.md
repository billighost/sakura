# A free host for Sakura's Telegram worker

Researched on 2026-11-11. The user confirmed that the current Render worker is suspended because its bandwidth allowance ran out. This is a deployment recommendation for review; no account, VM, payment, DNS record, or deployment was created or changed.

## Current no-card decision

The user subsequently clarified that they have no supported payment card and need hosted service. **Oracle and self-hosting are therefore ruled out.** The replacement proposal is a single Cloudflare Durable Object, subject to a live transport/ownership proof, with on-demand Vercel Daemons as a second route. See [WORKER-NO-CARD-WORKAROUNDS.md](WORKER-NO-CARD-WORKAROUNDS.md) for current sources, free quotas, offline probe results, and go/no-go checks. No migration has occurred.

## Previous VM recommendation, no longer applicable to this user

Use **one Oracle Cloud Infrastructure Always Free VM** for the existing long-running Node worker. Its current official Always Free resource documentation includes **10 TB/month of outbound data transfer**, persistent VM storage, and conventional VM networking. A single VM can keep one Telegram session owner and one outbound connection, with a reserved public IPv4 address assigned to the VM.

For the first deployment, use an Always Free-eligible `VM.Standard.A1.Flex` instance with **1 OCPU, 2 GB RAM, and a 50 GB boot disk** in the account's home region. Confirm the Console's free eligibility and the account's remaining allowances before provisioning. The existing `node:22-alpine` image supports Arm, but build and smoke-test the worker image and chosen metadata/verification binaries for Arm before migration. If Arm capacity is unavailable, an eligible `VM.Standard.E2.1.Micro` VM is an alternative with less CPU/memory; verify stream and file-verification performance before relying on it.

Current published A1 allowances are **1,500 OCPU-hours and 9,000 GB-hours per month**, described as equivalent to **2 OCPUs and 12 GB RAM**. Older recommendations citing 4 OCPUs/24 GB should not be used as the deployment budget. The combined Always Free boot/block volume allowance is 200 GB. A larger VM is unnecessary for this initial single worker.

At 5 MB sent per complete song, 10 TB represents roughly **two million full-song-sized transfers**, before retries, probes, publication checks, and other traffic. It is an allowance, not unlimited bandwidth or a guaranteed service level. Measure actual bytes instead of using this estimate as a capacity promise.

Conditions that matter:

- Oracle requires a valid supported card and account verification. Its free-tier FAQ describes temporary verification authorizations and excludes some prepaid/virtual cards. Signup success is not guaranteed.
- Always Free VM capacity can be unavailable in the account's home region. There is no evidence from this investigation that a VM is available for this user's account right now.
- Oracle may reclaim an idle Always Free VM. The current documented idle test examines a seven-day period: CPU 95th-percentile utilization below 20%, network utilization below 20%, and memory utilization below 20% for A1. A lightly used worker could meet those conditions. Do not create artificial CPU/network traffic to evade them; keep deployment/session backups and a recovery procedure.
- Resources outside the free allowances or outside the eligible home-region resources can incur cost on paid accounts. Stay within clearly marked free resources; do not treat the initial $300/30-day trial as permanent hosting credit.

If signup or capacity fails, I have not found an equally convincing permanent free managed host for this bandwidth-heavy worker. A device the user already owns and can keep online is another zero-hosting-fee option, but it depends on that device's power, ISP data allowance, reachable HTTPS endpoint, and reliability.

## Cloudflare and the multiple-IP concern

The invariant is **one active Telegram session owner**, rather than “the public website must have one IP forever.” Sequential reconnects, including a controlled host move, differ from overlapping processes using the same session. A second concurrent owner on another machine/IP is the configuration this repository is designed to prevent.

**Ordinary Cloudflare Workers:** The current pricing page lists no additional data-transfer/egress charge, but these are request-driven executions, not an always-running Node process. HTTP executions can remain alive while the client stays connected; after the client disconnects or the response completes, associated tasks may be canceled, with only a bounded `waitUntil` extension. There is no documented dedicated static egress-IP guarantee in the ordinary Workers TCP API. Putting the existing Telegram client in each invocation would recreate the session-ownership problem.

**Workers with a Durable Object:** A single Durable Object can serialize logical ownership, so this is more capable than an ordinary per-request worker. It would still require a redesign and compatibility testing of GramJS, TCP connections, session storage, restarts, and eviction. The current TCP documentation says an open TCP socket keeps the object in memory and incurs duration charges for up to 15 minutes; standard eviction rules resume afterward. This is not a verified free drop-in migration for Sakura, and it is not the recommendation for the present repair.

**Cloudflare Containers:** A persistent container is a closer fit for Node. Current pricing requires the **$5/month Workers Paid plan**, plus container resources and Workers/Durable Objects usage. The table marks free-plan container resources as unavailable. Current included container egress is **1 TB/month in North America/Europe** or **500 GB in the other listed regions**, followed by regional per-GB pricing. The included memory allowance is only 25 GiB-hours/month; a continuously running worker can exceed it. Containers therefore does not meet the requested free-host requirement even before session/rollout behavior is evaluated.

**Cloudflare DNS:** Cloudflare can still manage the worker's hostname while Telegram runs entirely on the Oracle VM. Start with a **DNS-only record** pointing to the VM and terminate HTTPS on that VM, for example with Caddy and a public certificate. Edge DNS/website addresses do not become the Telegram client's outbound addresses. Do not assume that free Cloudflare proxying/tunneling is an unlimited music-bandwidth entitlement; a proxy is not needed to preserve this worker's ownership.

## Other researched choices

| Host | Current free offer or relevant limit | Fit for Sakura |
| --- | --- | --- |
| Oracle Always Free VM | 10 TB/month outbound; persistent eligible compute/storage; verification, capacity, and idle-reclamation conditions | Best free option found, conditional on obtaining an eligible VM. |
| Cloudflare Workers | No listed egress charge, but request-driven lifecycle and no ordinary dedicated static egress guarantee | Requires a different architecture; do not copy the current daemon into requests. |
| Cloudflare Containers | Workers Paid plan starts at $5/month; resources and additional usage billed | Technical alternative to evaluate only if a paid plan becomes acceptable. |
| Google Cloud free Compute Engine | One eligible US-region `e2-micro`, 30 GB standard persistent disk, **1 GB/month outbound** to eligible destinations | Persistent VM model fits, but the small free egress allowance fails the bandwidth objective; billing/network extras also need checking. |
| Railway Free | **$1/month** recurring resource credit; free plan limits include one replica and 0.5 GB RAM | Real free plan exists, but a persistent daemon plus song traffic can exhaust the credit. It does not solve the present requirement reliably. |
| Fly.io | Current new-account trial is **$1 for up to seven days**; subsequent Machines and bandwidth are metered | Existing config is useful for a paid fallback; do not describe Fly as permanent free hosting. |
| Current Render Free service | Free-hour, outbound-bandwidth, and service-initiated traffic limits; user reports exhausted bandwidth | Moving to another Render free service/workspace is not a durable capacity fix. |

## Migration sequence after approval

1. Confirm Oracle signup/access and free VM capacity. If unavailable, report that result before considering a paid service. Do not start a Telegram client during VM preparation.
2. Prepare the free VM's Docker runtime, private session-data directory, HTTPS endpoint, and firewall. Expose HTTPS only for the application/worker API; limit administrative access. Keep secrets out of the image, repository, and health responses.
3. Build the reviewed worker revision, including regenerated matching code and approved file verification helpers. Test with fake Telegram transport first. Use one worker container; no replicas, autoscaling, or overlapping blue/green deployments.
4. Confirm the Render worker is stopped and cannot auto-resume or auto-deploy into a second owner. A suspended public page is evidence of unavailability, not by itself a definitive process-termination audit; check hosting state/logs. Stop the old owner before enabling the new session.
5. Transfer the existing session through a private channel/configuration and start exactly one worker on the VM. Persist its session cache securely. A revoked key needs the project's explicit session-recovery procedure; changing hosts does not repair a revoked key.
6. Verify health, supported capabilities/scopes, reviewed build revision, authentication, signed audio URLs, and bounded range responses. Update the application's worker URL only after those checks pass. Domain changes do not require copying the Telegram session into the Next.js app.
7. Run the download/identity acceptance plan against the deployed worker, starting with bounded probes and then the agreed full-file checks. Record the new source and transfer results for all five unchanged references.
8. For rollback, stop the Oracle owner and confirm exit before resuming Render, if its quota permits. Never have both hold the same session. For future updates on the VM, stop/remove the old worker container before starting its replacement; keep the saved session directory.

## Prevent another bandwidth surprise

- Record actual monthly worker outbound bytes and bytes by path: audio delivered to users, preparation/publication transfers, probes, and retries. OCI metering is the source for the provider's billed/limited total; HTTP counters are useful application diagnostics.
- Add budget alerts at agreed thresholds, for example 50%, 80%, and 95% of the configured allowance. Keep operator diagnostics available without sending external messages unless authorized.
- Reuse immutable verified recordings/checksums and completed offline files. Coalesce repeated acquisition and prevent a failed CDN preparation from repeatedly fetching the entire source.
- Limit active transfers and automatic prefetch. Do not make each retry redownload an already verified complete file. Keep full-file work explicit and cancel unused work promptly.
- Continue using verified existing CDN assets where available, while monitoring their separate storage/egress limits. A different CDN's quota is not a permanent source-availability guarantee.
- At the configured budget threshold, retain requested downloads in a correctly described waiting state and preserve offline playback. Avoid an abrupt suspension being presented as five unrelated missing songs.

This larger free allowance addresses the confirmed bandwidth cause. The application and identity repairs are still needed; a hosting move alone will not fix truncated tags, unsupported instrumental markers, or unproven artist substitutions.

## Official sources checked

- [OCI Always Free resources, compute allowances, idle reclamation, and 10 TB outbound allowance](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle free-tier signup, account conditions, and supported payment verification](https://www.oracle.com/cloud/free/)
- [OCI public IP addressing and reserved addresses](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers lifecycle/limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare outbound TCP API and Durable Object TCP lifecycle](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Containers pricing and included regional egress](https://developers.cloudflare.com/containers/pricing/)
- [Google Cloud free-tier Compute Engine allowances](https://cloud.google.com/free/docs/free-cloud-features?hl=en)
- [Railway plans and recurring free credit](https://docs.railway.com/reference/pricing/plans)
- [Fly.io free trial](https://fly.io/docs/about/free-trial/) and [pricing](https://fly.io/docs/about/pricing/)
- [Render free-service limitations](https://render.com/docs/free)

Private fetched source text and timestamps are retained under `.local/download-root-audit/hosting/`; published facts above come from those sources, rather than older free-tier assumptions.
