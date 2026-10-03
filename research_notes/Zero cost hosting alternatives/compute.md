# Free-forever ($0/month) compute to replace Cloudflare Containers (as of 2026-10-03)

Scope: workloads 1-5 from the brief (cloud coding agent up to ~25 concurrent, Playwright QA runner x3, stage sandbox x3, live preview dev servers, possibly the whole Hono/Node API with websockets + 5-min cron). Credits/trials are listed separately and do not count as $0.

**Headline changes in 2025-2026 that invalidate older "free hosting" lists:**
- Oracle halved Always Free Ampere A1 on 2026-06-15 (4 OCPU/24 GB -> 2 OCPU/12 GB), enforced by auto-stop around 2026-08-18.
- Hugging Face now requires a paid plan (PRO / Team / Enterprise) to create Docker or Gradio Spaces; only Static Spaces are free.
- Koyeb has offered no free compute instance to new users since February 2026.
- AWS ended the 12-month free tier for accounts created on or after 2025-07-15 (replaced by up to $200 in credits with a 6-month expiry).
- GitHub announced a $0.002/min self-hosted runner fee for March 2026, then postponed it indefinitely. Self-hosted runners are still free per the official docs.
- Fly.io offers new orgs only a trial (2 machine-hours or 7 days). Railway Free is $1/month of credit.

---

## 1. Oracle Cloud Always Free (Ampere A1): exact current terms, reclamation, termination risk, ARM fit

### Takeaway
Oracle is still the only option that gives a real always-on VM with Docker for $0, but it is now **2 OCPU / 12 GB Arm** (1,500 OCPU-h + 9,000 GB-h per month), not 4/24. It sits in your home region only, faces "out of host capacity" errors, can be reclaimed if idle, and carries a documented risk of unexplained account terminations. It can host a few concurrent agent and browser containers, not 25.

