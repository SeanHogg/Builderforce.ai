# Cloudflare Free plan and Neon Free plan limits (October 2026), and hybrid "$0" layouts for Builderforce.ai

All pages fetched on 2026-10-03. Each item gives the "last updated" date the vendor page showed. Everything comes from a 2025–2026 source unless marked otherwise.

## Q1. Cloudflare Workers Free: core limits

### Takeaway
The deploy-size blocker is gone. On 2026-09-04 Cloudflare dropped the compressed limits (3 MB Free / 10 MB Paid), so the 4.58 MiB-gzip API worker now deploys on Free as long as it is under 64 MiB uncompressed. The real limits on Free are now **10 ms CPU per request**, **100,000 requests/day**, and **50 external subrequests per invocation**. The 50 did not change in 2026; only Paid went up.

### Cited Findings
- Workers Free vs Paid table (page last updated 2026-09-05): 100,000 requests/day on Free (Paid has no daily limit). CPU time is 10 ms per HTTP request on Free and up to 5 min on Paid (default 30 s). Memory is 128 MB on both. Subrequests are 50/request on Free and 10,000 on Paid (configurable up to 10M). Worker size is 64 MiB uncompressed on both. Startup time is 1 second on both. Free allows 100 Workers per account (Paid 500), 5 cron triggers per account (Paid 250), 64 env vars per Worker (Paid 128) at 5 KB each, 6 simultaneous connections, and 20,000 static asset files per version (Paid 100,000) at 25 MiB per file — [CF Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- How strictly CPU is enforced: "Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit". The page also says "the average Worker uses approximately 2.2 ms per request." Cloudflare publishes no exact grace amount — [CF Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Going over the daily limit returns **Error 1027**. A route set to "fail open" skips the Worker; one set to "fail closed" shows the error page. The limit resets at 00:00 UTC — [CF Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Size change: "Cloudflare now only checks the uncompressed size of your bundle, which is 64 MiB across all plans". The gzip figure is "shown for reference but is no longer a limit". To check a bundle, run `wrangler deploy --outdir bundled/ --dry-run` and read `Total Upload`. Changelog date 2026-09-04 — [CF changelog: Deploy larger Workers](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/); also reported by [Produlis](http://produlis.com/blog/cloudflare-workers-size-limit-d1-enforcement)
- Subrequests: the 2026-02-11 changelog removed the old 1,000 cap for **Paid**, which now defaults to 10,000 and can be raised to 10M. "Workers on the free plan remain limited to 50 external subrequests and 1000 subrequests to Cloudflare services per invocation" — [CF changelog 2026-02-11](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/). The page's statement that subrequests include calls "to Cloudflare services like R2, KV, or D1" comes from [CF Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- The Cache API allows 50 calls per request on Free and 1,000 on Paid. The maximum object size is 512 MB on both — [CF Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Pricing page (last updated 2026-10-02): Free gets "100,000 per day" requests and "10 milliseconds of CPU time per invocation" — [CF Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

### Inferences
- **The biggest risk is the 10 ms CPU limit.** A 4.58 MiB-gzip Hono bundle has a large module graph to evaluate, and an API that does JSON reshaping, auth/JWT verification, crypto or LLM response parsing will often go past 10 ms. The "flexibility" allows occasional overruns, not routine ones. Expect intermittent `Exceeded CPU` errors on heavy routes. The fix is to move heavy routes off the Worker, not to split the bundle.
- The 1 s startup limit still applies to the now-allowed large bundles. A big bundle can deploy and still fail on startup. Test this with a dry-run deploy.
- 50 external `fetch()` calls per invocation limits fan-out to LLM providers or third-party APIs. Calls to CF bindings get 1,000.
- The 4 cron schedules fit under the 5-per-account cap. Each cron run is an invocation with the same 10 ms CPU limit. A cron every 5 minutes uses only 288 requests/day.
- Splitting the Worker for size is **no longer needed**. Splitting it to spread CPU is useless, because each invocation still gets 10 ms.

### Gaps
- I found no published number for how much CPU overrun the isolate "flexibility" tolerates.
- I found no 2026 statement on whether the 1 s startup limit is measured differently for bundles over 10 MB.

## Q2. Durable Objects (SQLite) on Free

### Takeaway
SQLite-backed DOs are allowed on Free with **100k requests/day, 13,000 GB-s/day, 5M rows read/day, 100k rows written/day and 5 GB total storage**. Going over any of these makes further operations fail; nothing is billed. SQLite storage billing began January 2026.

### Cited Findings
- Free: Requests "100,000 / day", Duration "13,000 GB-s / day", Rows read "5 million / day", Rows written "100,000 / day", Stored data "5 GB (total)" — [CF DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- Incoming WebSocket messages are billed at a 20:1 ratio, so 100 messages count as 5 requests. Each `setAlarm()` counts as one row written. Limits reset at 00:00 UTC. "Exceeding any limit causes further operations to fail with an error." Free supports **only SQLite-backed** DOs, not KV-backed ones. SQLite storage billing targeted 2026-01-07 — [CF DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- Paid overage is $0.15 per million requests and $12.50 per million GB-s — [CF DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

### Inferences
- 13,000 GB-s/day at 128 MB per DO comes to about 101,000 DO-seconds/day, or roughly 28 DO-hours/day of wall-clock activity across all objects. A DO held open by a non-hibernated WebSocket burns duration continuously, so a few always-on DOs could use most of this. WebSocket Hibernation is required on Free.
- 100k rows written/day across 11 DO classes is tight if they log events, keep presence, or write per message. Every alarm reschedule also uses one row.
- The 100k DO requests/day appears to be a separate allowance from the 100k Worker requests/day; the pricing page lists them separately. Whether a DO stub call also counts as a Worker request is not stated (see Gaps).

### Gaps
- No primary source says whether DO requests count toward the 100k Workers requests/day as well as the 100k DO requests/day.

## Q3. KV, Cache, D1, R2, Queues, Workers AI, Email, Logs, Analytics Engine, Hyperdrive, Containers, Browser Rendering on Free

### Takeaway
Most building blocks have a Free allowance: KV, D1, R2, Queues (now on Free), Workers AI, Hyperdrive, Logs, Analytics Engine, Email Workers and Browser Rendering (now called "Browser Run"). **Containers have no Free allowance at all.** Browser Rendering on Free gives only **10 browser-minutes/day and 3 concurrent browsers**, so it cannot realistically replace the headless-Chromium containers.

### Cited Findings
- **KV** (last updated 2026-04-21): Free gives 100,000 reads/day, **1,000 writes/day** to different keys, 1 write/s to the same key, 1 GB storage per account, 512 B keys and 25 MiB values. Paid has no read/write limit. The table does not list deletes or lists separately. Up to 1,000 operations per invocation across external services — [CF KV limits](https://developers.cloudflare.com/kv/platform/limits/). An older, pre-2025 figure of 1,000 deletes/day and 1,000 lists/day on Free is **not confirmed** on the current page.
- **D1** (Free): 5M rows read/day, 100k rows written/day, 5 GB total storage — [CF Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). Since 2026-09-01 D1 *enforces* these daily limits on Free, so queries fail instead of only showing in the dashboard. Rows *scanned* count, not rows returned — [Produlis summary](http://produlis.com/blog/cloudflare-workers-size-limit-d1-enforcement), citing the [CF changelog 2026-09-01](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/). I read the changelog only through the secondary source, not directly.
- **R2** (last updated 2026-10-01): free tier is 10 GB-month storage, 1M Class A operations/month, 10M Class B operations/month, and free egress. It covers Standard storage only, not Infrequent Access — [CF R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- **Queues**: "Available on Free: Yes", with "10,000 operations/day included" — [CF Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- **Workers Logs**: 200,000 log events/day and 3-day retention on Free — [CF Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- **Hyperdrive** (last updated 2026-06-18): available on Free with 100,000 database queries/day. Every statement counts, including SELECT, DML and DDL. Operations fail when the limit is exceeded — [CF Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- **Workers AI** (last updated 2026-10-01): 10,000 Neurons/day on both Free and Paid. On Free, going over fails with an error; Paid is billed at $0.011 per 1,000 Neurons — [CF Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- **Analytics Engine**: Free gets 100,000 data points written/day and 10,000 read queries/day. "Currently, you will not be billed" because billing has not started yet — [CF Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
- **Email Routing / Email Workers**: 200 rules per domain, 200 verified destination addresses per account, 25 MiB inbound messages. Email handlers on Free "may fail if they exceed CPU and memory thresholds" with `EXCEEDED_CPU`; Paid gives more headroom — [CF Email limits](https://developers.cloudflare.com/email-routing/limits/)
- **Containers** (last updated 2026-08-28): "only available with the Workers Paid plan ($5 USD per month)". The Free row shows N/A for memory, CPU and disk — [CF Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- **Browser Run (Browser Rendering)**: Free gives **10 minutes of browser time per day** and **3 concurrent browsers** (Browser Sessions only). Paid includes 10 h/month and then $0.09/h, plus 10 concurrent browsers (monthly average) and then $2.00 per browser. A Quick Action that fails with `waitForTimeout` is not charged — [CF Browser Run pricing](https://developers.cloudflare.com/browser-rendering/pricing/)
- **Service bindings**: "Requests made from your Worker to another worker via a Service Binding do not incur additional request fees" — [CF Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

### Inferences
- 1,000 KV writes/day is the tightest KV limit. Session or rate-limit counters, feature-flag churn, or caching LLM output in KV will hit it quickly. Move write-heavy keys into a SQLite DO, which allows 100k rows written/day.
- 10 browser-minutes/day is about 20–60 short page renders a day. That works for occasional screenshots or PDF exports, but not as a substitute for 3 always-available Chromium containers.
- Queues on Free gives 10k ops/day. One message costs about 3 ops (write, read, delete), so roughly 3,300 messages/day — which is my estimate, not a vendor figure.
- Hyperdrive on Free (100k queries/day) makes Neon usable from the edge without a connection storm. That budget is separate from the Worker request budget.
- Service-binding wording is about *fees*. It does not clearly say whether a bound call counts against the Free plan's 100k/day. Splitting a Worker therefore may or may not double-count requests.

### Gaps
- I could not confirm from a primary page whether enabling R2 on a Free account needs a payment method on file. The pricing page does not say.
- Whether service-binding calls count toward the Free 100k requests/day was not stated explicitly.
- KV deletes/day and lists/day on Free are not on the current limits page.
- Current Free limits for the Cache API beyond calls per request (for example per-zone cache size) were not found.

## Q4. Neon Free (2026)

### Takeaway
Neon Free gives **100 projects per org, each with its own 100 CU-hours/month, 1 GB storage (20 GB per org), 5 GB egress, and a 2 CU maximum**. Builderforce's three databases (437 / 261 / 8 MB) fit the storage caps. The ~235 CU-hours/month org-wide fits **only if no single project uses more than 100 CU-hours**. Any project that does gets suspended until the next cycle.

### Cited Findings
- Free plan: 100 projects per organization, 10 branches per project, **100 CU-hours per project per month**, **1 GB per project and 20 GB across all projects**, a 2 CU maximum (about 8 GB RAM), 6 hours of instant-restore history capped at 1 GB-month, 1 manual snapshot per project, 1 day of monitoring retention, 5 GB public network transfer per project per month, and autosuspend after 5 minutes that cannot be disabled — [Neon plans docs](https://neon.com/docs/introduction/plans); [Neon pricing](https://neon.com/pricing)
- At the limits: running out of compute means "Your compute is suspended until the next billing period or until you upgrade". Going over storage makes writes that add storage fail. Reaching 10 branches makes branch creation fail. "data is never deleted" — [Neon plans docs](https://neon.com/docs/introduction/plans); [Neon pricing](https://neon.com/pricing)
- "Compute quotas are measured per project, so 100 projects each get their own 100 CU-hour bucket" — [Neon FAQ free-plan limits](https://neon.com/faqs/free-plan-limits-and-quotas)
- The Neon ToS (effective 2026-08-05) announces a "Major update to our Free Plan: now with 1 GB of Postgres storage per project, 100 projects included" — [Neon ToS](https://neon.com/terms-of-service). **Conflict:** a search snippet from a Neon page still says "0.5 GB of storage per project" ([Neon FAQ snippet](https://neon.com/faqs/tools-manage-multiple-postgres-databases)). That figure is the older one. The current plans page, pricing page and FAQ all say 1 GB.
- The Free plan also includes Managed Auth up to 60k MAU, 5 GB Object Storage, and Functions (10 active capacity-hours and 1M invocations per month) — [Neon plans docs](https://neon.com/docs/introduction/plans)
- The cheapest paid plan is Launch: pay-as-you-go with no minimum, $0.106 per CU-hour, $0.35 per GB-month, and autoscaling up to 16 CU — [Neon pricing](https://neon.com/pricing)

### Inferences
- With 3 projects, Builderforce has a 300 CU-hour/month ceiling against ~235 used. That is enough only if the split per project is under 100 each. The 437 MB "main" project probably carries most of the compute and is the likely one to be suspended mid-month. Splitting load across more projects has to follow data ownership; one database cannot be sharded across projects for free without rewriting the app.
- Autosuspend after 5 minutes adds cold-start latency (a few hundred ms) to the first query after idle. The every-5-minutes cron could keep one compute awake. That costs about 730 CU-hours/month at 1 CU, or 182 at 0.25 CU, which by itself breaks the 100 CU-hour cap. **Do not let the cron keep Neon warm.**
- 5 GB of egress per project per month can be hit by an API that pulls large JSON rows through Hyperdrive at volume.
- The 6-hour restore window is not a production backup. Pair it with a pg_dump to R2 (10 GB free).

### Gaps
- The Neon plans docs carry no publication date. The 1 GB storage figure is dated only by the ToS banner (ToS effective 2026-08-05).
- I found no Neon statement on how CU-hours are charged during brief autosuspend wake-ups (for example a minimum billing window).

## Q5. Terms of service: free plans for commercial production, multiple accounts or projects

### Takeaway
Neither vendor bans commercial production use on free plans. Both give free users no SLA and broad termination rights. Cloudflare bars **processing or collecting credit card data on a property receiving Free services** and bars creating multiple accounts by script. I found nothing in Neon's ToS against using several free projects for one app; Neon's own FAQ presents per-project buckets as intended.

### Cited Findings
- Cloudflare Self-Serve Subscription Agreement (effective 2025-09-12): no explicit ban on commercial use. Customers may not "process or collect personal or business credit card information on any web property that is receiving Free Services". "We will have no liability for any harm or damage arising out of or in connection with any Free Services". Free services last until "termination of the Free Service by Cloudflare in our sole discretion". Cloudflare may "Suspend or terminate your use or access to the Service at any time, with or without notice for any reason or no reason at all". Prohibited: "introduce software or automated agents or scripts into the Services so as to produce multiple accounts" — [Cloudflare Terms](https://www.cloudflare.com/terms/)
- Cloudflare Service-Specific Terms (Developer Platform): "Cloudflare may temporarily limit your storage and/or the number of requests you can make or receive using the Developer Platform if processing such requests would put an undue burden on the Cloudflare network". No plan-tier commercial restriction was found — [CF Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-developer-platform/)
- Neon ToS (effective 2026-08-05): no clauses on free-plan commercial use, multiple accounts or limit circumvention. The SLA applies only to Scale Self Service customers — [Neon ToS](https://neon.com/terms-of-service)
- Neon FAQ: "100 projects each get their own 100 CU-hour bucket" — [Neon FAQ](https://neon.com/faqs/free-plan-limits-and-quotas)

### Inferences
- **The credit-card clause matters for a SaaS.** If Builderforce's billing pages collect card details on a Cloudflare-Free-proxied domain, even through an embedded form, that conflicts with the Agreement. Redirecting to a Stripe-hosted Checkout page on Stripe's domain is the defensible reading. This is my interpretation, not legal advice.
- Spreading three databases across three Neon projects in one org matches Neon's documented design. Opening several *Cloudflare accounts* to multiply the 100k/day limits is the pattern the multiple-accounts clause targets.

### Gaps
- I did not read Neon's Acceptable Use Policy separately. The ToS summary found no free-tier abuse clause, but the AUP may contain one.

## Q6. Viable hybrid "$0" layouts

### Takeaway
A "$0" Builderforce is possible only as a **Cloudflare Free edge plus a free VM origin** reached through Cloudflare Tunnel. The Workers stay a thin router with auth, DOs, R2 and email. The Hono API's heavy routes and all three containers run on an Oracle Always Free A1 VM, which is now **2 OCPU / 12 GB**, cut from 4/24 in June 2026. Neon Free works only if each project stays under 100 CU-hours; self-hosting Postgres on the VM removes that cap but adds operational risk.

### Cited Findings
- Oracle Always Free Ampere A1: 1,500 OCPU-hours and 9,000 GB-hours per month, equal to **2 OCPUs and 12 GB**. That is one 2/12 instance or two 1-OCPU instances. Also included: 200 GB block or boot storage, 5 volume backups, and 10 TB/month outbound. Idle instances can be reclaimed if, over 7 days, 95th-percentile CPU, network and memory (A1) are all under 20% — [Oracle Always Free docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)
- The reduction from 4 OCPU / 24 GB took effect 2026-06-15 without an announcement — [braindetox.kr](https://braindetox.kr/en/posts/oracle_always_free_tier_reduced_2026.html) (secondary source); [InfoQ 2026-07](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/) (secondary source, seen only as a title). The 2 OCPU / 12 GB figure is confirmed by Oracle's own page above.
- Cloudflare Free retains: Workers (100k/day, 10 ms), SQLite DOs, R2 at 10 GB, KV, Queues, Hyperdrive, Workers AI at 10k neurons/day, Email Workers, Browser Run at 10 min/day, and 5 crons — see the citations in Q1–Q3.
- Containers are unavailable on Free — [CF Containers pricing](https://developers.cloudflare.com/containers/pricing/)

### Layout A: Cloudflare Free + Neon Free (no VM)
- **Keeps:** all edge features, DOs, R2, KV, email, crons, Workers AI at 10k/day, and Neon over Hyperdrive.
- **Loses:** all 3 Containers, with no replacement. Browser Run at 10 min/day is a token substitute. Heavy API routes will hit 10 ms CPU limits. Production reliability goes when any per-day limit (Worker 100k, DO writes 100k, KV writes 1k, AI 10k neurons) or a per-project 100 CU-hour cap trips.
- **Verdict:** not viable for the current feature set. It is viable only for a reduced product with no container workloads.

### Layout B: Cloudflare Free edge + Oracle A1 VM via Cloudflare Tunnel + Neon Free
- **Edge (CF Free):** routing and auth checks, static assets, DOs (realtime, coordination), R2, Email Routing to Worker, crons that only *trigger* VM jobs, and small Workers AI calls. Requests forwarded to the Tunnel origin are subrequests (one per proxy), well within 50.
- **VM (2 OCPU / 12 GB):** the 3 container images as Docker (including headless Chromium) and heavy Hono routes run as a Node process with no CPU limit. Run Workers-only code (DO stubs, bindings) only at the edge.
- **DB:** Neon Free, 3 projects, with Hyperdrive from the edge and direct connections from the VM.
- **Keeps:** nearly every feature at $0.
- **Loses or risks:** 12 GB RAM shared by 3 containers (Chromium is memory-hungry) plus the API. Single-VM availability with no SLA. Possible Oracle idle reclaim (a 20%/7-day test). The 100 CU-hour per-project Neon cap. Two code paths (Workers runtime and Node).
- **Verdict:** the most practical $0 layout. Neon's per-project compute cap is its main fragility.

### Layout C: Layout B with self-hosted Postgres on the VM, Neon dropped
- **Keeps:** no CU-hour cap and no 5 GB egress cap. About 0.7 GB of data fits easily in 200 GB of block storage.
- **Loses:** managed PITR and branching, which you replace with pg_dump to R2 (10 GB free). It also puts the DB and compute on the same single VM, so one failure takes everything down. Postgres also eats into the 12 GB of RAM.
- **Verdict:** viable and removes the hardest Neon limit, but less resilient.

### Layout D: Cloudflare Free + Neon Free, with Browser Run replacing Chromium containers
- Works only if headless browsing is under about 10 browser-minutes/day and never needs more than 3 concurrent browsers — [CF Browser Run pricing](https://developers.cloudflare.com/browser-rendering/pricing/). The other 2 containers still need a home, which leads back to Layout B.

### Inferences
- The 2026-09-04 size change removes the main reason for a Worker split. The **10 ms CPU** limit now decides what must move to the VM. Profile each route's CPU with `wrangler tail` or Workers Logs (200k events/day free) before deciding.
- 11 DO classes will fit on Free only with Hibernation and write-light designs. Watch the 100k rows written/day.
- None of these layouts gives a production SLA. Both vendors disclaim liability for free services, and Oracle can reclaim idle instances. For a paying-customer SaaS, Workers Paid ($5/mo) is the cheapest single change that removes most of these limits. It brings CPU up to 5 min, puts Containers back, and removes the daily caps.

### Gaps
- I did not verify any limits for Cloudflare Tunnel (cloudflared) on Free. It is generally free, but I did not fetch a primary page this session.
- Whether Oracle requires a pay-as-you-go upgrade to avoid A1 capacity or reclaim problems in 2026 was not verified from a primary source.
- I did not research alternative free VMs (GCP e2-micro, Fly, etc.); other researchers may be covering them.
