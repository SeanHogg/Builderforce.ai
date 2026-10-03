# Zero-cost Postgres-compatible database hosting (replacing Neon) — as of 2026-10-03

All official pages below were retrieved 2026-10-03 unless noted. "Official" = vendor's own pricing/docs page. Third-party claims are labelled.

## Q1. Free-tier limits per candidate (storage, compute, connections, pausing, backups, extensions, driver, commercial use, egress)

### Takeaway
Only a handful of managed services are still genuinely $0-forever in Oct 2026: Neon Free, Supabase Free, Prisma Postgres Free, Nile Free, Aiven Free, and Koyeb (5 active hours only). Xata, Tembo, CockroachDB (for new orgs), Render and Railway are effectively out as $0 production Postgres. Self-hosting on Oracle Always Free remains possible but Oracle halved the Ampere A1 allowance in 2026.

### Cited Findings

**Neon Free (current host)**
- Free plan: storage "1 GB/project, 20 GB account total" (limits enforced independently); 100 projects; 100 CU-hours/project/month; autoscale up to 2 CU (8 GB RAM); 5 GB public egress per project; 10 branches/project; 6-hour instant-restore window (1 GB-month of changes cap); 1 manual snapshot; scale-to-zero after 5 min, cannot be disabled — [Neon plans docs](https://neon.com/docs/introduction/plans); [Neon pricing](https://neon.com/pricing)
- Overage behaviour: compute is "suspended until the next billing period or until you upgrade"; when storage is exceeded, inserts/updates/deletes "fail until you free space or upgrade" — [Neon plans docs](https://neon.com/docs/introduction/plans)
- CONFLICT: both official Neon pages fetched today state **1 GB/project**, but third-party trackers and the operator's own notes say **0.5 GB/project**. Third-party says the Jan 15, 2026 repricing (post-Databricks) made storage per-project, raised projects 10→100, capped branches at 10, and before that Free was 0.5 GB total / 191.9 compute-hours / 10 projects — [agentdeals.dev (third-party)](https://agentdeals.dev/vendor/neon); [costbench (third-party)](https://costbench.com/software/database-as-service/neon/free-plan). Treat 1 GB/project as current per official page, but verify in the Neon console for the existing org before relying on it.
- Free plan described as "for prototypes, side projects, and small teams"; no explicit ban on commercial use found on the pricing page — [Neon pricing](https://neon.com/pricing)

**Supabase Free**
- 500 MB database size per project, shared CPU, 500 MB RAM ("Nano"), 1 GB file storage, 50,000 MAU, 5 GB egress + 5 GB cached egress, max 2 active projects, "paused after 1 week of inactivity", automatic backups "Not included", community support only — [Supabase pricing](https://supabase.com/pricing)
- Paused projects don't count towards the 2-free-project limit — [Supabase billing docs](https://supabase.com/docs/guides/platform/billing-on-supabase)
- Nano: 60 direct connections, 200 pooler clients; baseline disk throughput 5 MB/s, baseline 250 IOPS (burst 11,800); "Compute resources on the Free plan are subject to change" — [Supabase compute & disk docs](https://supabase.com/docs/guides/platform/compute-and-disk)
- "Free Plan projects enter read-only mode when your database size exceeds 500 MB." — [Supabase database size docs](https://supabase.com/docs/guides/platform/database-size)

**Prisma Postgres Free**
- 50 databases, 500 MB storage, 200,000 operations/month, unlimited data transfer, 10 pooled + 10 direct connections, 60-min idle timeout, no daily backups (backups start on Starter with 7-day retention), "no time limit", "no credit card required" — [Prisma pricing](https://www.prisma.io/pricing)
- Supports pgvector, pg_trgm, pgcrypto among "over 40 supported extensions" — [Prisma Postgres extensions docs](https://www.prisma.io/docs/postgres/database/postgres-extensions)

**Nile Free**
- Unlimited databases and tenant DBs, 1 GB storage included, 50 million "query tokens" compute, unlimited vector embeddings, 500 max connections; positioned for "prototyping or side projects" — [Nile pricing](https://www.thenile.dev/pricing)

**Aiven Free PostgreSQL**
- 1 dedicated VM, 1 CPU, 1 GB RAM, 1 GB total storage, single backup for DR only, cannot pick cloud/region, "No integrations or connection pooling" — [Aiven pricing](https://aiven.io/pricing?product=pg)
- "Free plans do not have any time limitations. However, Aiven reserves the right to shut down services if we believe they violate the acceptable use policy or are unused for an extended period of time." — [Aiven pricing](https://aiven.io/pricing?product=pg)

**Koyeb Postgres (free)**
- 1 GB storage, 0.25 vCPU / 1 GB RAM, "Free 5h" of active compute time; Koyeb "is joining Mistral AI" — [Koyeb pricing](https://www.koyeb.com/pricing)

**CockroachDB**
- **Changed Sept 15, 2026**: "Cockroach Continuum" pricing — new Cloud orgs get "a 30-day free trial with $400 in credit"; existing customers keep current plans — [Cockroach Labs pricing](https://www.cockroachlabs.com/pricing/)
- Third-party: the Basic tier with ~$15/month free usage is no longer offered to new orgs; Standard starts at $0.092/vCPU-hour (~$203/mo for 2 vCPU/100 GB) — [devtoolpicks (third-party)](https://devtoolpicks.com/blog/best-cockroachdb-alternatives-indie-hackers-2026)
- Feature-wise: `VECTOR` type "compatible with the pgvector extension"; vector indexes need `SET CLUSTER SETTING feature.vector_index.enabled = true`; no L1/Hamming/Jaccard operators; `IMPORT INTO` unsupported on tables with vector indexes; filtered index acceleration only on prefix columns — [CockroachDB vector indexes](https://docs.cockroachlabs.com/docs/stable/vector-indexes)
- Trigram indexes, `%`, `similarity()`, `show_trgm()` supported natively — [CockroachDB trigram indexes](https://docs.cockroachlabs.com/docs/stable/trigram-indexes)

**Xata**
- No permanent free cloud tier: Xata Cloud is a "14-day free trial", then pay-as-you-go; open-source self-host is free — [Xata pricing](https://xata.io/pricing)

**Tembo**
- Tembo Cloud sunset: instance creation disabled May 5, 2025; free-instance migration deadline May 30, 2025; paid June 27, 2025 — [Tembo Cloud Sunset Guide](https://tembo-io.notion.site/Tembo-Cloud-Sunset-Guide-1de7c9367d6a80349570e7469ba7f17b); [Neon migrate-from-Tembo guide](https://neon.com/guides/migrate-tembo-to-neon)

**Render Free Postgres**
- 1 GB; only one free DB per workspace; expires 30 days after creation, 14-day grace, then permanently deleted; no backups; no connection pooling; maintenance anytime without notice — [Render free docs](https://render.com/docs/free)
- Render free web services: spin down after 15 min idle, ~1 min spin-up, 750 instance-hours/workspace/month, ephemeral FS — [Render free docs](https://render.com/docs/free)

**Railway**
- Free trial: $5 one-time credit (30 days). Permanent "Free" plan: $1/month credit, 0.5 GB RAM per service, 500 MB max volume, 1 replica — [Railway pricing](https://railway.com/pricing)

**Google Cloud**
- No always-free Cloud SQL or AlloyDB. Cloud SQL: 30-day free trial instance; AlloyDB: 30-day trial cluster (8 vCPU, 1 TB). (Trials — excluded.) — [GCP free features](https://docs.cloud.google.com/free/docs/free-cloud-features)
- Always Free e2-micro: 1 non-preemptible e2-micro in us-west1, us-central1 or us-east1; 30 GB-months standard persistent disk; 1 GB/month egress from North America — [GCP free features](https://docs.cloud.google.com/free/docs/free-cloud-features)

**Oracle Cloud Always Free (self-host Postgres on a VM)**
- Ampere A1: 1,500 OCPU-hours + 9,000 GB-hours/month = **2 OCPU / 12 GB RAM**; 200 GB total block storage (boot + block, min boot 47 GB), 5 volume backups; 2 AMD E2.1.Micro (1/8 OCPU, 1 GB RAM, 50 Mbps); 10 TB/month outbound; home region only — [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)
- Idle reclamation: instance reclaimed if over 7 days the 95th-pct CPU <20%, network <20%, and (A1 only) memory <20% — [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)
- **Changed 2026**: A1 cut from 4 OCPU/24 GB (3,000 OCPU-h + 18,000 GB-h) to 2 OCPU/12 GB; effective June 15, 2026, enforcement from Aug 18, 2026 with automatic termination of over-limit instances; no announcement, only docs update — [InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/); [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/). (The brief's "4 OCPU/24 GB" is now out of date.)

**Turso / libSQL (SQLite, comparison only)**
- Free: 100 databases, 5 GB storage, 500M rows read/month, 10M rows written/month, community support, no card. PITR only from Developer ($4.99/mo, 10-day) — [Turso pricing](https://turso.tech/pricing)

**Edge connectivity: Cloudflare Hyperdrive**
- Hyperdrive is available on Workers Free; limit 100,000 database queries/day (page last updated June 18, 2026) — [Cloudflare Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)

### Inferences
- Hyperdrive on Workers Free makes almost any TCP-reachable Postgres (Supabase, Aiven, Nile, Prisma direct, a self-hosted Oracle VM) reachable from Workers, so the Neon HTTP driver is no longer a hard requirement — but 100k queries/day (~3M/month) is a ceiling to check against current traffic.
- Prisma Postgres's 200k operations/month is far too low for a 5-minute cron plus API traffic (8,640 cron runs/month alone, each likely many queries).
- Neon's scale-to-zero at 5 min plus a cron every 5 min means the compute effectively never sleeps: 0.25 CU × ~730 h ≈ 182 CU-h/month per project, above the 100 CU-h/project cap. To stay on Neon Free the cron must run less often (or on a different project/DB than the user-facing one).
- Aiven Free (1 GB, 1 GB RAM, no pooler) is the managed option with the most storage headroom that also says "no time limitations", but "unused for an extended period" and no region choice are risks; it needs Hyperdrive for Workers access.

### Gaps
- Could not confirm on an official page whether Neon Free is 0.5 GB or 1 GB per project (official pages say 1 GB; third parties and operator say 0.5 GB). No dated changelog entry found.
- Supabase's pause rule (7 days) is from the pricing page; the dedicated pausing doc URL returned 404, so the restore window for paused projects (historically 90 days) was not confirmed.
- Supabase Free egress/edge-driver behaviour for Workers (supabase-js over HTTP/PostgREST vs Hyperdrive) not checked in detail.
- Nile: pg_trgm/pgcrypto support, backup policy and commercial-use terms not confirmed on an official page; meaning of "query tokens" not defined.
- Aiven Free: pgvector/pg_trgm/pgcrypto availability and connection limit not confirmed on the free-plan page (Aiven PG generally lists these extensions, not verified here).
- Koyeb: extension list and whether the "5h" is per month not verified; future after Mistral acquisition unclear.
- CockroachDB: pgcrypto support not verified; Basic free tier details for existing orgs not shown on the new page.
- Prisma Postgres: edge/HTTP driver (e.g. for Cloudflare Workers) not confirmed in the docs fetched.
- Terms-of-service text on commercial use was not fetched for any vendor; statements above are from pricing-page wording only.

## Q2. Which options can hold ~1 GB with pgvector at $0 for production commercial use?

### Takeaway
After the planned move of logs/blobs out (~200 MB core), Neon Free, Supabase Free, Nile Free, Aiven Free and a self-hosted Oracle A1 VM can all hold the data at $0. At ~1 GB, only Neon (if 1 GB/project is real, and data is split across projects), Nile (1 GB), Aiven (1 GB total, tight) and self-hosting on Oracle (200 GB disk) fit; Supabase (500 MB → read-only) and Prisma (500 MB) do not.

### Cited Findings
- Neon: 1 GB/project, 20 GB account, 100 projects; 100 CU-h per project; scale-to-zero after 5 min — [Neon plans docs](https://neon.com/docs/introduction/plans)
- Supabase: 500 MB then read-only; no backups; pause after 1 week inactivity — [Supabase database size docs](https://supabase.com/docs/guides/platform/database-size); [Supabase pricing](https://supabase.com/pricing)
- Prisma Postgres: 500 MB, 200k ops/month, no backups — [Prisma pricing](https://www.prisma.io/pricing)
- Nile: 1 GB, 50M query tokens, unlimited vectors — [Nile pricing](https://www.thenile.dev/pricing)
- Aiven: 1 GB total storage, single DR backup, may be shut down if "unused for an extended period" — [Aiven pricing](https://aiven.io/pricing?product=pg)
- Oracle A1: 2 OCPU/12 GB, 200 GB block, 10 TB egress, 5 volume backups, idle reclamation <20% thresholds — [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)
- GCP e2-micro: 30 GB disk but only 1 GB/month NA egress — [GCP free features](https://docs.cloud.google.com/free/docs/free-cloud-features)
- Render free Postgres deleted after 30 + 14 days; Railway Free volume 500 MB — [Render free docs](https://render.com/docs/free); [Railway pricing](https://railway.com/pricing)

### Inferences
- **Best managed fit: stay on Neon Free, restructured.** With 1 GB/project and 100 projects, the core (~200 MB after cleanup) fits easily; the main risk is the 100 CU-h/project compute cap, which requires the 5-min cron to stop keeping compute awake (e.g. gate it harder or run it against a separate project). Operational behaviour is unchanged (same driver, same extensions). Caveat: only 6 h restore window; storage overage blocks writes; compute exhaustion suspends the DB until month end — a hard outage risk for production.
- **Self-host on Oracle A1** gives the most headroom (12 GB RAM, 200 GB disk, any extension, PITR via your own WAL archiving), reachable from Workers via Hyperdrive. Caveats: single VM, no managed HA; you own backups/patching; Oracle cut A1 allowance in 2026 without notice (it could change again); idle reclamation needs CPU/network/memory over 20% p95 (a Postgres with a big shared_buffers may satisfy the memory rule); capacity in popular home regions is often scarce; account must stay in good standing.
- **Supabase Free** works for ≤500 MB but is weak for production: no backups, read-only above 500 MB, weekly-inactivity pause (a 5-min cron probably counts as activity, unverified), and free compute "subject to change".
- **Nile / Aiven** are plausible 1 GB holders but each has unverified extension/backup/commercial-use details; Aiven's lack of pooling and single backup and Nile's "side projects" positioning make them riskier as a production primary.
- Combination worth considering: logs/telemetry (append-only) to a separate free store (e.g. a second Neon project, Turso, or Cloudflare R2/D1) so that core stays well under any 500 MB–1 GB cap.
- Durability across all $0 managed options is weak (no or minimal backups, no SLA); independent of the choice, a scheduled `pg_dump` to object storage (e.g. Cloudflare R2 free tier) is the cheap mitigation.

### Gaps
- No vendor free tier offers an SLA; I found no official uptime commitments for any free plan.
- Exact current Neon CU-hour usage per project (235 CU-h is across all projects?) unknown — determines whether a per-project split fits under 100 CU-h each.

## Q3. Changes in 2025–2026 and time-limited trials (not $0)

### Takeaway
2025–2026 saw a contraction of free Postgres: Tembo Cloud shut down (2025), CockroachDB ended its free Basic tier for new orgs (Sept 2026), Oracle halved Always Free ARM (June/Aug 2026), while Neon restructured to per-project limits (Jan 2026, per third-party).

### Cited Findings
- Tembo Cloud sunset, May–June 2025 — [Tembo Sunset Guide](https://tembo-io.notion.site/Tembo-Cloud-Sunset-Guide-1de7c9367d6a80349570e7469ba7f17b)
- CockroachDB Continuum, Sept 15, 2026: new orgs get a 30-day trial with $400 credit — [Cockroach Labs pricing](https://www.cockroachlabs.com/pricing/)
- Oracle A1 4 OCPU/24 GB → 2 OCPU/12 GB, effective June 15, 2026, enforced Aug 18, 2026 — [InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/); [Oracle docs (current numbers)](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)
- Neon repricing Jan 15, 2026 (third-party): projects 10→100, per-project storage, 10-branch cap — [agentdeals.dev](https://agentdeals.dev/vendor/neon)
- Koyeb joining Mistral AI — [Koyeb pricing](https://www.koyeb.com/pricing)
- Trials only (not $0): Xata Cloud 14-day trial — [Xata pricing](https://xata.io/pricing); Railway $5 / 30 days — [Railway pricing](https://railway.com/pricing); GCP Cloud SQL / AlloyDB 30-day trials — [GCP free features](https://docs.cloud.google.com/free/docs/free-cloud-features); CockroachDB 30-day $400 — [Cockroach Labs pricing](https://www.cockroachlabs.com/pricing/); Render free Postgres effectively a 30-day DB — [Render free docs](https://render.com/docs/free); AWS RDS free tier is 12 months only (per brief; not re-verified).

### Inferences
- The trend means any $0 choice should be paired with an exit plan (portable plain Postgres + dumps), since free tiers changed with little or no notice in 2026 (Oracle especially).

### Gaps
- Did not verify AWS free-tier changes (AWS moved to a credits-based free plan in 2025 per general knowledge; not sourced here).
- Did not find an official Neon changelog entry confirming the Jan 2026 change date.