### Cited Findings
- Current official Always Free A1 allowance: **1,500 OCPU-hours and 9,000 GB-hours per month**, the equivalent of **2 OCPUs and 12 GB of memory**, on shape VM.Standard.A1.Flex (e.g. 2 x 1-OCPU instances or 1 x 2-OCPU instance) — [Oracle docs: Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) (fetched 2026-10-03)
- Also Always Free: up to **2 AMD VM.Standard.E2.1.Micro** instances (1/8 OCPU burstable, 1 GB RAM, up to 50 Mbps internet bandwidth each); **200 GB total block storage** (boot + block; 50 GB default boot volume, 47 GB minimum); 5 volume backups; **10 TB/month outbound data transfer** — [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- Always Free compute must be created in the tenancy's **home region**. "Out of host capacity" errors mean temporary lack of Always Free shapes. South Korea North (Chuncheon) has no A1 — [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- **Idle reclamation:** an instance is reclaimable if, over a 7-day period, 95th-percentile CPU utilization < 20%, network utilization < 20%, and (A1 only) memory utilization < 20% — [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- **The 2026 cut:** effective 2026-06-15, the allowance dropped from 3,000 OCPU-h / 18,000 GB-h (4 OCPU / 24 GB) to 1,500 / 9,000 (2 OCPU / 12 GB), with no public announcement. Free-tier instances above the new limits were shut down until manually resized — [InfoQ, Jul 2026](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/); [Linuxiac, 2026-06-14](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/)
- Oracle began auto-stopping and disabling instances above the new limit around **2026-08-18** — [bex.co blog, 2026-09-26](https://bex.co/blog/2026/09/26/oracle-always-free-cut-free-tier-k8s-vs-hetzner) (secondary source, via search summary)
- **Pay-As-You-Go (PAYG) accounts are ambiguous.** Oracle support agents told multiple users by email that PAYG tenancies keep the old 4 OCPU / 24 GB at no charge, but this is undocumented. The official doc says "All tenancies get the first 1,500 OCPU hours and 9,000 GB hours". If a grandfathered resource is terminated, it may not be possible to recreate it above the new limit — [InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/). Linuxiac reports that for PAYG, "continued usage above the new documented allowance may result in charges" — [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/). **These two sources conflict.**
- **Account-termination risk:** recurring community reports of free-tier accounts terminated without notice and with no reason given ("your account has been terminated, and we are unable to provide additional information or reactivate it"). Reported triggers include perceived inactivity, never logging into the portal, low CPU, and payment-verification problems — [LowEndSpirit thread](https://lowendspirit.com/discussion/10956/oracle-free-tier-changing-be-careful-confirmed); [r/oraclecloud via gummysearch](https://gummysearch.com/r/oraclecloud) (community and anecdotal, not official)
- **ARM and Playwright:** reports say installing *Google Chrome* (branded channel) on Linux arm64 fails with "ERROR: not supported on Linux Arm64", while Playwright's own Chromium builds exist for arm64 — [zenn.dev article](https://zenn.dev/saneatsu/articles/f1f2141b6d464a); [browserless blog](https://www.browserless.io/blog/run-playwright-in-docker). The official Playwright Docker doc (fetched) lists Ubuntu 26.04/24.04/22.04 base images, recommends `--ipc=host` for Chromium to avoid OOM crashes, and does not support Alpine/musl — [playwright.dev/docs/docker](https://playwright.dev/docs/docker)
- **Coolify** (open-source self-hosted PaaS) supports ARM64 and has specific notes for the Oracle free ARM server (open ports in the Oracle dashboard). It integrates with Cloudflare Tunnels so each app gets a subdomain through one tunnel (Traefik routing). It needs port 6001 for its own websocket features — [Coolify install docs](https://coolify.io/docs/get-started/installation); [Coolify firewall docs](https://coolify.io/docs/knowledge-base/server/firewall)

### Inferences
- **Capacity at 2 OCPU / 12 GB.** An Ampere OCPU is one physical Arm core, so this is roughly 2 vCPU (my understanding, not confirmed in the fetched doc).
  - Realistic concurrency is about 2-4 coding-agent containers doing `npm ci` + `tsc` + tests (each ~1.5-3 GB peak RAM, and CPU-bound on 2 cores), OR about 3 headless-Chromium sessions plus a small API. It cannot do both at the budgeted peaks.
  - 25 concurrent agents is out of reach. Builds that take minutes on a Cloudflare Container standard instance will be slower on 2 shared cores.
- **The two micro AMD VMs (1 GB each)** suit only a tunnel endpoint, cron pinger or tiny proxy. They cannot run Chromium or builds.
- **Reclamation cuts both ways.** It rarely hits a busy agent or preview box. A mostly-idle preview box can trip all three <20% thresholds over 7 days, and the A1 memory criterion helps here because a box holding containers in RAM is likely above 20% memory.
- **Single point of failure for production.** Silent policy changes (the June 2026 cut), capacity errors when re-provisioning, and unexplained terminations make Oracle Always Free a poor sole home for a production SaaS API. Upgrading to PAYG (card on file, still $0 if within limits) is widely reported to reduce termination risk and may preserve 4/24, but neither is guaranteed.
- **ARM fit.** Use Playwright's bundled Chromium (`npx playwright install chromium`, or the multi-arch `mcr.microsoft.com/playwright` image), not the `chrome` channel. Native Node addons in user repos (esbuild, swc, sharp) ship arm64 binaries in most modern versions, but arbitrary user repos may hit x86-only deps.
- **Exposure path.** Oracle VM -> Docker/Coolify (or Dokku/CapRover) -> Cloudflare Tunnel avoids opening inbound ports and keeps TLS at Cloudflare. Egress is 10 TB/month, ample.

### Gaps
- Official Oracle wording on whether PAYG tenancies keep 4/24 for free: not found. Only support-email anecdotes and conflicting secondary sources.
- No official Oracle statement of termination criteria for free accounts. Evidence is anecdotal.
- No official Playwright statement fetched on multi-arch (linux/arm64) tags for `mcr.microsoft.com/playwright`; the docs page did not mention architecture.
- Coolify minimum resource overhead was not sourced.
- Cloudflare Tunnel free-plan limits (websocket support, request size) were not fetched in this pass; another researcher may cover Cloudflare.

---

## 2. Hyperscaler free tiers: Google Cloud, AWS, Azure

### Takeaway
GCP e2-micro (1 GB RAM) is the only hyperscaler VM that is genuinely forever-free, and it is too small for any workload here besides a cron/proxy. Cloud Run's free tier (180k vCPU-s, 360k GiB-s) is a meaningful $0 serverless container option for the API and short jobs. AWS no longer has a 12-month free VM for new accounts. Azure's "always free" B1s/B2pts/B2ats hours are tied to keeping a PAYG account.

### Cited Findings
- **GCP Compute Engine Always Free:** 1 non-preemptible **e2-micro** VM per month in us-west1 (Oregon), us-central1 (Iowa) or us-east1 (South Carolina), 30 GB-months standard persistent disk, **1 GB/month egress** from North America — [Google Cloud Free Program docs](https://docs.cloud.google.com/free/docs/free-cloud-features) (fetched 2026-10-03)
- **Cloud Run Always Free (request-based billing):** 2 million requests/month, **360,000 GB-seconds memory, 180,000 vCPU-seconds**, 1 GB North America egress/month — [Google Cloud Free Program docs](https://docs.cloud.google.com/free/docs/free-cloud-features)
- **Cloud Build:** 2,500 build-minutes/month on e2-standard-2 — [Google Cloud Free Program docs](https://docs.cloud.google.com/free/docs/free-cloud-features)
- GCP Free Trial: $300 credit valid 90 days (a credit, not $0-forever) — [Google Cloud Free Program docs](https://docs.cloud.google.com/free/docs/free-cloud-features)
- **AWS:** from 2025-07-15, new accounts get up to $200 in credits ($100 at signup + $100 earned) and a Free account plan that expires after **6 months** or when credits run out. The 12-month free tier (which included 750 h/month t2/t3.micro) is discontinued for new accounts. 30+ "always free" services remain (these do not include EC2 instance hours) — [AWS What's New, July 2025](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/); [AWS News Blog](https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits)
- **Azure:** the free-VM page states 750 hours each of **B1s, B2pts v2 (Arm) and B2ats v2 (AMD)** burstable VMs, with "this benefit is always free". The Azure free account also states you must move to pay-as-you-go within 30 days or after using the credit to keep receiving free services — [Azure free VMs page](https://azure.microsoft.com/free/virtual-machines/); [Azure free page](https://azure.microsoft.com/en-in/free/)

### Inferences
- **Cloud Run free tier in real terms.** 180,000 vCPU-s is 50 vCPU-hours/month, and 360,000 GiB-s is 100 GiB-hours.
  - Example: a 1 vCPU / 2 GiB coding-agent job of 15 min uses 900 vCPU-s and 1,800 GiB-s. That gives about 200 runs/month on CPU, but memory caps it at about 200 (360k/1,800). So the free tier covers roughly 200 x 15-min agent runs/month, or an API on request-based billing at low traffic.
  - An always-on Cloud Run instance (min-instances=1) would burn 2.6M vCPU-s/month and blow the free tier.
  - The 1 GB egress cap is a hard constraint for previews or anything streaming.
  - Cloud Run allows Docker images and websockets, but it is request-scoped, so the 5-min cron would need Cloud Scheduler.
- **e2-micro** (2 shared vCPU, 1 GB RAM from general knowledge) cannot run Chromium or TypeScript builds of a real monorepo reliably.
- **Azure.** The B-series hours appear to be "always free" only for an upgraded PAYG account. B2pts v2 (Arm, 2 vCPU / 1 GiB) and B2ats v2 (2 vCPU / 1 GiB) are similarly tiny. Treat Azure as ~1 GB-class VMs.

### Gaps
- Cloud Run pricing page fetch failed (truncated), so I could not confirm whether instance-based billing has its own free tier, Cloud Run Jobs free tier specifics, or max job/task timeouts.
- Azure always-free VM specs (vCPU/RAM per size) and the exact duration of the B-series benefit were not confirmed from a primary page body. Search snippets only; older Azure terms said 12 months.

---

## 3. GitHub Actions and Codespaces

### Takeaway
GitHub-hosted runners are **unlimited free on public repos** and 2,000 min/month on private repos (Free plan). Self-hosted runners remain free; the proposed March 2026 $0.002/min fee was postponed indefinitely. Actions is usable for bursty, job-shaped work (agent runs, Playwright QA) via `workflow_dispatch`, not for interactive previews or the API. Codespaces is 120 core-hours (60 h on a 2-core machine) for personal accounts only.

### Cited Findings
- **Included minutes:** Free plan 2,000 min/month, 500 MB artifacts; Pro 3,000 min, 1 GB; Team 3,000 min, 2 GB; cache 10 GB per repository — [GitHub Docs: Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) (fetched 2026-10-03)
- "The use of standard GitHub-hosted runners is free" for **public repositories** — [GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- **Self-hosted:** "GitHub Actions usage is free for self-hosted runners" — [GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- **Self-hosted fee history:** GitHub announced (Dec 2025) a $0.002/min "Actions cloud platform" charge for self-hosted runners in private/internal repos from 2026-03-01, then postponed it indefinitely after backlash — [DevClass, 2025-12-17](https://devclass.com/2025/12/17/github-to-charge-for-self-hosted-runners-from-march-2026/); [samexpert](https://samexpert.com/github-actions-pricing-backlash-2026/); [GitHub community discussion #182089](https://github.com/orgs/community/discussions/182089)
- On 2026-01-01, hosted runner prices dropped up to 39% (Linux 2-core x64 $0.008 -> $0.006/min). Current Linux rates: 1-core x64 $0.002, 2-core x64 $0.006, 2-core arm64 $0.005 — [GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions); [cicdpipelinecost.com](https://cicdpipelinecost.com/github-actions-pricing)
- **Codespaces:** personal GitHub Free gets 120 core-hours + 15 GB-month storage; Pro gets 180 core-hours + 20 GB-month. **Organizations get no free Codespaces quota** — [GitHub Docs: Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)

### Inferences
- **Coding agent via private-repo minutes.** 2,000 min/month on a private org repo is about 133 x 15-min runs, and minutes are billed per job.
- **Public-repo "runner farm" trick.** A public repo that dispatches jobs gives unlimited standard runners (4 vCPU/16 GB Linux on public repos per general knowledge), but logs are public. That is unacceptable for customer code and secrets, and it likely conflicts with GitHub's Acceptable Use / Actions terms when used as general compute for a SaaS backend (GitHub's terms prohibit using Actions for activity unrelated to the repository's software project; I did not fetch the clause this pass).
- **Concurrency.** The Free plan's concurrent-job cap (20 jobs for Free per general knowledge) would roughly fit "~25 agents" only on paper.
- **Self-hosted runners on Oracle** (free) let Builderforce use GitHub as a job queue with zero GitHub charge. Capacity is still bound by Oracle's 2 OCPU / 12 GB.
- **Codespaces** is not usable for a multi-tenant SaaS: personal-only quota, and its ToS frames it as a dev environment.

### Gaps
- Max job duration (6 h for hosted runners), free-plan concurrency limits and the Actions ToS clause on non-CI compute were not confirmed from primary pages in this pass.

---

## 4. Container PaaS free tiers (Render, Koyeb, Fly.io, Railway, Northflank, Hugging Face Spaces, Deno Deploy)

### Takeaway
Only **Render** (512 MB / 0.1 CPU, sleeps after 15 min, 750 h/workspace) and **Northflank** (2 free always-on services) still offer free Docker containers without a time limit. Both are far too small for builds or Chromium. Hugging Face Docker Spaces (2 vCPU / 16 GB) are **no longer free to create**. Koyeb, Fly.io and Railway are effectively trial or paid-only now.

### Cited Findings
- **Render:** 750 Free instance hours per workspace per month (spun-down time not counted; exhausted means suspended until next month). Spins down after 15 min without inbound traffic; spin-up ~1 min. No persistent disks, no one-off jobs, no SSH/shell, single instance only, SMTP ports blocked, no private-network receive. Filesystem lost on spin-down or redeploy. Suspension possible for "uncommonly high volume" outbound traffic — [Render docs: Deploy for Free](https://render.com/docs/free) (fetched 2026-10-03)
- Render free web service spec **512 MB RAM, 0.1 CPU**. A spin-down also restarts on a new WebSocket connection — [Render article, 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026); [agentdeals correction issue #2182](https://github.com/robhunter/agentdeals/issues/2182)
- **Koyeb:** pricing page now lists only a free Postgres (0.25 vCPU, 1 GB, 1 GB storage, 5 h/month active) and Pro at $29/month (incl. $10 compute). No free compute instance. Sources say there has been no free plan for new users since February 2026 — [Koyeb pricing](https://www.koyeb.com/pricing); [agentdeals #2182](https://github.com/robhunter/agentdeals/issues/2182). *Conflict:* one aggregator says a free instance remains "but requires a card since February 2026" — [snapdeploy](https://snapdeploy.dev/state-of-free-hosting). The official pricing page does not show one.
- **Fly.io:** new orgs get a free trial of up to **2 hours of Machine runtime or 7 days**, whichever first, with no card. Orgs on plans discontinued in October 2024 keep their legacy free allowances. Post-trial freebies are only 10 GB snapshot storage, 10 certs, inbound transfer and shared IPs — [Fly.io docs: pricing](https://docs.fly.io/about/pricing). Trial machines stop after 5 minutes running — [agentdeals #2182](https://github.com/robhunter/agentdeals/issues/2182)
- **Railway:** 30-day trial with a one-time $5 credit (1 GB RAM, shared vCPU, 5 services/project), then the Free plan at **$1 credit/month**, no rollover. Unverified accounts get restricted outbound network and ports. Volumes are deleted 30 days after credits run out — [Railway docs: free trial](https://docs.railway.com/reference/pricing/free-trial). Free plan per-service cap 1 vCPU / 0.5 GB — [agentdeals #2182](https://github.com/robhunter/agentdeals/issues/2182)
- **Northflank Developer Sandbox:** 2 free services, 1 free database, 2 free cron jobs, "Always-on compute – no sleeping", on Northflank's managed cloud only. The page did not state exact CPU/RAM or card requirements — [Northflank pricing](https://northflank.com/pricing)
- **Hugging Face Spaces:** "Gradio and Docker Spaces run on compute and require a paid plan to create: PRO for personal accounts, Team or Enterprise for organizations"; only Static Spaces are free.
  - CPU Basic hardware is 2 vCPU / 16 GB / 50 GB non-persistent disk at no hourly cost, but only on a paid plan.
  - Free hardware sleeps when unused.
  - Outbound requests are limited to ports 80, 443 and 8080.
  - Source: [HF docs: Spaces overview](https://huggingface.co/docs/hub/spaces-overview) (fetched 2026-10-03)
- **Deno Deploy (free):** 1M requests/month, 20 GiB egress, 10 apps max, 15 builds/hour — [agentdeals #2182](https://github.com/robhunter/agentdeals/issues/2182) (secondary)

### Inferences
- **Render free** can host a tiny always-sleeping status/webhook endpoint. It cannot run `tsc` on a real repo, Chromium (needs about 0.5-1 GB+), or a 20 MB-bundle Hono API with websockets and cron: there is no cron on free, the instance sleeps, and the cold start is ~1 min. A 750 h/workspace budget is about one always-awake service.
- **Northflank's** 2 always-on free services are the best PaaS fit for a small always-on control-plane process (e.g. a job dispatcher or the cron caller) if the sandbox size is adequate. Size is unverified.
- **Hugging Face.** The previously popular "free 2 vCPU/16 GB Docker Space" loophole is closed. Even when it was open, it targeted ML demos, and every Space is public-URL with sleep.
- **None of these PaaS free tiers** can host workloads 1-4 at stated concurrency.

### Gaps
- Northflank sandbox CPU/RAM per service and card requirement: not shown on pricing page.
- Deno Deploy official limits page not fetched. Deno Deploy also does not run arbitrary Docker/Node-with-shell, so it is irrelevant to workloads 1-4.
- Commercial-use ToS clauses for Render/Northflank free tiers: none found explicitly (Render docs state no commercial restriction).

---

## 5. Self-hosted PaaS on a free VM (Coolify / Dokku / CapRover + Cloudflare Tunnel)

### Takeaway
Technically the cleanest $0 pattern is Oracle A1 + Docker + Coolify (or Dokku/CapRover) + Cloudflare Tunnel. After the June 2026 cut, though, it delivers only ~2 vCPU / 12 GB of shared capacity, and the PaaS layer eats some of that.

### Cited Findings
- Coolify is open-source and self-hostable for free (you pay only for the server). It runs as Docker containers, supports ARM64, documents Oracle Cloud free ARM port setup, and integrates with Cloudflare Tunnels with per-app subdomains through one tunnel — [Coolify docs](https://coolify.io/docs/get-started/installation); [Coolify firewall docs](https://coolify.io/docs/knowledge-base/server/firewall); [selfhostyourself guide](https://selfhostyourself.com/guides/how-to-self-host-coolify)
- Oracle A1 now provides 2 OCPU / 12 GB / 200 GB disk / 10 TB egress free — [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Inferences
- **Suggested split of 12 GB**, as one way to divide it:
  - Coolify/Traefik plus OS: ~1.5 GB
  - API (Hono/Node): ~0.5-1 GB
  - 1 Playwright QA + 1 stage sandbox: ~2 GB
  - 2-3 coding agents: ~6-7 GB
  - CPU (2 cores) is the binding constraint. Concurrent builds will queue.
- **Dokku** has less overhead than Coolify for a git-push model. Neither provides per-tenant sandboxing strength comparable to Cloudflare Containers (VM isolation). Running untrusted user repos in plain Docker on the same host as the API is a security concern; use gVisor or a separate VM.
- **Splitting across two A1 instances** (1 OCPU / 6 GB each) gives blast-radius separation (API vs. untrusted agent workloads) within the free limit.

### Gaps
- Coolify/Dokku/CapRover baseline RAM overhead not sourced.
- Cloudflare Tunnel free-plan terms (websockets, connection limits, ToS on non-HTML content) not fetched here.

---

## 6. Time-limited credits / trials (do NOT count as $0 forever)

### Takeaway
Sandbox-specialist vendors give credits, mostly one-time. **Modal's $30/month recurring Starter credit** is the only one that functions like a perpetual free allowance. It is large enough for real agent runs: about 760 core-hours/month at sandbox CPU rates, ignoring memory.

### Cited Findings
- **Modal Starter:** $30/month free credits (recurring). Sandbox pricing CPU $0.00003942/core/s, memory $0.00000667/GiB/s. Starter concurrency limit 100 containers + 10 GPU — [Modal pricing](https://modal.com/pricing) (fetched 2026-10-03)
- **E2B Hobby:** no monthly fee, **$100 one-time credits**, up to 20 concurrent sandboxes, sessions up to **1 hour**, 10 GiB storage. Rates $0.000014/vCPU-s and $0.0000045/GiB-s. Pro is $150/month (100 concurrent, 24 h sessions) — [E2B pricing](https://e2b.dev/pricing)
- **Daytona:** $200 free compute on signup, no card. Pay-as-you-go vCPU $0.0504/h, memory $0.0162/GiB-h, first 5 GB storage free. Startup program up to $50k — [costbench](https://costbench.com/software/ai-code-execution/daytona/); [devtune](https://devtune.ai/verticals/ai-code-sandboxes-agent-runtimes/daytona/pricing) (aggregators). One aggregator claims "Daytona has been closed since June 2026" — [devtoollab via search summary](https://devtoollab.com/blog/best-ai-code-execution-sandboxes). **This is unverified and contradicted by other 2026 pricing pages; treat with suspicion.**
- **Fly.io trial:** 2 machine-hours or 7 days — [Fly docs](https://docs.fly.io/about/pricing)
- **Railway trial:** $5 / 30 days — [Railway docs](https://docs.railway.com/reference/pricing/free-trial)
- **GCP:** $300 / 90 days — [GCP docs](https://docs.cloud.google.com/free/docs/free-cloud-features)
- **AWS:** up to $200 / 6 months (accounts after 2025-07-15) — [AWS](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/)

### Inferences
- **Modal monthly budget.** At Modal sandbox rates, a 2-core / 4 GiB sandbox costs about 2 x 0.00003942 + 4 x 0.00000667 = $0.000105/s, or about $0.38/hour. $30/month buys about 79 sandbox-hours, roughly 300 x 15-min agent runs, with up to 100 concurrent containers.
- **Modal vs. Oracle.** By burst capacity, Modal is the strongest "$0 ongoing" option for workloads 1-3 (agent, Playwright, stage sandbox), well above Oracle's 2 cores. Caveats: the credit is a plan perk that Modal can change, it is not a hard free tier, and a card is likely required (unverified).
- **E2B's 1-hour session cap** fits agent runs (minutes to tens of minutes) but not pinned preview servers.

### Gaps
- Whether Modal Starter requires a card, and whether the $30 credit is guaranteed long-term: not verified.
- Daytona's operating status as of Oct 2026: conflicting/unverified.

---

## Summary comparison table (for the report writer)

| Option | $0 forever? | CPU / RAM | Always-on? | Docker / shell / long jobs | Egress | Fits workloads |
|---|---|---|---|---|---|---|
| Oracle A1 Always Free | Yes (policy can change; cut 2026-06-15) | 2 OCPU / 12 GB total (was 4/24) + 2x E2.1.Micro 1 GB | Yes; reclaim if <20% CPU/net/mem p95 over 7 days | Full VM, root, Docker | 10 TB/mo | 1-5 at low concurrency (~2-4 agents or ~3 browsers) |
| GCP e2-micro | Yes | e2-micro (~1 GB) | Yes | Full VM | 1 GB/mo NA | Cron/proxy only |
| GCP Cloud Run | Yes (free tier) | 180k vCPU-s + 360k GiB-s/mo, 2M req | Scale to zero | Containers, request-scoped | 1 GB/mo NA | API at low traffic; ~200 x 15-min jobs |
| AWS | No (credits/6 mo for new accounts) | — | — | — | — | — |
| Azure | Only with PAYG account (per Azure page) | B1s / B2pts v2 / B2ats v2, 750 h each | Yes | Full VM | — | Cron/proxy only |
| GitHub Actions | Yes | Hosted runners; unlimited on public, 2,000 min private | Job-scoped | Shell, Docker, per-job | — | Agent/QA as jobs (private minutes cap) |
| Codespaces | Personal only | 120 core-h/mo | No | Dev env | — | Not for SaaS |
| Render free | Yes | 512 MB / 0.1 CPU, 750 h/workspace | Sleeps after 15 min, ~1 min cold start | Docker, no shell/disk/cron | Bandwidth counted | Tiny endpoint only |
| Northflank sandbox | Yes | 2 services (size unverified) | Always-on | Containers | — | Small control-plane |
| Koyeb | No (since Feb 2026) | — | — | — | — | — |
| Fly.io | No (trial 2 h / 7 days) | — | — | — | — | — |
| Railway | $1/mo credit | 1 vCPU / 0.5 GB per service | Pauses when credit gone | Containers | $0.05/GB | Negligible |
| HF Spaces | Docker/Gradio no longer free (paid plan required) | 2 vCPU / 16 GB if paid plan | Sleeps | Docker | — | — |
| Modal | $30/mo recurring credit (plan perk) | Per-second; 100 concurrent containers | Scale to zero | Sandboxes, long jobs | — | 1-3 bursty (~79 h of 2c/4G) |
| E2B | $100 one-time | 20 concurrent, 1 h cap | — | Sandboxes | — | Trial only |
| Daytona | $200 one-time (status disputed) | — | — | Sandboxes | — | Trial only |
