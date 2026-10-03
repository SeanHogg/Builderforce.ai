# Free-forever ($0/month) replacements for Builderforce.ai edge, realtime, storage, cache, cron, email and LLM components (as of 2026-10-03)

Scope: non-database, non-container parts currently on Cloudflare. "Free" means a permanent free tier, not trials or credits. All page fetches were made 2026-10-03 unless noted. Where only aggregator sources were found, that is flagged.

## 1. API runtime and Next.js frontend hosting (serverless free tiers)

### Takeaway
The biggest finding is a 2026 change. Cloudflare's Workers limits page (last updated 2026-09-05) now lists a 64 MiB uncompressed size limit for **both** Free and Paid, and says "there is no compressed size limit." So the 20.6 MiB raw / 4.58 MiB gzip bundle appears to fit Workers Free. The limits that actually bind on Free are now:
- 10 ms CPU per request **and per cron**
- 50 subrequests per request
- 100k requests/day
- 5 cron triggers per account

The Hono API's crons and fan-out break those limits. Among other hosts, Vercel Hobby is ruled out (no commercial use). Netlify Free allows commercial use but has a hard 300-credit monthly cap that pauses every project once reached. Cloud Run and AWS Lambda give the most compute headroom, but neither is an edge/Workers-compatible runtime.

