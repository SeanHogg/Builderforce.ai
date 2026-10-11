# PRD 33 — Session replay, heatmaps and live visitors

> **Status:** planned 2026-10-10. Not built.
> **Owner:** the planning session (Opus), which also audits each slice.
> **Implementation hand-off:** [33a-session-replay-implementation.md](./33a-session-replay-implementation.md). It is the brief an implementing agent works from, and it carries the verification brief and the audit checklist.
> **Mockup:** https://claude.ai/artifact/ThFJoMFxQ8hguwVJWV82Ea (five artboards). Read it for layout only. Where this PRD and the mockup disagree, this PRD wins.
> **Arc:** Measure. The feature is what turns a live app (Run) into evidence about what to change (Measure → back to Make).

## 0. The problem, stated against the code

Builderforce cannot see what a visitor does on a page. The code does record that a visitor arrived, which pages they opened, what they typed into the composer, whether something broke and whether they signed up:
- `lib/visitorJourney.ts` → `POST /api/visitor/events` → `activity_log`, read back by `VisitorFlowPanel` and `GuestSessionsPanel`.

But the code has nothing for any of these:
- where on the page the visitor clicked;
- what they clicked that did nothing;
- what they clicked repeatedly in frustration;
- how far they scrolled;
- what the page looked like when they gave up.

Nothing ties a behaviour to the release the visitor was on either. The admin shows numbers like "280 visitors stopped at /pricing" but cannot show *why*.

Customers who publish an app from a canvas have the same gap, worse: `site_traffic_daily` counts page views, and that is all.

Four things already exist and must be extended, not duplicated:

| Existing | What it is today | What it becomes |
|---|---|---|
| `GuestSessionsPanel` (Admin ▸ Users ▸ sessions) and `VisitorFlowPanel` (Admin ▸ Growth ▸ visitorFlow) | Two panels over the same anonymous funnel, both keyed on `bf_visitor_id`, each with its own copy of the same stat tile and its own visitor drawer | ONE Growth ▸ **Visitors** destination with six views: **Fixes** (home) · Overview · Replays (recordings + heatmap) · Journeys (funnels + flow + events) · Live · Leads (platform only). It has ONE visitor panel |
| `lib/qa/telemetry.ts` `deriveSelector` + `QaHeatmapService` | Element-level click capture and a (route, selector) ranking, for authenticated QA sessions only | The ONE selector derivation and ONE zone-ranking rule, shared with the recorder |
| `QualityErrorReporter` → `qualityIngestRoutes.ts` | Already writes `visitor.error` into the visitor stream | The source of every error marker in a replay |
| `writeAdminAudit` | Admin audit trail | Records every replay a superadmin opens |

## 1. Outcome

**The point of the feature is to tell people how to improve their website, render the improvement, hand it to an AI as a prompt, and measure the result** (operator direction 2026-10-10: "the fixes has to be the key aspect … all of the data and tracking isn't meaningful unless you can tell them how to improve their website").
- **Fixes lead the home** of the Insights app (D16) for every site, Builderforce's own included (D17).
- Everything else (recordings, heatmaps, funnels, flow, live, overview) is **evidence**, reached from a fix or browsed below it.
- Each fix is built from four inputs about a page:
  - **the screen:** a captured screenshot per device and release, read by a vision model;
  - **behaviour metrics:** replay;
  - **SEO:** on-page facts, plus Search Console when connected;
  - **the content:** copy, structure and readability.
- Each fix has four outputs:
  - **a rendered visual improvement:** the page as it is, with numbered callouts, beside the page as it would be;
  - **guidance written as a prompt:** for the ONE canvas composer, an agent, or any AI coding tool;
  - **one-click application:** where Builderforce can apply it;
  - **a measured verdict:** on the release that ships it.

The rest of this section lists what each audience gets. The page review is D14 / §2.4 / S4f; prescriptions are D13 / §2.3 / S4e.

1. **Superadmin, on builderforce.ai.** The superadmin opens Admin ▸ Growth ▸ Insights and does five things:
   - Picks any visit and replays it, with:
     - the cursor;
     - clicks, rage clicks and dead clicks;
     - scrolling;
     - page changes;
     - errors on a timeline;
     - the release it ran on (`UI <frontend version> · API <api version>`).
   - Sees click, scroll and attention heatmaps per page, with this release next to the last one.
   - Sees which buttons and links get clicked, and which elements get clicked although they are not clickable.
   - Watches who is on the site right now, about 5 seconds behind.
   - Follows the flow graph from any step straight to the recordings behind it.

   Only a superadmin sees builderforce.ai's recordings.
2. **Any workspace, through the Marketplace.**
   - **Buy.** A workspace installs "Session Replay & Heatmaps" (5,000 recordings a month free). Above that, it buys prepaid recording packs with a real card. Every step is traced.
   - **Install once.** On a site hosted outside Builderforce, the buyer pastes one loader tag and never touches it again: recorder updates arrive by themselves and releases are detected automatically. A Builderforce-hosted app needs no tag, just a switch.
   - **Review.** In the canvas, under Measure ▸ Visitors, the buyer reviews recordings in the same player and heatmaps the superadmin uses. Only that workspace's owners and admins can watch them.
3. **At least Clarity's analysis, on every scope** (D11, slice S4c). Both the superadmin and every buyer get:
   - an **Overview** dashboard: sessions, pages per session, active time, scroll depth, frustration rates, and top pages, devices, countries and referrers;
   - a **filter bar** with saved **segments** that apply to the whole screen and every panel alike;
   - **frustration signals**: rage clicks, dead clicks, quick backs, excessive scrolling and JS errors, on the timeline, in filters and in the Overview;
   - **funnels** over pages, clicks and **smart events**: built-in events detected automatically, custom events from `BFReplay.event()`, and point-and-click definitions that apply retroactively;
   - **AI summaries**: one recording ("what happened, where it went wrong"), or a whole segment ("the three patterns behind these 40 drop-offs"), each with links to the exact moments. The canvas Brain can also answer questions over the same numbers.
4. **The method runs on it** (D12, slice S4d). Replay is the instrument of Measure, the stage where the Idea → Make → Run → Measure arc closes back to Idea (`LOOP_CLOSES_IN = 'measure'` in `lib/methodology.ts`):
   - **Proofs are graded by what visitors actually did.** Every live proof (smoke test, wizard of oz, POC, pilot, phone line, live system) is recorded from its first visit, with no install. Its kill condition, written in the charter before traffic arrives, becomes a measured rule:
     - **sample:** visits from the named source;
     - **success:** a smart event or funnel step;
     - **threshold.**

     The platform reports the verdict from those numbers. It refuses to call `met` before the sample is reached.
   - **Every grade carries its evidence.** The `proof.grade` row in the outcome ledger records the measured numbers, the release they ran on, and the recordings and AI patterns behind a miss.
   - **The loop closes.** A graded proof offers "Read again with what we learned", and the next Read starts from that evidence.
   - **Every Make iteration is measured.** A ticket raised from a replay moment shows the same metric on the release that shipped the fix.
   - **The journey knows Make and Measure.** A proof that is collecting its sample, or was graded recently, places the founder in Measure. One built but not yet live places them in Make.
   - **Dogfood: the method is itself a funnel.** On builderforce.ai the four method acts (`idea.read`, `proof.choose`, `proof.build`, `proof.grade`) are smart events. The superadmin sees where people drop out of the method, and watches why.
5. **Prescriptive AI: it tells you what to change, does it, and proves it worked** (D13, slice S4e). Every scope gets a **Fixes** view: a ranked list of prescriptions. Each prescription has five parts:
   - **the finding**, detected deterministically from replay, with cited recordings;
   - **the prescription**, a specific change: this element, this page, this copy, this step, or this follow-up;
   - **the expected impact**, estimated from the site's own data ("+38 sign-ups a month, range 22–51"), with the confidence its sample supports;
   - **one action**:
     - **Fix it:** an agent drafts the change as a preview release;
     - **Test it:** an A/B test on the existing `ab_tests` engine, with its stopping rule;
     - **Follow up:** a sales sequence, or a broadcast to the visitors and leads it concerns;
     - **Ticket:** a ticket with the brief;
   - **a verdict**. After the change ships, the same metric is measured on the new release (or variant) and the prescription is marked *worked*, *no effect* or *worse*. A worse result offers a revert.

   Prescriptions cover four areas:

   | Area | Example |
   |---|---|
   | **Funnel** | "Step 2 → 3 loses 70%. 94% of the drop rage-clicks Pro 'Start free'. Fix the planId error first." |
   | **UI/UX** | "'Pro' headings take 312 dead clicks. Make the whole plan card the link." |
   | **The website** | "TypeError reading 'planId' in PricingCta.tsx:42 on 2026.10.35 in 91% of the dropped visits." |
   | **Sales** | "14 visitors opened pricing 3+ times this week and left at the price. Enrol them in the 'pricing questions' sequence." "Add the shipping cost to the product page and to the sales FAQ." |

   Builderforce gets the same for builderforce.ai's funnels, including "The method", through its own install of the app (D17).
6. **Privacy by default.**
   - Every input is masked in the browser before anything is sent.
   - Password and card fields are never captured.
   - Do Not Track and Global Privacy Control are honoured.
   - builderforce.ai records only after analytics consent.
   - Deleting a visitor deletes their recordings.
   - Recordings expire after the retention period.

## 2. Decisions

Each decision below has a default. The operator can override a default before the slice that depends on it starts. An implementing agent never changes a decision; if one turns out wrong, the agent stops and reports to the planning session.

| # | Decision | Default | Gates slice |
|---|---|---|---|
| D1 | Recorder engine | **rrweb** (MIT). Battle-tested DOM serialisation and replay. Writing our own is months of edge cases. Pin the exact version. | S2 |
| D2 | Where recordings live | **R2 (`UPLOADS`) gzip NDJSON chunks** under `replay/`. Visit index and aggregates live in the **transactional** database (`buildTransactionalDatabase`), never in core (core is held under Neon Free; see ROADMAP). *Amended by D15: only kept recordings are stored; events go to Analytics Engine and the event lake (§3.3).* | S1 |
| D3 | Retention | **30 days** on every recording. builderforce.ai keeps **90 days**, matching `VISITOR_RETENTION_DAYS`. Data, not code: `REPLAY_RETENTION_DAYS` per scope. | S1 |
| D4 | Pricing: usage-based, on data consumed (operator direction 2026-10-10) | **Billable unit: one recording.** A recording is one visit, up to **2 MB** of compressed data; each further 2 MB counts as another recording. Bytes are always metered, so a heavy session costs what it consumes. **Every workspace that installs the capability gets 5,000 recordings free each month**, which matches PostHog's free tier. Above that, the workspace spends **prepaid recording credits**, sold as packs at a step-down rate set about 20% under PostHog's web replay ladder. The pack prices below are the default; the operator can change the data before S6. | S6 |
|  | Pack ladder (one-off payments; credits last 12 months) | 10k recordings **$40** ($0.0040 each) · 50k **$140** ($0.0028) · 150k **$240** ($0.0016) · 500k **$650** ($0.0013) · 1M **$1,200** ($0.0012). For comparison: PostHog is $0.0050 → $0.0015 per recording after 5k free; Hotjar Observe is $39/mo for 100 sessions a day (~3k/mo); LogRocket is $69/mo for 10k; Microsoft Clarity is free. Our cost is roughly $0.0002 per recording (R2 storage + writes + Worker requests), so even the largest pack keeps a healthy margin. | S6 |
|  | Why prepaid packs, not a metered subscription | The payment rails already support one-off payments (`ONE_OFF_SETTLERS`, already used for Spawn token packs and comms top-ups). A pack is a real payment the moment it is bought, so the purchase can be validated live. There is no Stripe usage-reporting plumbing and no month-end invoice surprise. Credits live in `ledger_entries` under their own denomination, and the existing consumption meter shows usage the same way it enforces it. An auto-recharge option (buy the same pack again at 10% remaining) is part of S6. | S6 |
| D5 | Where scripts are served: **a real CDN** | **`https://cdn.builderforce.ai`**, served by a public R2 bucket `builderforce-cdn` on a custom domain. Cloudflare's edge caches it, and serving it invokes no Worker. **Required:** an explicit no-Worker route for `cdn.builderforce.ai/*`, so the `*.builderforce.ai/*` wildcard Worker route does not capture it. File layout:<br>• `/replay/v1/loader.js` (`Cache-Control: public, max-age=300`)<br>• `/replay/r/recorder.<hash>.js` (`public, max-age=31536000, immutable`)<br>• `/replay/manifest.json` (`max-age=60`)<br><br>The release workflow uploads the files with their cache headers. The same CDN fixes an existing broken reference: `unifiedEmbedSnippet()` already emits `https://cdn.builderforce.ai/embed/v1.js`, which nothing serves. Config and ingest stay on the API (`https://api.builderforce.ai/api/replay-ingest/*`). | S2 |
| D6 | Liveness | **Polling, ~5 s.** The recorder flushes every 5 s while the tab is visible. Live view and live player poll cached endpoints. No WebSockets in v1. | S5 |
| D7 | Consent | builderforce.ai records only when `CookieConsentManager` reports analytics consent. Buyer sites: a site setting "Wait for consent" (default **off**) plus `BFReplay.consent(true)`. | S2/S3 |
| D9 | Who is recorded on builderforce.ai | **Everyone, signed out and signed in** (operator direction 2026-10-10).<br>• **Signed-in sessions carry the user.** `replay_visits.user_id` and `tenant_id_seen` are set at sign-in, and one visitor's journey continues across sign-in. Admin ▸ Users ▸ a user's detail panel lists that user's recordings.<br>• **Privacy floor for signed-in sessions.** All inputs are masked, as for signed-out visitors. Sensitive regions carry `data-bf-mask`/`data-bf-block`: API keys and secrets, payment and billing fields, connected-account tokens, and the Brain composer. Every view is audited. A superadmin-set per-workspace exclusion (`tenants.settings.replayExcluded`) honours enterprise contracts that forbid recording.<br>• **Gate:** the Privacy Policy and Terms must disclose recording before signed-in recording is switched on. The implementer drafts that new legal version; the operator publishes it through Admin ▸ Compliance ▸ Legal. Until then signed-in recording ships behind a platform setting `replay.recordSignedIn = false`. | S3 |
| D10 | "Video replay of their screen" | **The replay is a pixel-faithful playback of the page as the user saw it**, rebuilt from the recorded page and DOM changes, which is how every competitor does it. It plays like a video: play, seek, speed, skip idle. It is not a camera capture of the operating system: a browser can only capture the real screen through a permission prompt (`getDisplayMedia`) on every visit, which no visitor would accept.<br>• **Canvas and WebGL content** (the 3D Room, drawings, games) is captured as frames: rrweb `recordCanvas` at 2 fps, JPEG quality 0.4. This is on by default for builderforce.ai and a per-site setting for buyers, and the extra bytes count under D4.<br>• **"Export as video"** turns any replay into an **MP4**. A render job plays the replay headlessly with Playwright's video capture, on the agent host or GitHub Actions (the $0 compute paths), and stores the MP4 in R2. The job is metered as 10 recordings per export. | S3, S4 |
| D8 | The real-payment validation | A dedicated **non-superadmin** workspace owned by the operator buys the smallest pack (10k, $40) with a real card. The check covers three things: the credit appears in the ledger, a recording above the free 5,000 debits it, and the refund reverses both. Superadmins are entitled without paying (`evaluateFeatureEntitlement`), so they cannot prove the purchase path. To reach the paid tier without 5,000 real visits, the validation sets the workspace's free allowance to 0 through a superadmin override (`replayFreeAllowanceOverride`). | S8 |

| D11 | The competitive bar (operator direction 2026-10-10: "make sure that we compete") | **Every analysis feature Microsoft Clarity offers on the web ships for every site before S8.** The exceptions are listed in §2.1 with their reason. On top of that we ship what Clarity structurally cannot. The full matrix is in §2.1, and the planning session's S8 audit checks every row. | S4c, S8 |

| D12 | The method link (operator direction 2026-10-10: "connect this feature to the methodology") | **Replay is the measuring instrument of the Idea-to-Real method.** The details are in §2.2. Proof sites are recorded with no Marketplace install, and their recordings count toward the workspace's free allowance (D4). That puts replay in front of every founder at the one moment it decides something. The capability listing covers their other sites. | S4d |