### Cited Findings
- **Workers Free limits:** 100,000 requests/day (Error 1027 when exceeded, fail-open or fail-closed configurable), 10 ms CPU per HTTP request, 128 MB memory, 50 subrequests per request (1,000 to internal services), 6 simultaneous outgoing connections, 5 Cron Triggers per account, 100 Workers per account, 20,000 static asset files per version — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- **Worker size:** 64 MiB uncompressed on both Free and Paid. Quote: "There is no compressed size limit. Only the uncompressed bundle size counts." The page was last updated Sep 5, 2026 — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/). (This contradicts the long-standing 3 MB Free / 10 MB Paid compressed limit that the brief assumes. Treat it as a 2025–2026 change and confirm with a test deploy.)
- **Workers Paid subrequests:** 10,000 per invocation by default, configurable up to 10M — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- **Cron CPU time:** 10 ms on Free. On Paid it is 30 s for intervals under 1 hour and 15 min for intervals of 1 hour or more. Scheduled Workers have a 15-minute maximum wall time — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- **Vercel Hobby, commercial use:** "Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan." Commercial use is defined as any deployment used for financial gain of anyone involved, including payment processing or advertising a product/service — [Vercel Fair Use Guidelines (updated 2026-09-14)](https://vercel.com/docs/limits/fair-use-guidelines)
- **Vercel Hobby monthly allotments:** 100 GB Fast Data Transfer, 1,000,000 function invocations, 10 GB Fast Origin Transfer, 4 hours Active CPU, 360 GB-hrs provisioned memory, 5K image transformations — [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- **Vercel Hobby other limits:** 100 cron jobs per project (with an asterisk pointing to cron usage limits); runtime logs kept 1 hour; CLI upload limited to 100 MB; Hobby cannot connect to Git-organization repositories — [Vercel Limits (updated 2026-09-16)](https://vercel.com/docs/limits)
- **Netlify Free model:** a credit-based plan with a 300-credit limit, custom domains with SSL, global CDN — [Netlify pricing](https://www.netlify.com/pricing/)
- **Netlify credit costs:** production deploys 15 credits each; compute (serverless, scheduled and background functions) 5 credits per GB-hour; bandwidth 10 credits per GB; web requests 3 credits per 10k; preview deploys free — [Netlify credit-based pricing docs](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) (search-result summary)
- **Netlify cap and commercial use:** commercial use reportedly allowed on Free. When the credit limit is reached, all projects pause until the next cycle — search-result summary of [Netlify credit-based pricing changelog](https://www.netlify.com/changelog/netlify-pricing-update-introducing-credit-based-plans/). Not verified verbatim.
- **Deno Deploy Free:** $0, described as for "personal projects". 1M requests/month, 20 GiB bandwidth, 10 active apps, 1-day log retention, no sandboxes. Overage is $2/M requests and $0.20/GiB — [Deno Deploy pricing](https://deno.com/deploy/pricing)
- **Google Cloud Run free tier (monthly):** 180,000 vCPU-seconds, 360,000 GiB-seconds, 2,000,000 requests, 1 GB egress. 60-minute maximum request timeout. WebSockets supported — [Cloud Run pricing](https://cloud.google.com/run/pricing) (summarised by fetch tool; the "3 free Cloud Scheduler jobs" figure was hedged as "typically" and is unverified)
- **AWS Lambda always-free:** "one million requests and 400,000 GB-seconds per month" — [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- **Oracle Cloud Always Free compute** (a self-hosted option for the API, WebSockets, Yjs and Redis):
  - Ampere A1 with 3,000 OCPU-hours + 18,000 GB-hours/month (≈ 4 OCPU / 24 GB). The fetch tool reported this as 1,500 OCPU-hours + 9,000 GB-hours (≈ 2 OCPU / 12 GB), which may be a summarisation error or a real 2026 cut — confirm on the live page.
  - Plus 2 AMD micro VMs (1/8 OCPU, 1 GB) and 200 GB block storage
  - 10 TB/month outbound data, 1 flexible load balancer (10 Mbps)
  - Idle instances (<20% CPU/network/memory over 7 days) may be reclaimed; resources must be in the home region

  Source: [OCI Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Inferences
- **Staying on Workers Free:** if the new size rule holds, staying on Workers Free is feasible for the request path. But the 10 ms CPU cap on Free is very likely too low for a 20 MB Hono app's cold start plus real handlers. 10 ms cron CPU rules out heavy cron work on Free, and 50 subrequests rules out the ">50 subrequests" paths. Those code paths must be split out, for example fan-out moved to queued per-item invocations or to a VM.
- **Vercel Hobby** is disqualified for a commercial SaaS regardless of its technical limits.
- **Netlify Free:** its "pause everything at the cap" behaviour is a production-availability risk.
- **Deno Deploy Free:** its "personal projects" framing should be checked against its ToS for commercial use.
- **Cloud Run free tier:** 1 GB/month egress is the binding limit for a SaaS API.
- **AWS Lambda:** a public HTTP endpoint needs Function URLs (pricing not covered by the page fetched) or API Gateway (API Gateway's free tier was historically 12-month only).
- **Oracle A1 VM:** the most realistic place for $0 "long-running" pieces (WebSockets, Yjs, cron runner, Redis). It is a single VM with no SLA and has a reclamation risk, which is a reliability trade-off.

### Gaps
- Not re-verified for 2026 on Vercel Hobby: function bundle size (historically 250 MB), max duration, cron frequency (historically once per day on Hobby), WebSocket support (historically none). Vercel's page only shows the "100*" cron footnote.
- **Netlify:** exact function limits (timeout, bundle), WebSocket support, and verbatim commercial-use wording were not fetched.
- **Render:** the free web service (spins down on idle, 750 instance-hours historically) was not verified for 2026.
- **Deno Deploy:** CPU-time per request, cron/queue and WebSocket support on the 2026 Free plan were not shown. Neither was whether the 2025 "Deploy Classic" sunset changed anything.
- **AWS:** the July 2025 change (new accounts on a credits-based "free plan") and whether Lambda's 1M/400k GB-s remains "always free" for new accounts were not confirmed. Neither were the Lambda package limit (historically 250 MB unzipped) or the timeout (historically 15 min).
- **Firebase Hosting / App Hosting** free limits were not fetched.

## 2. Durable Objects replacement: WebSocket rooms, Yjs co-editing, agent relay, alarm-driven step runners

### Takeaway
Durable Objects are **available on Workers Free**, but only the SQLite-backed kind (which is what Builderforce uses). The free quota is 100k requests/day and 13,000 GB-s/day, with hibernated WebSocket messages billed 20:1. Keeping the DOs on Cloudflare Free is therefore the lowest-effort $0 option, provided the calling Worker also fits Free limits. Off Cloudflare, the realistic $0 substitute is self-hosting on an Oracle Always Free VM: Hocuspocus or y-websocket for Yjs, plus a plain WebSocket server for rooms and the relay. Managed free tiers are too small or carry conditions:
- Liveblocks: 10 connections per room and a watermark
- Ably: 200 concurrent connections
- Supabase Realtime: about 200 concurrent connections, and projects pause after 7 days idle

### Cited Findings
- **DO on Workers Free:** "Workers Free plan can only create and access SQLite-backed Durable Objects."
  - Daily limits: 100,000 requests/day, 13,000 GB-s duration/day, 5M rows read/day, 100,000 rows written/day, 5 GB total stored
  - WebSocket Hibernation bills incoming messages at 20:1

  Source: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- **Liveblocks Free:**
  - 10 simultaneous connections per room; 1 GB realtime storage and 512 MB file storage; 3,000 collaboration minutes/month; 200 comments; 10 projects
  - Commercial use is allowed if the Liveblocks watermark stays visible

  Source: [Liveblocks pricing](https://liveblocks.io/pricing). Yjs support on Free was not stated on the page.
- **Ably Free:** 6M messages/month, 200 concurrent connections, 200 concurrent channels, 500 messages/s. The page does not state commercial-use terms — [Ably pricing](https://ably.com/pricing)
- **Supabase Free:** about 200 concurrent Realtime connections, 2M Realtime messages/month (256 KB max message), 1 GB file storage, projects paused after 7 days of inactivity — search-result summary citing [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits.md) and [jetadmin 2026 guide](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/). The direct pricing-page fetch returned no content.
- **Jamsocket / Y-Sweet:** Jamsocket's session-lived infrastructure "found a new home with Modal" in July 2025 — [The New Stack](https://thenewstack.io/jamsockets-session-lived-infra-gets-a-new-home-with-modal/). Y-Sweet remains an open-source Rust Yjs server. Jamsocket docs still list a free tier: 5 running backends, 512 MB each, 2-hour limit per backend — [Jamsocket free tier limits](https://docs.jamsocket.com/pricing/free-tier-limits). Whether the managed service still accepts users after the Modal move is unverified.
- **Self-hosting on Oracle:** the Always Free A1 VM (above) gives 10 TB/month egress and a public IP at 50 Mbps — [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Inferences
- **Cheapest path:** keep the 11 DOs on Cloudflare Free.
  - Rooms and the relay already suit WebSocket hibernation, so 100k requests/day at 20 msgs per request ≈ 2M inbound messages/day.
  - The risks are 100k rows written/day across all DOs (Yjs update persistence can burn this) and the shared 100k requests/day.
  - Alarm-driven step runners count as DO invocations.
- **Off Cloudflare:** Hocuspocus or y-websocket (MIT, self-hosted) on an Oracle A1 VM preserves Yjs semantics fully. Persistence can go to local SQLite or LevelDB. The agent-host relay and ceremony/guest rooms port to a Node `ws` server. Step runners need a durable timer (DB-backed job table plus a poller).
- **Managed free tiers** (Liveblocks, Ably, Supabase) would cap concurrency at roughly 10–200. They suit demos, not production.
- **PartyKit:** now part of Cloudflare and runs on DOs, so it adds nothing beyond DO's own Free tier (by inference; not separately fetched).

### Gaps
- Not fetched: Pusher Channels free (historically 100 connections, 200k messages/day), the Y-Sweet open-source licence, and PartyKit's current status.
- Hocuspocus licence and current version were not verified.

## 3. Object storage and static sites on wildcard subdomains

### Takeaway
R2's free tier is generous: 10 GB-month, 1M Class A ops and 10M Class B ops per month, free egress. The pricing page did not say whether R2 can be enabled without a payment method. Off-Cloudflare $0 options:
- **Backblaze B2:** 10 GB free, egress free through Cloudflare and other CDN partners
- **Oracle Object Storage:** 20 GB, but only 50k API requests/month
- **Supabase Storage:** 1 GB, pausing project

Wildcard `*.builderforce.ai` serving needs a request router in front of the bucket (a Worker on Free, or a VM proxy). Buckets alone do not do host-based routing.

### Cited Findings
- **R2 free tier:** 10 GB-month storage, 1M Class A and 10M Class B requests/month, free egress. Applies to Standard storage only, not Infrequent Access — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- **Backblaze B2:** "First 10GB storage is always free."
  - Free egress up to 3× average monthly stored data, then $0.01/GB; unlimited free egress via partner CDNs including Cloudflare, Fastly and bunny.net
  - Class A, B and C calls are free; Class D gets 2,500 free calls/day, then $0.004 per 10k

  Source: [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- **Oracle Object Storage Always Free:** 20 GB combined across tiers + 50,000 API requests/month. If the free trial expires and storage exceeds 20 GB, objects are deleted until usage is back within limits — [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- **Supabase Storage Free:** 1 GB file storage; project pauses after 7 days inactivity — [jetadmin 2026 guide](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/) (secondary)
- **Workers Free for routing:** a Worker on Free can front a bucket, but each request counts toward 100k/day and 10 ms CPU — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Inferences
- **Keep R2 plus a thin Worker on Free** for `*.builderforce.ai` published sites. This preserves capability, with the 100k requests/day shared across the account as the ceiling. Static asset requests from published sites could exhaust it quickly.
- **B2 + Cloudflare proxy** (Bandwidth Alliance) is the best off-R2 $0 store. A wildcard proxied DNS record plus a Worker or Transform Rule rewrite is still needed for host-to-prefix mapping.
- **Oracle Object Storage's 50k requests/month** is far too low to serve published sites directly. Use it for cold blobs (model blobs) only.
- **Model blobs** may exceed 10–20 GB free storage. Size should be checked.

### Gaps
- Not confirmed: whether R2 needs a payment method on file to enable on the Free plan (historically yes), and whether wildcard Worker routes/custom domains on Free are still allowed.
- GitHub Pages limits (1 GB site, 100 GB/month soft bandwidth, no wildcard custom domains) and its commercial-use stance were not fetched.
- Vercel Blob or Netlify Blobs free limits were not fetched.

## 4. KV / cache: auth cache, read-through L2, cron work gate

### Takeaway
Cloudflare KV Free gives 100k reads/day but only **1,000 writes/day**. That is likely too few for an auth-resolution cache and L2 read-through cache. Upstash Redis Free is 500K commands/month (≈16.7k/day) with 256 MB, which is also tight. Redis or Valkey on an Oracle A1 VM is the only $0 option without meaningful quotas.

### Cited Findings
- **Workers KV Free:** 100,000 keys read/day, 1,000 written/day, 1,000 deleted/day, 1,000 list requests/day, 1 GB stored; resets 00:00 UTC; over-limit ops fail — [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- **Upstash Redis Free:** 500K commands/month, 256 MB data, 10 GB bandwidth/month. Up to 10 free databases (the page also says "1 free database"; wording is inconsistent) — [Upstash Redis pricing](https://upstash.com/pricing/redis)
- **Oracle A1 VM** with 24 GB RAM is Always Free (subject to idle reclamation) — [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- **DO SQLite as a cache alternative on Free:** 5M rows read/day, 100k rows written/day — [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

### Inferences
- **The cron work gate** (a few writes per cron tick: 288 five-minute ticks/day) fits KV Free's 1,000 writes/day.
- **The auth and L2 caches** should move to an in-isolate memory cache plus a DO-SQLite or VM Redis tier. DO SQLite's 100k writes/day is 100× KV Free's write budget.
- **The Cache API** (per-colo, free) is another option for read-through caching. Its free status was not verified here.

### Gaps
- Cloudflare Cache API usage limits on Free were not fetched.

## 5. Cron / scheduling (5-min, daily and weekly)

### Takeaway
Workers Free still allows 5 cron triggers per account, but with only 10 ms CPU per scheduled invocation. Free external schedulers that can ping an HTTP endpoint every 5 minutes:
- **GitHub Actions:** minimum interval 5 minutes; delays at high load; public-repo schedules auto-disable after 60 days of no activity
- **Upstash QStash Free:** 1,000 messages/day, 10 schedules; 288/day for a 5-minute job fits
- **cron-job.org and Cloud Scheduler:** not verified

### Cited Findings
- **Workers Free crons:** 5 Cron Triggers per account; 10 ms cron CPU on Free; 15-minute max wall time — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- **GitHub Actions schedule:** "The shortest interval you can run scheduled workflows is once every 5 minutes." It "can be delayed during periods of high loads... High load times include the start of every hour." In public repositories, "scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" — [GitHub Docs, events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- **QStash Free:** 1,000 messages/day, 10 active schedules, 1 MB max message, 15-minute max HTTP response duration, retries count as messages, 50 GB/month bandwidth, 7-day max delay, 3-day DLQ — [Upstash QStash pricing](https://upstash.com/pricing/qstash)
- **Cloud Scheduler:** "3 free jobs" was returned only as a hedged summary — [Cloud Run pricing](https://cloud.google.com/run/pricing) (unverified)

### Inferences
- **Recommended pattern:** an external scheduler pings an authenticated HTTP endpoint, which enqueues per-item work, so no single invocation needs >10 ms CPU or >50 subrequests on Workers Free.
- **QStash:** 288 + 1 + 1 messages/day fits its 1,000/day with room for retries.
- **GitHub Actions** in a private repo consumes Actions minutes (2,000/month free on GitHub Free historically; not verified here). A 5-minute job ≈ 8,640 runs/month, each billed at a minimum of 1 minute, which would exceed that, so a public repo or another scheduler is needed.
- **A system cron on an Oracle VM** is unlimited and free.

### Gaps
- cron-job.org limits were not fetched (historically free, 1-minute minimum interval, 30 s timeout).
- GitHub Free private-repo Actions minutes for 2026 were not verified.

## 6. Inbound email to a handler, and outbound email

### Takeaway
Cloudflare Email Routing remains free with unlimited inbound on the Free plan. Email Workers are billed as ordinary Workers, so on Free they count against 100k requests/day and 10 ms CPU. Outbound sending via Cloudflare's new Email Service is **not available on Free** except to verified destinations. Resend Free covers outbound at 3,000/month and 100/day. ImprovMX Free forwards to a mailbox but its webhooks are paid-only. Oracle Email Delivery offers 3,000/month always-free as an outbound fallback.

### Cited Findings
- **Email Routing on Workers Free:** "Inbound emails (Email Routing): Unlimited"; "Outbound emails (Email Sending): Not available". Sending to verified destination addresses is free on all plans. Email Routing Workers are billed per Workers pricing. Paid plan includes 3,000 outbound/month, then $0.35/1k — [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) (search-result summary of the official page)
- **Email Routing limits:**
  - Message size: 25 MiB inbound
  - 30 domains/zone; 200 rules per domain; 200 verified destinations/account
  - New sending accounts start on conservative daily quotas (2025–2026 "Email Service" launch)

  Source: [Cloudflare Email Routing limits](https://developers.cloudflare.com/email-routing/limits/)
- **Resend Free:** 3,000 emails/month, 100/day, 3 domains, 30-day retention; inbound "included across all plans" without free-tier specifics — [Resend pricing](https://resend.com/pricing)
- **ImprovMX Free:** 1 domain, 25 aliases, 500 forwards/day, 7-day logs. Email webhooks are listed as Premium+ — [ImprovMX pricing](https://improvmx.com/pricing)
- **Oracle Email Delivery Always Free:** 3,000 emails/month — [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Inferences
- **Inbound:** keep Cloudflare Email Routing plus an Email Worker. It is free and preserves the "inbound to handler" capability, as long as the handler is light (10 ms CPU) or just forwards to the API.
- **Resend inbound** (receiving) could be a second off-Cloudflare inbound option if it is genuinely on Free. This needs confirmation.
- **Outbound:** Resend Free's 100/day cap is the binding constraint.

### Gaps
- Not fetched: Mailgun inbound routes on its free plan (2025–2026) and SendGrid Inbound Parse on free (SendGrid retired its permanent free plan in 2025, per memory; unverified).
- Resend inbound limits on Free were not specified.

## 7. Free LLM inference to replace Workers AI

### Takeaway
Workers AI gives 10,000 Neurons/day free on **both** Free and Paid plans, so the cheap "lead vendor" role can stay on Cloudflare at $0 within that cap. Free alternatives:
- **Groq:** about 14,400 req/day on llama-3.1-8b-instant, about 1,000/day on 70B-class models; no card required
- **OpenRouter `:free` models:** 50 req/day, or 1,000/day only after a one-time purchase of 10+ credits, which is not $0
- **Gemini API free tier:** limits now shown only in AI Studio
- **Cerebras:** about 1M tokens/day reported

Groq and Cerebras figures come from aggregators.

### Cited Findings
- **Workers AI:** "10,000 Neurons per day at no charge" on Free and Paid; $0.011/1,000 Neurons beyond that on Paid; some premium models require paid billing — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- **OpenRouter `:free` variants:** 20 req/min, and 50 req/day if under 10 credits purchased or 1,000 req/day with 10+ credits purchased — [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits)
- **Gemini API:** free-tier rate limits are now viewable only in AI Studio; the docs page lists no numbers — [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). (Google cut free-tier quotas in late 2025 per memory; unverified.)
- **Groq free tier:** llama-3.1-8b-instant 30 RPM / 14,400 RPD; llama-3.3-70b-versatile and gpt-oss 30 RPM / 1,000 RPD; groq/compound 250 RPD; limits apply per organization; no card required — [eesel.ai Groq pricing 2026](https://eesel.ai/blog/groq-pricing), [benchlm.ai](https://benchlm.ai/free-tier/groq) (aggregators, not primary)
- **Cerebras free tier:** reported 1M tokens/day, 5 RPM?, 30k uncached TPM, 8,192-token context on free tier. Separately, a $5 credit requires a card and expires in 30 days, so it does not count as $0 — [costbench.com](https://costbench.com/software/llm-api-providers/cerebras-inference/free-plan/), [morphllm.com](https://www.morphllm.com/cerebras-pricing) (aggregators; RPM figure looks low and is unverified)

### Inferences
- **Keep Workers AI** within 10k Neurons/day as the primary free lead vendor, with Groq as overflow (highest no-card free daily request count).
- **OpenRouter's 1,000/day** requires a one-time $10 purchase, so strictly it is not $0.
- **Data policy:** free tiers (especially Gemini free) may use prompts for training, which matters for customer data.

### Gaps
- Primary-source Groq (console.groq.com/docs/rate-limits) and Cerebras limit pages were not fetched.
- Gemini free RPD per model was not obtained.
- The Mistral La Plateforme free tier and GitHub Models free tier were not checked.

## Summary matrix (for the report writer)

| Component | Best $0 option | Capability preserved | Main limit / risk |
|---|---|---|---|
| API runtime | Workers Free (if the 64 MiB, no-compressed-limit rule holds) or Oracle A1 VM | Partial / full | Workers: 10 ms CPU, 50 subreq, 100k req/day. VM: no SLA, idle reclaim |
| Next.js frontend | Workers Free static assets, or Netlify Free (commercial OK) | Mostly | Netlify pauses at 300 credits; Vercel Hobby disallowed (commercial) |
| Durable Objects | Keep on Workers Free (SQLite DO) / self-host Hocuspocus + ws on Oracle VM | Full | 100k DO req/day, 100k rows written/day |
| Object storage + wildcard sites | R2 Free + Worker router; or B2 + Cloudflare proxy | Full | 10 GB; request ceiling of the routing Worker |
| KV | DO-SQLite or Redis on VM; KV Free only for the cron gate | Partial | KV Free 1k writes/day; Upstash 500K cmds/month |
| Cron | QStash Free / VM cron / GH Actions (public repo) | Full | Free Worker cron 10 ms CPU |
| Inbound email | Cloudflare Email Routing + Email Worker | Full | Worker Free CPU/request limits |
| Outbound email | Resend Free; OCI Email Delivery 3k/month | Full at low volume | 100/day |
| LLM lead | Workers AI 10k Neurons/day + Groq free | Full at low volume | Rate limits; aggregator-sourced figures |