| D13 | Prescriptive guidance (operator direction 2026-10-10: "AI being able to provide prescriptive guidance to improve their funnel / fix UI/UX / fix the website / fix sales") | **Findings are deterministic, and the AI writes the prescription and the change.** A rule registry (`PRESCRIPTION_RULES`) detects findings from replay data and estimates their impact with a pure function. The AI only turns a detected, cited finding into a specific prescription and a drafted change. It never invents a finding, and an uncited sentence is dropped, as with summaries (S4c.5). Nothing reaches production on its own: Fix it produces a preview release, Test it needs a person to start the test, and Follow up obeys `salesPolicy.ts`. Every applied prescription is graded on a named metric. The details are in §2.3. *Amended by D14:* a finding may also be **observed by AI from the screen**, but it is shown only when it is anchored to an element in the page capture AND tied to a measured signal on that page (behaviour, SEO, performance or accessibility). It is labelled "observed from the screen". | S4e |
| D15 | Scale: millions of sessions (operator direction 2026-10-10: "your designs won't handle millions of sessions") | **Count everything; keep recordings that matter; group into issues; never browse raw sessions.** The per-visit rows of §3.1 do not survive a million sessions a month on the transactional Postgres (Neon Free): a visit row plus up to 300 mark rows each is hundreds of millions of rows. D15 replaces them with four tiers (§3.3): (1) **Workers Analytics Engine** for hot counters, heat cells and issue counts; (2) **Cloudflare Pipelines → R2 Data Catalog (Iceberg), queried by R2 SQL** as the complete event lake for funnels, flows, segments and search; (3) **small Postgres tables** that grow with routes, issues and kept recordings, never with sessions; (4) **R2 chunks** only for kept recordings. The recorder keeps a recording when it is head-sampled or when a trigger fires (frustration, error, goal, custom tag); the analysis counts every session either way. The product reads as **issues grouped from all sessions, each with representative recordings**, and every number states whether it is exact or estimated. *Amends D2 and D4.* | S1, S2, S4, S4c |
| D16 | One screen, one panel (operator direction 2026-10-10: "users do not scroll down the page … drill-into for more details with a slide out side panel") | **The product is ONE home screen that fits the viewport with nothing below the fold, plus ONE slide-out panel for every detail.** The six views of the earlier design (Fixes, Overview, Replays, Journeys, Live, Leads) are retired as destinations: their content becomes **panel kinds** (§2.5). The home never scrolls; only the panel body scrolls. Panels stack with a breadcrumb (Insights › issue › recording), so a person can go from a number to the recording behind it without leaving the screen. The same home and panel serve Admin ▸ Growth ▸ Insights (panel docked right) and the canvas Measure ▸ Visitors surface (panel docked left, because the Brain is docked right). | S0, S3–S7 |
| D17 | Dogfood = customer #1 (operator direction 2026-10-10: "it's an app that users buy from the marketplace and integrate with a JavaScript snippet … Builderforce itself will ingest the JavaScript") | **Insights is a Marketplace app, and Builderforce uses it exactly as a buyer does.** There is no platform scope, no superadmin-only data path and no unmetered back door. The Builderforce workspace finds Insights on the Marketplace, installs it, creates a site key for builderforce.ai, and builderforce.ai carries the same public snippet as every customer site. Its data goes through the same public ingest, into the same app at `/apps/insights`, under the same metering (the Builderforce workspace holds an audited superadmin credit grant instead of buying packs; the real-card path is proven by a separate workspace, D8). The buyer's whole path is part of the product (§2.6): the landing page, sign-up with the install intent kept, the free licence, site and key, snippet, live verify, plan and packs. Superadmins see Builderforce's own recordings by being members of the Builderforce workspace, like any customer's team; Admin gets only an aggregated **Insights operations** view (sites, ingest volume, errors, revenue), never another workspace's recordings. *Supersedes the platform scope in §3 and D9's platform-only `identify`.* | S0–S8 |
| D14 | The page review: screen + metrics + SEO + content → visual improvement → prompt → measure (operator direction 2026-10-10) | **Every key page of every scope gets a page review per release.** The Agentic Tester container captures it (screenshots at desktop 1440 and phone 390, the DOM outline, SEO facts, content facts, lab performance and accessibility). Field Web Vitals come from the recorder. A vision model reads the screenshot together with the metrics. Each resulting prescription carries a **visual patch** (a narrow, validated vocabulary of DOM/CSS operations) that is rendered onto the captured page as a before/after, and an **improvement prompt** compiled from the prescription. Apply routes into the ONE composer for canvas apps, an agent task or PR for connected repos, or a copyable prompt for any other site. The site's next release is detected automatically and measured. The details are in §2.4. | S4f |

### 2.1 Competitive matrix (Clarity web feature → where we ship it)

Rows marked **beyond** are features Clarity does not have. Clarity facts were taken as of mid-2026; S8 re-checks them against Clarity's current docs before the launch copy is written.

| Capability | Clarity | Ours | Slice |
|---|---|---|---|
| Session recordings with masking | Yes | Yes. Inputs are always masked, plus `data-bf-mask` / `data-bf-block` regions. | S2, S3 |
| Click heatmaps | Yes | Yes, per release | S4 |
| Scroll heatmaps | Yes | Yes (depth deciles) | S4 |
| Area heatmaps (clicks grouped by element region) | Yes | Yes. An "Areas" mode draws the element table's boxes over the page. | S4c |
| Rage clicks, dead clicks | Yes | Yes | S2 |
| Quick backs, excessive scrolling | Yes | Yes | S2 (detect), S4c (surface) |
| JS errors in a recording | Yes | Yes. Platform errors come from the quality stream; buyer sites capture `error` / `unhandledrejection`. | S2, S3 |
| Dashboard (sessions, pages/session, scroll depth, active time, frustration %, top pages, devices, countries, referrers) | Yes | Yes: the Overview view | S4c |
| Filters (device, browser, OS, country, referrer, entry/exit page, visited page, clicked element, frustration, duration, page count, smart events, custom tags) | Yes | Yes. One `ReplayFilter` contract, one server compiler. | S4c |
| Saved segments | Yes | Yes. They apply to every view. | S4c |
| Custom tags | Yes (`clarity("set")`) | Yes (`BFReplay.tag(key, value)`) | S2, S4c |
| Custom identifier | Yes (`clarity("identify")`, hashed) | Yes, as a custom tag (`BFReplay.tag('user', id)`). The buyer supplies the opaque id, and it is never linked to Builderforce accounts. | S2 |
| Smart events (auto-detected plus custom, retroactive) | Yes | Yes. `BUILTIN_SMART_EVENTS` data, `BFReplay.event(name)`, and point-and-click rules evaluated at read time over visit marks. | S4c |
| Funnels | Yes | Yes, with "watch the recordings that dropped at step N" | S4c |
| AI summary of one recording | Yes (Copilot) | Yes, with deep links to the moments it cites | S4c |
| AI summary of a filtered set | Yes (Copilot insights) | Yes | S4c |
| Chat with your data | Yes (Copilot chat) | Yes. The canvas Brain gets a read-only `replay_query` tool over Overview, Funnels and segments. | S4c |
| Share a recording link | Yes | Yes ("Link at <time>") | S3 |
| Data export API | Limited | The read API is documented for buyers with a workspace key | S4c |
| Mobile app SDKs (iOS, Android, React Native, Flutter) | Yes | **No.** Web only (§6). Native SDKs are a separate PRD. | — |
| Google Analytics / Microsoft Ads integration | Yes | **No.** Not our market. | — |
| Price | Free | 5,000 recordings a month free, then packs (D4). We compete on what follows, not on price. | S6 |
| **beyond:** release tagging and release-vs-release compare | No | Yes | S1, S4 |
| **beyond:** real-time live view and follow-a-visit | No | Yes | S5 |
| **beyond:** canvas and WebGL content in replays | No | Yes (D10) | S2 |
| **beyond:** MP4 export | No | Yes | S4b |
| **beyond:** data stays with Builderforce and the buyer, never used for ads | No | Yes | — |
| **beyond:** replay → ticket → fix in the canvas (Measure → Make) | No | Yes | S3, S7 |
| **beyond:** journey and lead context next to the replay | No | Yes (traits from `identify`) | S0, S3 |

### 2.2 How replay plugs into the method (D12)

| Method seam today | What is missing | What replay adds | Where |
|---|---|---|---|
| A proof's charter states a kill condition (for example `targets/smokeTest.ts`: "N signups from M unique visitors from a named source, 14 days"). | **The sample is never measured.** The demand console counts signups and prints the sample as a constant, so a verdict can be called on 30 visitors. | `ProofMeasure` makes the condition data. The sample is replay visits that match a filter (source tag or referrer). Success is a smart event or funnel step. The threshold and window come from the charter. `evaluateProofMeasure` computes it. | S4d.1 |
| `syncRealizationVerdict` trusts the number the console posts and writes `proof.grade validated` with `kill_condition_met` 1 or 0. | The trusted record holds a self-reported count. | The verdict's `verdictMetric` is the **measured** numbers. A `met` posted before the sample is reached is not written. The realization stays undecided, with `verdictMetric.held = 'sample_not_reached'`, so `REALIZATION_VERDICTS` gains no fourth value. A person can still abandon, or call it early with a written reason, which is recorded. At the window's end the measured verdict is written automatically. | S4d.2 |
| `proof.grade` ledger rows carry `metricValue` and `metadata.verdict`. | Nothing says *why* a proof missed. | `metadata.evidence`: the sample, success and threshold numbers, the release keys, up to 5 visit ids and the cited AI segment patterns. The proof card shows "Why it missed" with replay links. | S4d.2 |
| Measure is supposed to hand the answer back to Idea (`LOOP_CLOSES_IN`). | No path carries the answer back. | "Read again with what we learned" starts a new `idea.read` with `metadata.priorGrade` (verdict, numbers, patterns). The Read surface shows it, and the recommender receives it as context. | S4d.3 |
| A replay moment becomes a ticket (S3) → Make. | Nothing says whether the fix worked. | The ticket stores its replay moment (`{visitId, atMs, releaseKey, metric}`). Once its fix ships as a new release and N visits arrive, the ticket shows the metric before and after. | S4d.4 |
| `useFounderJourney` computes only `idea` and `run` (ROADMAP gap). | No reliable Make or Measure signal. | A cached journey signal from live proofs: a proof built but not yet receiving visits places the founder in **make**, and one collecting its sample or graded within 14 days places them in **measure**. This closes the ROADMAP gap. | S4d.5 |
| The four method acts are written to `creation_outcome_events`. | The platform cannot see where *visitors* drop out of the method, or watch it happen. | The same four acts are emitted as platform smart events from the ONE client seam that calls the realization API. The platform also gets a seeded **Method funnel**: Visit → typed an idea → Read → Prove → Build → Grade. | S4d.6 |

### 2.3 Prescriptions: diagnose → prescribe → apply → verify (D13)

**1. Diagnose (deterministic).** `PRESCRIPTION_RULES` is data. Each rule has five parts:
- a detector over replay aggregates (visit columns, marks, interaction cells, funnel evaluations and errors);
- an `area`: `funnel`, `ux`, `site` or `sales`;
- a `subjectKey` (the element, page, step or error fingerprint), so a finding is upserted rather than repeated;
- an impact model;
- the actions it allows.

The first rules:

| Rule | Detects | Area | Default action |
|---|---|---|---|
| `rage_on_element` | ≥3% of the visits that reach an element rage-click it | ux / site | Fix it |
| `error_on_step` | a JS error fingerprint present in ≥30% of the visits dropping at a funnel step | site | Fix it |
| `dead_click_heading` | non-interactive text with dead clicks above a threshold | ux | Fix it / Test it |
| `cta_below_fold` | the step's CTA sits below the scroll depth reached by ≥40% of the visits on that device class | ux | Test it |
| `quickback_after_reveal` | quick backs within 7 s of a page or element that reveals a price, shipping cost or form | ux / sales | Test it / Follow up |
| `excessive_scroll_missing_info` | excessive scrolling between two regions before an exit | ux | Test it |
| `device_gap` | a step's conversion on phones below 50% of desktop's on the same release | ux | Fix it |
| `release_regression` | a step's conversion down ≥10 points against the previous release | site | Fix it (or Revert) |
| `pricing_hesitation` | identifiable visitors (platform accounts or leads, or a buyer's `user` tag matched to a Sales contact) who opened pricing 3+ times in 7 days without converting | sales | Follow up |
| `checkout_abandon_known` | an identifiable visitor reached checkout and left | sales | Follow up |
| `objection_pattern` | the same cited pattern (for example "shipping cost") recurs in ≥20% of non-converting visits | sales | Sales FAQ and talk-track update (ticket) |
| `proof_missed_reason` | the cited reason behind a missed proof (S4d.2) | funnel | Read again + Test it |

**2. Estimate (pure).** `estimateImpact(finding, cohorts)` = affected visits × (the conversion of comparable visits without the finding − the conversion of those with it), projected over 30 days.
- The range comes from a binomial interval on both cohorts.
- `confidence` is `low` when either cohort has fewer than 100 visits, and then no point estimate is shown.
- Prescriptions are ranked by impact ÷ effort, where effort comes from the action kind.

This is an estimate, labelled as one, and every Fix it or Test it measures it for real.

**3. Prescribe (AI, cited).** For the top new findings each day (≤5 per site per day, inside the summary budget), `condenseTranscript` (the S4c.5 primitive) receives the finding, its evidence digests and the page's element map. It returns:
- the prescription in plain words;
- the specific change: the selector or page, the before/after copy or layout, and for `site` the suspected source location when a source map or repo is connected;
- the acceptance metric.

Sentences that cite no evidence are dropped.

**4. Apply (registry `PRESCRIPTION_ACTIONS`).**

| Action | How | Seam |
|---|---|---|
| **Fix it** | Creates a task with the brief (finding, cited moments, change, acceptance metric). The task is dispatched to the project's coding agent, which builds a **preview release** of the hosted site. A person publishes it. External sites get the task, plus a PR when a repo is connected. | `dispatchCloudRunForTask`; the canvas task flow; hosted releases |
| **Test it** | Creates an `ab_tests` row with control = the current release and variant = the preview release, a 50/50 allocation, and `minimum_sample` from the impact model. The sites Worker serves the allocation, and the recorder tags `variant` so replay segments by it. A person starts it. | `marketing/experimentation.ts` (`createTest`, `setVariants`, `startTest`, `variantResults`) |
| **Follow up** | Enrols the matched contacts in a chosen or drafted `sequence`, or sends a broadcast to platform leads. The AI drafts the copy from the cited objection. | the Sales workspace `sequence` object + `runSequenceSweep`; `salesPolicy.ts`; `BroadcastComposer` (platform) |
| **Ticket** | A ticket with the brief, for a change a person makes. | the S3 ticket flow |
| **Dismiss** | Needs a reason. A dismissed `subjectKey` is not re-raised for 30 days. The reasons are reported per rule so thresholds can be tuned. | — |

**5. Verify.** Every applied prescription carries `acceptance = { metric, direction, minVisits }`.
- **Fix it** and **Ticket** are verified by the S4d.4 ticket effect on the next release.
- **Test it** is verified by `variantResults`, which already refuses a lift until the test is powered.
- **Follow up** is verified by the conversion of the enrolled contacts against the matched, not-enrolled ones.

The verdict is `worked`, `no_effect` or `worse`, stored on the prescription with its numbers. A `worse` on a Fix it offers "Revert to <release>". Every verdict is recorded as an outcome event (`prescription.verify`, phase `validated`) so the ledger counts changes that were proven, not just shipped.

**Where it sits in the method.** A prescription is the bridge from **Measure** back to **Make**: Fix it is Make, Test it is a proof, and Verify is Measure again. On a proof site, `proof_missed_reason` turns "why it missed" into the next proof's design (S4d.3).

### 2.4 The page review (D14)

**Which pages.** For each site, a page is reviewed when it is an entry page, a funnel step or a proof page, or when it is in the top 20 paths by visits. Each review is for one release, and a new release (fingerprint, hosted `version_token` or app version) triggers a fresh capture. Capped at 25 pages per site per release.

**1. Capture** (the Agentic Tester container, `dispatchQaRunner`; screenshots stored the way `findingScreenshots.ts` stores them, under `replay/pages/<scope>/<siteId>/<release>/`):

| Input | What is captured | Source |
|---|---|---|
| Screen | Full-page and above-the-fold screenshots at 1440×900 and 390×844; the element rect map (selector → box) for every heading, CTA, link, form field, image and section | Playwright in the QA runner |
| SEO | title (length), meta description, canonical, robots and indexability, H1 count and heading order, Open Graph and Twitter tags, structured data types, image alt coverage, internal and external links, word count, hreflang. With Search Console connected through the analytics port (`analyticsProviders.ts`, source `search_console`, dimension `page`/`query`): impressions, clicks, CTR, average position and the top queries per page | DOM + analytics port |
| Content | the above-the-fold text (public page content, not visitor input; `data-bf-mask` regions excluded), the value proposition present above the fold, CTA labels and count, readability grade, reading time, form fields and count, trust signals present (reviews, logos, guarantees, prices) | DOM |
| Performance (lab) | LCP, CLS, TBT, page weight, request count, largest images, render-blocking resources | Playwright performance APIs |
| Performance (field) | p75 LCP, CLS and INP per page, device and release, from real visitors | recorder (Web Vitals via `PerformanceObserver`) → `replay_page_vitals_daily` |
| Accessibility | colour contrast failures, tap targets under 44 px on phone, missing labels, missing alt, focus order | DOM + computed styles in the runner |
| Behaviour | everything replay already has for the page: conversion to the next funnel step, exits, scroll depth, frustration signals, errors, device gap, release compare | S1–S4c |

**2. Review.** Two sources produce prescriptions on the same `replay_prescriptions` table, in eight areas: `funnel`, `ux`, `site`, `sales` (S4e) and `seo`, `content`, `performance`, `accessibility` (new).
- **Deterministic rules** (`PRESCRIPTION_RULES`, extended). Examples:
  - `seo_title_length`, `seo_missing_meta_description`, `seo_multiple_h1`, `seo_no_structured_data`, `seo_low_ctr_high_impressions` (Search Console: position ≤ 10 and CTR below the curve for that position);
  - `content_no_value_prop_above_fold`, `content_cta_vague` ("Learn more" as the primary CTA), `content_readability` (grade above 12 on a consumer page), `content_missing_trust` (a pricing or checkout page with no trust signal);
  - `perf_lcp_poor` (field p75 > 2.5 s), `perf_cls_poor`, `perf_heavy_hero_image`;
  - `a11y_contrast`, `a11y_tap_targets`, `a11y_missing_labels`.
- **The vision review.** A vision model (routed through the gateway's capability gate) gets the screenshot, the element rect map, the page's metrics and the deterministic findings. It may raise up to 5 **observed** findings per page, such as visual hierarchy, a competing CTA, a hero that does not say what the product is, or a layout that hides the price. Each must name an element from the rect map and cite a page metric that supports it. Anything else is discarded (D13 amendment).

**3. Render the improvement.** A UI, content, SEO or accessibility prescription carries a **visual patch**: a list of operations from a closed vocabulary (`setText`, `setAttr`, `setStyle` limited to layout, spacing, size, colour-from-the-page's-own-palette and visibility properties, `moveBefore`/`moveAfter`, `insertAfter` with sanitised HTML from an allow-list of tags, `hide`), each addressing a selector in the rect map.
- `validateVisualPatch` rejects scripts, external URLs, unknown selectors and disallowed properties.
- The runner applies the patch to the captured page in a sandbox and screenshots it at both sizes. The fix shows **before** (with numbered callouts on the affected elements) beside **after**.
- SEO changes that are not visual (a meta description, structured data) render as a search-result preview (title, URL, description) before and after, plus the JSON-LD diff.
- Behaviour and sales prescriptions have no visual patch. They render as in S4e.

**4. The improvement prompt.** `compileImprovementPrompt(prescriptions[], page)` is pure and is not stored. It produces model-agnostic instructions, either for one fix or for "improve this page" (all accepted fixes on a page):
- the page and its goal;
- the evidence numbers;
- each change with its selector, the before and after copy or style, and the reason;
- the constraints (keep the brand palette and fonts, do not change prices or legal copy, keep the URL structure);
- the acceptance metric and how Builderforce will measure it.

The prompt goes out by one of three routes:
- **A canvas app hosted by Builderforce:** "Apply" places the fixes as context in the **ONE composer**, as chips through the `previewPick` seam (one chip per targeted element, plus the prescription). The same Brain makes the change in the App surface, and the result is a preview release (S4e Fix it). There is no separate apply form.
- **An external site with a connected repo:** an agent task that opens a PR (S4e Fix it).
- **Any other site:** "Copy prompt for your AI", with variants worded for a coding agent (Claude Code, Cursor and similar) or a site builder. The person deploys it however they like. **No hand-off back is needed**: the release fingerprint changes on deploy (§3.3), so Builderforce detects the new release, re-captures the page and measures.

**5. Measure.** Each prescription is verified as in S4e.4. In addition, each page has a **page score per release**, a weighted roll-up (weights as data) of:
- the conversion to the next step;
- the frustration rate;
- the SEO score (from the deterministic rules plus CTR against position);
- field performance (CWV pass rate);
- accessibility.

The Fixes home shows the site's score trend across releases, with each release annotated by the fixes it shipped. That is the improvement ledger: *what we changed, and what it did*.

### 2.5 The one screen and the panel (D16)

The home is called **Insights**. It answers the three questions in one viewport (1440×900 is the design size; everything reflows down to 1024 wide, and at ≤900 px wide the columns stack and the page may scroll):

| Band | Height | Content | Click → panel kind |
|---|---|---|---|
| Header | 48 px | breadcrumb, the query bar (the ONE `ReplayFilter`, shown as `route:* frustration:any device:any release:v13`), period, release compare, the **proof chip** ("Proof · Pro plan · day 9 of 14 · on track", shown while a proof is live), avatar | `proof` |
| Goal + numbers | 76 px | goal selector (Activation · Revenue · Sign-ups · Retention) that re-ranks every list and sets the impact unit; six tiles: sessions (exact), the goal metric with its interval, frustrated sessions, JS errors per 1k sessions, p75 LCP, site score; each with a sparkline | `metric` |
| Funnel | 56 px | the site's funnel as one row of segments (count + step conversion), and the behaviour-clusters bar | `funnel` |
| Body, three columns | the rest | **Issues** (38%): the D15 issue groups ranked by goal impact, with status tabs, sessions + sparkline, share of route, impact interval, since-release, status; at most the rows that fit, then "View all". **Page stage** (34%): the selected issue's route rendered as the real page, scaled to fit, with lenses Heat (clicks \| scroll) · Stuck · Fixes · Live. **Do next** (28%): the prescribed fixes ranked for the goal, each as a before → after (page crop, search result, LCP gauge or contrast swatches by kind) with impact and who makes it; "Apply all AI fixes"; the site-score-by-release strip | `issue`, `issues`, `fix`, `route`, `release`, `live` |

**The panel.** ONE `SlideOutPanel` (`width="wide"`, `widthStorageKey="insights-panel"`), holding a stack of levels. Each level is a registered **panel kind** with its own tabs:

| Kind | Tabs | Content |
|---|---|---|
| `issue` | Overview · Recordings · Fix · History | where on the page (heat), who, daily trend with the release marker, three representative recordings; the kept recordings list; the fix (drag-compare, impact, prompt per audience, Apply / PR / Test / Ticket); status by release |
| `recording` | Replay · Journey · Lead (identified visitors) | the player with timeline marks and the cited AI summary; the visit's route templates and marks; the lead (today's `VisitorPanel` tabs, so this kind IS `VisitorPanel`) |
| `fix` | Change · Prompt · Measure | the before/after with callouts; the prompt for Composer / Coding agent / Site builder; expected vs measured after the next release, Undo |
| `route` | — | the page review (D14): tick fixes, drag-compare, fact meters, score rings, one prompt, simulate the next deploy |
| `metric` | — | the 30-day trend with release markers, breakdowns, segments (the earlier Overview) |
| `funnel` | Steps · Clusters · Flow | the funnel editor and drop reasons, the behaviour clusters, the flow graph (the earlier Journeys) |
| `live` | — | live count, by route, live tiles and the feed (the earlier Live) |
| `proof` | — | the scoreboard: sample, success, threshold, day, verdict; call early; abandon (D12) |
| `release` | — | the release report: verdicts per change, before → after, Undo, next up |
| `issues` | — | the full issue list with the same filters |

Rules:
- A slice registers a panel kind (`INSIGHT_PANEL_KINDS`, data), never a route, a tab bar or a second overlay.
- The panel is addressable: `?panel=issue:<id>` opens it on load, so links from email, Slack and the Brain land inside the screen.
- Lists on the home are bounded to what fits; the panel's lists are paginated with cursors.
- The six "views" of the earlier design do not exist as navigation. The legacy admin URLs alias to `growth/insights` with the matching `?panel=`.

### 2.6 The buyer's path, end to end (D17)

Builderforce walks this path first, as customer #1, and the live validation (S8) walks it again with a paying workspace.

| Step | What the buyer sees | Built on (exists today) | New |
|---|---|---|---|
| 1. Find | The Marketplace landing page for Insights at `/marketplace/listing/insights`: value, one-line install, see / fix / prove, comparison, a pricing calculator and the pack ladder, FAQ, "Builderforce runs on it" with our own live numbers | `marketplace/listing/[slug]/page.tsx` + `generateMetadata`; marketing sections `MarketingFaq`, `CompetitorMatrix`, `SocialProofBar`, `CreationCtaSection` | A **listing landing registry** (`LISTING_LANDINGS`, data keyed by slug, with sections as components) so a listing can carry a landing page without a per-slug branch; listing pages added to `sitemap.ts` (today they are missing) |
| 2. Sign up | "Start free" → sign up or sign in; the install intent survives the round trip and the buyer lands back in set-up, not on the listing page | `registerHref(next, intent)`, `signInHref`, `safeRedirectPath`, `ensureStarterWorkspace` | **Intent resume**: `intent=install:insights` is honoured after sign-up, verification and workspace selection (today the buyer must click again) |
| 3. Workspace + licence | Choose or create the workspace; installing writes a free licence | `acquireListing` → `grantListing` → `template_licenses` | — |
| 4. Site | Name, allowed domains, privacy defaults (mask inputs, mask text, wait for consent, identify signed-in users, honour DNT/GPC) | `mintTenantApiKey`, `tenant_api_keys.allowed_origins` | `replay_sites` (§3.1, no platform row) |
| 5. Snippet | Script tag · npm · Google Tag Manager · Builderforce app (toggle, no snippet); copy or email to a developer | `replaySnippets()` (S6.4) | GTM and npm variants |
| 6. Verify | Live checks: loader requested, origin allowed, first event, first session kept, with the live session drawn on the page | trace verbs (S6.4) | — |
| 7. Plan | Free 5,000 kept recordings a month; optional pack now | one-off checkout as the comms top-up does | — |
| 8. Use | The Insights app (D16) at `/apps/insights`, with a site switcher (sites, snippet, privacy) and a usage chip (usage, packs with Stripe Checkout, receipts) as panel kinds `sites` and `plan` | — | **App home**: `/apps/[slug]` renders a capability's home from `CAPABILITY_APPS` (data: slug → component); today an installed listing can only open as a canvas session |

## 3. Architecture

```
Browser (any site)                       API Worker (api.builderforce.ai)                 Storage
──────────────────                       ────────────────────────────────                 ───────
<script src=cdn.builderforce.ai/replay/v1/loader.js data-site=bfr_…>
  loader (≤2 KB gz, 5-min cache; R2 + edge cache, no Worker)
    └─ GET /api/replay/config?site=… ──▶ ReplayConfigService (cached per site key) ──▶  replay_sites (core)
         ◀─ {enabled, recorderUrl, sampleRate, masking, consentRequired, releaseHint}
  recorder.<hash>.js (rrweb + capture, immutable)
    ├─ visit/visitor ids (same semantics as bf_visitor_id / bf_visit_id)
    ├─ release key (explicit → hosted version_token → asset fingerprint)
    ├─ rrweb events (masked) + interaction events (click/rage/dead/quickback/excessive_scroll/scroll/error, selector)
    ├─ BFReplay.event(name) / BFReplay.tag(key, value) from the buyer's code
    └─ POST /api/replay-ingest/v1/chunks ─▶ ReplayIngestService ─┬─▶ R2 replay/<scope>/<site>/<day>/<visit>/<seq>.ndjson.gz
         (gzip, keepalive, every 5 s / pagehide)                ├─▶ replay_visits (transactional) upsert
                                                                ├─▶ replay_visit_marks + replay_visit_tags (transactional) batched insert
                                                                ├─▶ replay_interactions_daily (transactional) buffered additive upsert
                                                                └─▶ replay_releases (transactional) first-seen

/apps/insights (any workspace)  ─▶ /api/replay/*  (membership + entitlement, scope = site)
Canvas Measure ▸ Visitors       ─▶ the same reads for the canvas's hosted app's site
Admin ▸ Insights operations     ─▶ /api/admin/replay-ops/* (superAdminMiddleware; aggregates only, no recordings)
Both use ONE ReplayReadService and ONE set of React components.
```

**Scope** is `{ tenantId, siteId }` and nothing else (D17). It is used in every read, and every read takes it as a parameter. builderforce.ai is a site of the Builderforce workspace like any other.

A read never infers scope from a row.

### 3.1 Data model (3NF)

**Core database** (tenant configuration; written rarely):
- `replay_sites`:
  - `id uuid pk`
  - `tenant_id int not null` (D17: no platform row)
  - `kind varchar(16)` (`'hosted'|'external'`)
  - `project_id int null` (set when kind = `hosted`; a bare id, since `project_sites` lives in the apps DB)
  - `label varchar(200)`
  - `api_key_id uuid null` → `tenant_api_keys.id`. The site key is a `tenant_api_keys` row; no second key table.
  - `settings jsonb`: masking, consent, sample rate, recorder channel
  - `status varchar(16)`
  - `created_at`, `updated_at`
  - Unique `(tenant_id, project_id)` where `project_id` is not null.
  - Allowed origins live on the key (`tenant_api_keys.allowed_origins`); this table holds no copy.

**Transactional database** (high write volume; telemetry):
- `replay_visits`: one row per visit.
  - `id uuid pk`, `site_id uuid`, `tenant_id int null`
  - `visitor_id varchar`, `visit_id varchar`, unique `(site_id, visit_id)`
  - `started_at`, `last_event_at`, `ended_at null`, `duration_ms`
  - `entry_path`, `exit_path`, `page_count`
  - `user_id int null` (set when the site calls `BFReplay.identify(id, traits)`, with the site's identify setting on) and `seen_tenant_id int null` (the workspace the signed-in user was in). Both are bare ids.
  - `billable_units int`: the D4 unit, `ceil(bytes / 2 MB)` with a minimum of 1. One writer, the ingest fold.
  - `release_key varchar(64)`, `recorder_version varchar(32)`
  - `device_class varchar(8)` (`desktop|tablet|phone`), `viewport_w`, `viewport_h`, `browser`, `os`, `country char(2) null` (from `cf.country`), `referrer_host`
  - `click_count`, `rage_count`, `dead_count`, `error_count`, `quickback_count`, `excessive_scroll_count`
  - `active_ms` (time with input or scroll activity, idle gaps over 30 s excluded; the Overview's "active time")
  - `converted boolean` (a goal event was reached in the visit; written by the ingest fold)
  - `chunk_count`, `bytes`
  - Indexes: `(site_id, started_at desc)`, `(site_id, last_event_at desc)`, `(site_id, release_key)`, `(visitor_id)`.
- `replay_releases`:
  - `site_id`, `release_key` (pk on the pair)
  - `label varchar(80) null` (the operator rename, or a GitHub tag)
  - `source varchar(16)` (`explicit|hosted|fingerprint`)
  - `first_seen_at`, `last_seen_at`
- `replay_interactions_daily`: the heatmap and element read model, written additively like `site_traffic_daily`.
  - `site_id`, `day date`, `release_key`, `path varchar(512)`, `device_class`, `kind varchar(12)` (`click|rage|dead|scroll`), `selector varchar(400)`, `label varchar(120)`, `grid_x smallint`, `grid_y smallint`, `n int`
  - Unique on the dimension columns.
  - `grid_x`/`grid_y` are 0–49 page-relative bins. For `scroll`, `grid_y` is the max depth decile and the selector is empty.
- `replay_visit_marks`: the per-visit index of meaningful moments. It is what filters, funnels, smart events, buyer Flow, AI digests and timeline markers read, so none of them has to open R2 chunks.
  - `visit_id uuid` → `replay_visits.id`, `ord smallint`, `at_ms int` (offset from visit start); pk `(visit_id, ord)`
  - `kind varchar(16)`: `page|click|event|rage|dead|quickback|excessive_scroll|error`
  - `key varchar(400)`: the path for `page`, the selector for clicks and frustration, the event name for `event`, the message fingerprint for `error`
  - `label varchar(120) null`: the element label or error message, already masked by the recorder
  - Capped at `REPLAY_LIMITS.maxMarksPerVisit = 300`. Clicks beyond the cap are dropped first; pages, events, frustration and errors are kept.
  - Indexes: `(kind, key)`, plus the pk. Filters join on `visit_id`.
- `replay_visit_tags`: custom tags.
  - `visit_id`, `key varchar(64)`, `value varchar(200)`; pk `(visit_id, key)`. The last write wins.
  - At most 20 keys per visit.
- `replay_visit_summaries`: the AI summary cache, one row per visit.
  - `visit_id pk`, `summary text`, `citations jsonb` (`[{atMs, ord}]`), `model varchar(80)`, `generated_at`
  - Regenerated only on request.

**Core database** additions (definitions people edit, written rarely):
- `replay_segments`: `id uuid pk`, `site_id uuid`, `name varchar(120)`, `filter jsonb` (a validated `ReplayFilter`), `created_by int`, `created_at`. Unique `(site_id, name)`.
- `replay_smart_events`: `id uuid pk`, `site_id uuid`, `name varchar(80)`, `rule_kind varchar(12)` (`page|click|custom`), `match varchar(400)`, `match_mode varchar(8)` (`equals|prefix|contains`), `created_by`, `created_at`. Unique `(site_id, name)`. Built-in smart events are code data (`BUILTIN_SMART_EVENTS`), not rows.
- `replay_funnels`: `id uuid pk`, `site_id`, `name varchar(120)`, `window_minutes int default 30`, `created_by`, `created_at`.
- `replay_prescriptions` (D13): `id uuid pk`, `site_id uuid`, `rule_id varchar(48)`, `area varchar(8)`, `subject_key varchar(400)`, `status varchar(12)` (`proposed|applied|measuring|worked|no_effect|worse|dismissed`), `finding jsonb` (the detector output and evidence refs: visit ids + `ord`), `prescription text null`, `change jsonb null`, `impact jsonb` (`{estimate, low, high, unit, confidence}`), `action_kind varchar(12) null`, `action_ref varchar(80) null` (task id, `ab_tests` id or sequence id: a bare id), `acceptance jsonb null`, `measured jsonb null`, `dismiss_reason varchar(200) null`, `decided_by int null`, `created_at`, `updated_at`. Unique `(site_id, rule_id, subject_key)` where status is not terminal. One row per live finding, with ONE writer per column group: the sweep writes finding, impact and prescription; the action route writes action and status; the verifier writes measured and status.
- `replay_page_captures` (D14): `id uuid pk`, `site_id`, `path varchar(512)`, `release_key`, `device_class`, `captured_at`, `screenshot_key`, `fold_screenshot_key`, `rect_map_key` (R2 JSON), `seo jsonb`, `content jsonb`, `lab_perf jsonb`, `a11y jsonb`, `score jsonb`. Unique `(site_id, path, release_key, device_class)`. One writer: the capture job. `replay_prescriptions` gains `page_path varchar(512) null`, `capture_id uuid null`, `source varchar(10)` (`rule|observed`) and `visual jsonb null` (`{patch, afterScreenshotKeys}`); `area` widens to `seo|content|performance|accessibility` as well. The improvement prompt is compiled on read, never stored.
- `replay_page_vitals_daily` (transactional, D14): `site_id`, `day`, `release_key`, `path`, `device_class`, `metric varchar(4)` (`LCP|CLS|INP`), `p75 real`, `n int`, unique on the dimensions; written additively by the ingest fold from `vital` marks.
- `replay_funnel_steps`: `funnel_id`, `ord smallint`, `step_kind varchar(12)` (`page|click|event`), `match varchar(400)`, `match_mode varchar(8)`; pk `(funnel_id, ord)`. One step is one row; there is no step array.

Nothing in the visitor stream is copied:
- page views and prompts for builderforce.ai remain `activity_log` visitor rows;
- the replay row and the journey join on `visit_id`;
- errors are read from the existing visitor `error` rows (platform) or from the chunk events (buyer sites).

### 3.3 Scale: millions of sessions (D15)

Where §3.1 and this section disagree, this section wins. The target is **10 million sessions a month per site** on the same code path that serves a site with 1,000, with the home view loading in under a second from cache.

**Principles**
1. **Count everything, keep what matters.** Every session sends its lightweight events (page views, interaction marks, vitals, conversions). Only some sessions send the full recording.
2. **Issues, not sessions.** Frustration, errors, slow pages, SEO and accessibility findings are folded into **issue groups** keyed by a fingerprint. People read and act on issues; a recording is evidence for an issue.
3. **Routes, not URLs.** Every path is folded into a route template (`/invoices/8812` → `/invoices/:id`) at ingest, so aggregates stay bounded.
4. **Nothing grows per session in Postgres.** Postgres rows grow with routes, issues, releases, prescriptions and kept recordings only.
5. **Every number says what it is.** Exact counts are shown plainly. Estimates (sampled storage, recording-based figures, model impact) show "≈" and their interval.

**The four tiers**

| Tier | Store | Holds | Read by | Retention |
|---|---|---|---|---|
| Hot counters | **Workers Analytics Engine** dataset `replay_events` (index = site id; blobs: route template, release, device, kind, fingerprint, selector; doubles: count, grid x/y, value) | one data point per event for every session | KPI tiles, trends, heat cells, issue counts, live counts (SQL API, weighted by `_sample_interval`) | 3 months (platform limit) |
| Event lake | **Cloudflare Pipelines → R2 Data Catalog (Iceberg) table `replay_events`**, partitioned by site and day; queried by **R2 SQL** | every event of every session, complete | funnels, flows, segments, the query bar, smart-event backfill, AI digests, behaviour clustering | 13 months (per-scope setting) |
| Small tables | transactional Postgres | `replay_issues`, `replay_issue_daily`, `replay_route_daily`, `replay_recordings` (kept recordings only), `replay_releases`, plus the core definitions and `replay_prescriptions` | lists, detail panels, status, the improvement ledger | issues and daily rollups 13 months; recordings index per D3 |
| Recordings | R2 chunks (D2) | the rrweb stream of **kept** recordings, plus one `marks.json` per recording for timeline markers | the player | D3 |

**Which recordings are kept** (the recorder decides, in buffer mode):
- The recorder always holds the last 60 s of the rrweb stream in memory and always sends events.
- **Head sample:** at session start, keep with probability `keepRate` (per site; default auto-tuned so kept recordings fit the plan's allowance; 100% under 50k sessions a month).
- **Triggers:** a rage click, dead click, quick back, JS error, goal conversion, `BFReplay.keep()` or a custom tag flushes the buffer and streams the rest of the session.
- Every kept recording stores `keep_reason` (`sample|frustration|error|goal|tag`) and `sample_weight` (`1/keepRate` for head-sampled, 1 otherwise), so recording-based figures can be weighted back to the whole population.
- Billing (D4) counts **kept recordings** only. Events are not billed; their cost (≈40 events a session, $0.25 per million Analytics Engine data points beyond the plan's included 10 million) is carried by the platform.

**Issue groups**
- `fingerprint = hash(siteId, routeTemplate, kind, selector | errorFingerprint | metric)`, computed by `issueFingerprint()` in `interaction-contract`, the same function on the recorder, ingest and rules.
- `replay_issues`: `id`, `site_id`, `fingerprint` (unique per site), `kind`, `route_template`, `subject` (selector, error or metric), `title`, `first_release`, `last_release`, `status` (`new|ongoing|regressed|proposed|preview|measuring|verified|ignored`), `prescription_id null`. One writer: the nightly rollup (counts) and the action routes (status).
- `replay_issue_daily`: `issue_id`, `day`, `release_key`, `device_class`, `sessions`, `users_est` (HyperLogLog-backed estimate from the lake), unique on the dimensions.
- A regression is a fingerprint whose daily rate rises past its interval after a new release. That rule is a `PRESCRIPTION_RULES` entry, so it reuses S4e.

**Representative recordings**
For each issue, the nightly job clusters the issue's kept recordings by path shape (the sequence of route templates and marks, as n-gram vectors) and stores up to three medoids with the share of sessions each stands for (`replay_issue_representatives`: `issue_id`, `rank`, `recording_id`, `share`, `label`). The detail panel shows those three, never a random list.

**Read budgets**
- The home view issues at most six queries, each through `getOrSetCached` keyed by `replayVersionKey(siteId)`: one Analytics Engine query for KPIs and trends, one for issue counts, one Postgres read of issues, one of routes, one cached funnel and one cached clusters result.
- Lake queries (funnels, flows, segments, search) run through `ReplayLakeService` with a 5-minute cache, a 10-second timeout and a row cap; a cold query shows its last cached result with an "updating" marker instead of a spinner.
- Lists are paginated with cursors; no endpoint returns an unbounded set.

**What changes in §3.1**
- `replay_visits` becomes `replay_recordings` (kept recordings only) and gains `keep_reason` and `sample_weight`. Its counters stay; its `converted` read stays.
- `replay_visit_marks` and `replay_visit_tags` move out of Postgres: they are lake columns, and the player reads `marks.json`. Filters compile to lake SQL (`compileReplayFilter` gains a lake target; the Postgres target remains for the kept-recordings list).
- `replay_interactions_daily` and `replay_page_vitals_daily` are replaced by Analytics Engine queries plus `replay_route_daily` (`site_id`, `day`, `release_key`, `route_template`, `device_class`, `sessions`, `conversions`, `frustrated`, `errors`, `lcp_p75`, `cls_p75`, `inp_p75`), written by the nightly rollup from the lake.
- Usage (D4) sums `replay_recordings.billable_units`, unchanged in meaning.

### 3.2 Contracts (new shared source package)

The new package is `packages/interaction-contract`. It holds pure TypeScript with no DOM globals at module scope, and both the recorder, the frontend and the API import it:
- `deriveSelector(el)`, moved verbatim from `lib/qa/telemetry.ts`, which then imports it.
- `redactInput`.
- `INTERACTION_KINDS`.
- `isRageClick(clicks, opts)`: ≥3 clicks within 700 ms and 30 px.
- `isDeadClick(...)`: the target is not interactive and there is no navigation or DOM mutation within 500 ms.
- `isQuickBack(pages)`: the visitor returned to the previous page within 7 s of leaving it.
- `isExcessiveScroll(samples)`: ≥3 scroll direction reversals within 5 s, or more than 3 viewport heights scrolled in 10 s with no click.
- `ReplayFilter`, `FILTER_FIELDS` (the filter registry: field, operator set, value kind, scopes) and `parseReplayFilter`.
- `BUILTIN_SMART_EVENTS`: data rules for sign up, purchase, add to cart, begin checkout, contact and download, matched on button labels, link targets and paths, in all five locales' common words.
- `ReplayChunk` and `ReplayVisitMeta` types with their runtime validators.
- `REPLAY_LIMITS`: max chunk bytes, events per chunk, flush interval.
- `releaseKeyFromAssets(urls)`.
- `GRID = 50`.

### 3.3 Release identity

`release_key` is chosen in this order, first match wins:
1. The explicit value (`window.BF_RELEASE`, or the loader tag's `data-release`).
2. For hosted apps: the `site_releases.version_token` that the sites Worker writes onto the injected tag.
3. For builderforce.ai: `NEXT_PUBLIC_APP_VERSION` (written onto the tag by the root layout).
4. Otherwise a fingerprint: the first 12 hex characters of SHA-256 over the sorted `script[src]` and `link[rel=stylesheet][href]` URLs on the page that contain a hash-like segment.

Releases are labelled `R<n> · first seen <date>` until renamed. A customer never edits the tag on deploy.

### 3.4 Recorder delivery and updates

- The loader is a stable file; its URL never changes.
- On each page load the loader asks `/api/replay/config` for the recorder URL. The answer is the newest recorder from the build's `replay/manifest.json`, unless the site's `settings.recorderChannel` or a platform pin (a superadmin setting) says otherwise.
- A new recorder therefore reaches every site on its next page load. Rollback is a pin.
- Every visit stores `recorder_version`.

## 4. Theme, responsive, accessibility

- Every new component uses theme tokens only, with no hardcoded colours, and works in both themes.
- The only fixed colours allowed are inside the replay iframe, which renders the recorded site's own styles.
- Layouts are fluid. Tables scroll horizontally in their own box.
- The home never scrolls at ≥1024 px wide and ≥800 px tall; only the panel body scrolls. Below that the columns stack and the page may scroll.
- The ONE panel uses `SlideOutPanel` (`width="wide"`, `widthStorageKey`), which is full-bleed at ≤900 px.
- The player's controls are 44 px targets on phones. Timeline markers are real buttons with an `aria-label` (time + event).
- The scrubber is a real `<input type="range">`.
- The heatmap legend does not rely on hue alone: it also carries "cold/hot" text.

## 5. Architecture guardrails (audited per slice)

- **One of each.**
  - One visitor panel, one player and one stat tile.
  - One selector derivation and one zone-ranking rule.
  - One site key type: a scope on `tenant_api_keys`.
  - One credit mechanism: a `ledger_entries` denomination plus a `ONE_OFF_SETTLERS` row, with no new billing table.
  - One usage meter: a row in the consumption snapshot (`application/consumption/meters.ts`), so what is displayed is what is enforced.
  - One filter contract (`ReplayFilter`) and one server compiler (`compileReplayFilter`). Every view takes the same filter; no view has its own filter code.
  - One flow fold: buyer Flow projects visit marks into `VisitorFlowRow` and calls the existing `buildVisitorFlowGraph`.
  - One LLM condense primitive: `condenseTranscript` moves out of `meetingIntelligence.ts` into `application/llm/condense.ts`, and both meetings and replay summaries call it.
- **Layering.** Routes construct application services and never import tables. Components fetch through typed clients (`lib/replayApi.ts`) and never embed URLs or queries.
- **No god files.** No new file over ~400 lines. `adminRoutes.ts` is not grown: replay admin routes go in a new `replayAdminRoutes.ts`, mounted under the same superadmin guard. `adminApi.ts` (2,053 lines) is not grown: replay calls live in `lib/replayApi.ts`.
- **Caching.** Every read endpoint goes through `getOrSetCached`. Keys carry a per-site version token, bumped by ingest at most once per minute per site, as `QaHeatmapService` does. Live endpoints use a ~5 s TTL. The config endpoint caches per key hash.
- **Abuse ceilings** at ingest:
  - the site key must match the request Origin;
  - a per-IP daily budget, the same mechanism as `withinIpBudget`;
  - a per-site monthly session cap (D4);
  - a max chunk size.
  - Ingest always answers 202 and never echoes why a chunk was dropped, except to an authenticated caller (Verify).
- **Privacy.**
  - Masking happens in the browser.
  - The server never receives raw input values.
  - `VisitorDataEraser` is a registry of erasers that deletes a visitor's prompts, journey rows, `replay_visits` rows and R2 chunks together. The DELETE route that exists today, and is wired to no UI, becomes the one erase path.

## 6. Non-goals (v1)

- No mobile-native (iOS/Android) app recording. The web only.
- No operating-system screen capture (`getDisplayMedia`); see D10.
- No metered Stripe subscription; billing is prepaid packs (D4).
- No cross-domain visitor stitching.
- No WebSocket push. Liveness is polling (D6).
- No fingerprinting. A site identifies a visitor only through `BFReplay.identify(id, traits)`, which it calls itself, with its identify setting on. builderforce.ai does the same for its signed-in users (D9), as any customer would.
- No reading of another workspace's recordings by Builderforce staff. Admin sees aggregates only.
- No Google Analytics or ad-platform integrations.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A buyer runs out of credits mid-month | Recording pauses only for NEW visits. Visits in progress finish, and recorded data stays readable. This is the consumption meter's graceful-backpressure rule. Auto-recharge is offered (D4). The Verify screen and the usage meter warn at 80%. |
| Recording signed-in users exposes workspace content to the superadmin | Sensitive-region masking, an audit on every view, a per-workspace exclusion, and the legal-disclosure gate (D9). |
| Ingest volume exhausts Neon Free on the transactional DB | D15: events go to Analytics Engine and the Iceberg lake, recordings to R2; Postgres holds rows per route, issue and kept recording only. Retention purge runs through `retentionPurge.ts`. |
| A million-session site makes reads slow or costly | D15 read budgets: six cached queries for the home view, lake queries cached 5 minutes with a timeout and a row cap, cursor pagination everywhere. Analytics Engine sampling is weighted and shown as "≈". |
| Buffer-mode keeping misses the start of a problem | The 60 s in-memory buffer is flushed on the trigger, so the lead-up is kept. The head sample covers sessions with no trigger. |
| rrweb breaks on a customer's page (shadow DOM, canvas, iframes) | The recorder catches and self-disables per page, and reports through the quality SDK path. Record `recorder_version`, and keep a platform pin for rollback. |
| Recording personal data | Masking is on by default and server-side masking is impossible by construction. A "mask all text" setting exists. A buyer must accept the processing terms at purchase (legal copy is an operator task: `[DPA LINK]`). |
| Visit marks multiply rows in the transactional DB | Capped at 300 per visit, purged with the visit (D3), and written in one batched insert per chunk. Filters read marks only for the bounded candidate page, never for a full scan. |
| AI summaries cost money or invent things | Summaries run on demand only, never at ingest. They use the workspace's own plan routing (`tenantProxyForPlan`, as meetings do). They are cached per visit and limited to `REPLAY_SUMMARY_DAILY_LIMIT = 200` per workspace a day. The input is the visit's marks digest, never page text, and every claim cites a mark. Uncited sentences are dropped before the summary is stored. |
| A measured verdict overrides a founder's judgement | The precedence is fixed: a person's abandon, then a person's early call with a written reason, then the measured verdict at the window's end. The measured numbers are always stored beside the call, so nothing is hidden and nothing is silently overridden. |
| Proof sites record visitors who never agreed to be studied | Proof pages carry the same masking floor. The generated proof pages already tell signups the product is not built yet, and the targets add one line naming session recording, the same way. |
| Vision findings are subjective, or the rendered "after" is misleading | An observed finding must name an element and cite a page metric, or it is dropped. It is labelled as observed. The after image comes from applying a validated patch to the real captured page, not from a generated picture. Every applied change is measured. |
| Capturing pages costs too much | 25 pages per site per release, captured only on a new release or weekly; the runner is the existing QA container and degrades to "queued" when it is not provisioned. |
| AI prescriptions are confidently wrong | Findings come from deterministic rules with thresholds, never from the model. The model only phrases and drafts, and only from cited evidence. The impact range comes from data and is withheld at low confidence. Every applied change is measured, and a `worse` verdict offers a revert. |
| AI changes break a live site, or AI sales follow-ups spam people | Fix it builds a preview release that a person publishes. A test needs a person to start it. Follow-ups run through the existing `sequence` engine and `salesPolicy.ts` (consent, quiet hours, caps), and only to contacts the workspace already has. |
| We fall behind Clarity after launch | The §2.1 matrix is re-checked at S8 and on each later replay release; a new Clarity feature becomes a ROADMAP entry. |
| Real-card validation spends money | D8: refund immediately, which also exercises the refund ledger. |

## 8. Order of execution

The slices are specified in 33a §2–§10. In brief:
- **S0 Consolidation** (no new capability; ships alone) ∥ **S2 Recorder package**.
- Then **S1 Data plane**.
- Then **S3 Dogfood on builderforce.ai** (replay player).
- Then **S4 Heatmaps** ∥ **S5 Live + Flow links** ∥ **S4c Analysis parity** (Overview, filters and segments, frustration surfacing, funnels and smart events, AI summaries, Brain tool).
- Then **S6 Commerce** (capability add-on, site keys, install + verify).
- Then **S7 Buyer surfaces** (hosted injection, canvas Measure ▸ Visitors).
- Then **S4d The method link** (needs S4c's funnels and smart events and S7's hosted injection): proof measures, measured verdicts with evidence, read-again, ticket effect, journey signal, Method funnel.
- Then **S4e Prescriptions** (needs S4d for the ticket effect and the proof reasons, and S6 for the Sales contact match): rules, impact model, AI prescriptions, Fix it / Test it / Follow up / Ticket, verification, the Fixes view and the Brain tool.
- Then **S4f Page review** (needs S4e): page captures, SEO/content/performance/accessibility rules, the vision review, visual patches rendered before/after, improvement prompts into the ONE composer / agent / copy, page score per release, and Fixes as the home view.
- Then **S8 Ship + live validation**.

Each slice is implemented by one Opus agent, verified by a Sonnet agent (33a §11), and audited by the planning session (33a §12) before the next slice that depends on it starts.

## 9. Definition of done (whole feature)

All slices are DONE per 33a §13, and:
- the live validation runbook (33a §10.3) has been executed with its trace recorded;
- every non-excepted row of the §2.1 matrix has been demonstrated on a buyer site;
- one real smoke-test proof has been graded from replay data end to end (§2.2): sample reached, verdict measured, evidence on the `proof.grade` row, and a read-again started from it;
- one prescription per area (funnel, ux, site, sales) has gone from finding to applied to a measured verdict on a real site (§2.3);
- one external site has been improved purely through a copied improvement prompt, with the new release detected and the page score re-measured with no hand-off (§2.4);
- the release note is published;
- the blog post exists in five locales;
- the ROADMAP entry has moved to DONE.md.
