# PRD 20 — The Consolidated Data Model

> **Status:** §5 **Step 0 is built and green**; §§1–6 await the operator decisions in §6.
> The six validation checks run in CI today as ratchets against the current schema — they were
> written before the data moves, which is the only time a check can be written honestly.
> **Governs:** the B0 schema conversion in [PRD 19](./19-prd-burnrateos-consolidation.md) and the
> T0 foundation in [PRD 18](./18-prd-hired-video-port.md). Both are blocked on this document, not
> the other way round: a codemod that runs before the target shape is decided has to run twice.
> **Evidence:** [`data-model/source-to-target.tsv`](./data-model/source-to-target.tsv) — all 1,130
> distinct source tables, each mapped to its target and the move that takes it there. Zero
> unaccounted.
>
> ### **1,206 declarations → 1,130 distinct names → 387 tables**
>
> **25 kernel + 362 domain**, across 15 domains, one owner each. The file above is the proof:
> 568 absorbed by a kernel primitive, 167 merged into a sibling, 24 into the canvas, 9 flattened,
> and **362 distinct kept targets** — which is the domain count arrived at independently.
> Of the 387, **369 are measured and reproducible**; the last 18 are the twelve named judgements
> in §3.3, each rejectable on its own.

---

## 0 · The rule

**A feature may add domain tables. It may not add another instance of an existing shape.**

Needing comments does not earn a comments table; it earns a row kind. Needing a balance does not
earn a balance table; it earns a denomination. Needing an integration does not earn a connections
table; it earns a manifest row.

This is not imported from somebody else's architecture. The platform has already made this call
three times and won each time:

| Precedent | What it did |
|---|---|
| Migration **0295** | Dropped `audit_events`, made `activity_log` the single audit store. |
| Migration **0410** | Connector platform: vendors are **manifest data**, not DDL. Adding a vendor adds no tables. |
| `CREATION_OBJECT_KINDS` | **74 heterogeneous artifact kinds in one table** — document, video, game, cad, resume, slides, terminal. |

Writing the rule down is what stops the count climbing back after the merge.

---

## 1 · Where the 1,206 come from

Parsed from source: Builderforce **374** `pgTable` declarations, hired.video **428**, BurnRateOS
**404** Prisma models. **1,206 declarations, 1,130 distinct names.**

Exact name collisions across products are only **79**, so name matching finds almost none of the
duplication. The duplication is **shape repetition**, and the column distribution proves it is not
a schema of trivial tables:

| Payload columns (boilerplate excluded) | Tables |
|---|---|
| 1–3 | 78 |
| 4–6 | 340 |
| 7–10 | 419 |
| 11–20 | 257 |
| 21+ | 36 |

---

## 2 · The kernel — 25 tables, owned by no domain

Every domain uses these. **No domain may fork one.** They absorb **564** source tables.

| Primitive | Absorbs | What it replaces |
|---|---|---|
| `object` | — | The registry every addressable entity registers in, so polymorphic references keep a real foreign key. **New table; it is what makes the rest safe.** |
| `activity_log` | 70 | Every subsystem's own event / log / history / audit stream. Partitioned by month. |
| `ledger_entry` | 59 | Points, tokens, AI credits, enrichment credits, campaign dollars, phone balance, partner and seller balances, payouts, commissions. Denomination is a column. |
| `connection` | 58 | A table per vendor. Vendors become manifest rows. |
| `membership` | 43 | Who is on this thing — chats, boards, teams, rotations, cohorts, ceremonies. |
| `annotation` | 33 | Comments, notes, tags, likes, votes, ratings. |
| `setting` | 31 | Per-feature settings singletons. Typed user data stays typed columns on its owner. |
| `run` | 30 | Jobs, executions, attempts, steps. |
| `artifact` | 30 | Per-media-type tables for one thing: a made object with a kind. |
| `metric_fact` | 28 | Derived numbers that were given their own DDL. |
| `work_item` | 25 | Task, epic, story, subtask, objective, key result, initiative, milestone. |
| `share_link` | 24 | Tokens that grant access to one object. One expiry policy, one revocation path. |
| `catalog_item` | 22 | Templates, presets, packs, listings, offerings. |
| `party_role` | 19 | A profile table per role a person or company can hold. |
| `revision` | 18 | Version history per versionable thing. |
| `relation` | 17 | Mappings, dependencies, associations, overrides. Typed edges. |
| `delivery` | 16 | Outbound sends, dispatches, notifications, alerts, webhook attempts. |
| `credential` | 13 | Secrets per integration. One encrypted store. |
| `response` | 13 | An answer to a question, whatever asked it. |
| `message` | 12 | A message in a thread, whatever the channel. |
| `question_set` | 12 | Surveys, pulses, check-ins, scorecards, screening forms. Cadence is config. |
| `invitation` | 9 | Invite somebody to something. |
| `sync_state` | 7 | Staging and cursor state per importer. |
| `snapshot` | 6 | Point-in-time copies, addressed by object. |
| `thread` | 5 | A conversation, whatever it is about. |
| `rendition` | 4 | Derived media off one artifact: recordings, captions, transcripts, thumbnails, exports. |

### 2.1 · The session test

**If a thing is authored content, that people can be present in, and can be shared — it is not a
feature. It is the canvas.** An idea is not an entity: it is conversational history plus the files
it generated.

**75 tables** across the three schemas sit in exactly that shape and need **zero new tables**:
13 authoring containers · **15 per-feature meeting tables** · 8 attendee/invitee · 6 transcript /
recording · 16 share-and-view (six independently reinvented view-duration tracking) · 18
thread/message.

Verified, not assumed: every container kind — document, note, slides, report, dashboard, diagram,
drawing, knowledge, pitch, file, chat, standup, frame, comment — is already a value in
`CREATION_OBJECT_KINDS`; and `useMediaRoom` is keyed by an arbitrary `roomKey`, so any object can
**be** a room without **owning** a room table.

**This makes the navigation decision a schema decision.** `scratch_pad_meetings` exists only
because the pad owned its own meeting. Hoisting presence into the shell (navigation design
Phase 4) is also what deletes 15 meeting, 8 attendee and 6 transcript tables. One hoist, paid for
once.

### 2.2 · Normal form — BCNF, deliberately no further

**None of this is a normalization exercise.** Normal forms describe redundancy *within* a table,
and every one of the 1,206 tables is individually fine. You can have 1,206 flawlessly-3NF tables
and still have written `comments` forty times — no normal form catches that, which is why the
duplication check in §4 is column-signature similarity *between* tables.

**4NF/5NF decomposition is part of how the sprawl happened.** Splitting a table because two
independent multi-valued facts coexist yields two tables that are always joined back together —
formally purer, operationally a second thing to keep in step. The five per-company facet tables
are that mistake wearing a respectable name.

| Move | Effect on normal form | Bound |
|---|---|---|
| Derived → `metric_fact` | **Stricter.** A stored derived value depends on other rows, not on the key. | None needed. |
| Polymorphic `annotation` / `membership` / `share_link` | **Stricter.** Untouched by normal form; the issue is declarative referential integrity, which a naked `(kind, id)` destroys. | The `object` registry restores a real FK. Without it the move is indefensible; with it the design is *more* relationally sound than what it replaces. |
| Ledger with a denomination column | **Neutral.** Clean BCNF event table. | None needed. |
| Facet → columns on the parent | **Neutral.** A 1:1 vertical split is already 5NF; recombining stays 5NF. Never a normalization decision — a filing one. | Wide tables. `company` already carries 66 columns. |
| Kind-split → one table + discriminator | **Looser.** Single-table inheritance: subtype columns depend on `kind`, not on the key alone. A real departure from BCNF. | Collapse only when the shared column set is the *majority* of both tables (what the 0.55 threshold enforces). Subtype payload goes in a typed `attrs` JSONB or a small satellite table. **Never null-pad the union.** |
| Thin child list → array / JSONB | **Looser.** Non-atomic values break 1NF. The only outright departure. | Only when the list is never filtered, joined or aggregated independently. 26 tables; the first move to reverse if it bites. |

**Target, plainly:** domain tables in BCNF; kernel tables in BCNF except where a discriminator is
the entire point, and there the subtype payload is explicitly typed rather than smeared into
nullable columns. No 4NF or 5NF decomposition.

---

## 3 · The domains — documented as the roster

**One seat owns one bounded context.** The navigation design argues the team panel *is* the
navigation because ownership already exists in the data; this section is that claim in schema
form. The roster is the module list.

**Holding rule: one table, one domain.** Cross-domain reads go through the kernel or a named view,
never a direct join into another domain's tables. That is what keeps 15 modules independently
reviewable, and what gives the next feature an obvious place to put its data.

| Domain | Owner | Source | After the kernel | Last pass | **Final** |
|---|---|---|---|---|---|
| Growth & marketing | CMO | 142 | 65 | −7 | **58** |
| Delivery & work | Manager | 123 | 55 | −1 | **54** |
| Agents & runtime | platform | 75 | 41 | −1 | **40** |
| Hiring | Recruiter | 79 | 30 | −3 | **27** |
| Finance | CFO | 70 | 33 | −7 | **26** |
| Revenue & CRM | CRO | 48 | 27 | −3 | **24** |
| Commerce | platform | 58 | 24 | −0 | **24** |
| Identity & tenancy | platform | 123 | 26 | −3 | **23** |
| People & HR | HR | 74 | 25 | −2 | **23** |
| Platform & observability | platform | 137 | 16 | −0 | **16** |
| Governance & security | Security | 27 | 15 | −0 | **15** |
| Investor & portfolio | CEO | 54 | 16 | −2 | **14** |
| Support & knowledge | Support | 22 | 9 | −0 | **9** |
| Canvas & ideas | Brain | 57 | 8 | −0 | **8** |
| Integrations | platform | 41 | 1 | −0 | **1** |
| **Domain total** | | **1130** | **391** | **−29** | **362** |
| **Kernel** | platform | | | | **25** |
| **TOTAL** | | **1130** | | | **387** |

**Canvas at 8 and Integrations at 1 are the proof, not a gap.** Those two domains are almost
entirely kernel — the canvas *is* `artifact` + `thread` + `message` + `rendition` + `share_link`;
integrations *are* `connection` + `credential` + `delivery` + `sync_state`. A domain whose tables
all became kernel was generalised correctly.

**Redundant by shape, complementary by domain.** Counting which product each *surviving* table
came from, each dominates precisely what it was built for: hired.video owns hiring (21 of 27) and
people (18 of 23); BurnRateOS owns finance (16 of 26) and investor (10 of 14); Builderforce owns
delivery (37 of 54), agents (30 of 40) and governance (13 of 15). Three products overlapped on
*shape* almost completely and on *capability* barely at all — which is the case for merging them
rather than running them side by side.

### 3.1 · The five flattening moves

Applied globally in the passes above; what remains per domain is listed in §3.2.

| Move | Test | Becomes |
|---|---|---|
| **Facet** | One row per parent, split by which screen reads it | Columns on the parent |
| **Kind-split** | Same root word, differing by a qualifier, overlapping columns | One table + a `kind` |
| **Template / instance** | An `X_template` beside an `X` with the same columns | One row + `is_template` |
| **Derived** | A computed number with its own DDL | `metric_fact` + a scheduled rollup |
| **Thin** | ≤3 payload columns | A column, an array, or a JSONB key |
| **Lookup** | The table *is* an enum | An enum + a CHECK constraint |

<!-- GENERATED — regenerate with scratchpad/gendoc.js against the schemas -->
### 3.2 · Per-domain detail

### Growth & marketing — owned by the **CMO**

Root entity `campaign`. **142 source tables in → 65 out** (65 absorbed by the kernel, 2 by the canvas, 10 merged into a sibling). Contributed by Builderforce 13 · hired.video 23 · BurnRateOS 29.

Flattening still to apply:

- **Derived → `metric_fact`** (2): `channel_performance`, `site_traffic_daily`

### Delivery & work — owned by the **Manager**

Root entity `work_item`. **123 source tables in → 55 out** (48 absorbed by the kernel, 2 by the canvas, 18 merged into a sibling). Contributed by Builderforce 37 · hired.video 3 · BurnRateOS 15.

_No flattening left: every table here is a distinct noun with its own columns._

### Agents & runtime — owned by **the platform**

Root entity `agent`. **75 source tables in → 41 out** (28 absorbed by the kernel, 1 by the canvas, 5 merged into a sibling). Contributed by Builderforce 31 · hired.video 3 · BurnRateOS 7.

Flattening still to apply:

- **Thin → a column, array or JSONB key** (1): `agent_host_projects`

### Finance — owned by the **CFO**

Root entity `ledger_entry`. **70 source tables in → 33 out** (31 absorbed by the kernel, 1 by the canvas, 5 merged into a sibling). Contributed by Builderforce 7 · hired.video 5 · BurnRateOS 21.

Flattening still to apply:

- **Kind-split → one `plans` with a kind**: `billing_plans` = `pricing_plans` = `subscription_plans` — shared: name, description, currency
- **Derived → `metric_fact`** (3): `arr_projections`, `quota_attainment`, `rd_financials_quarterly`

### Hiring — owned by the **Recruiter**

Root entity `job_posting`. **79 source tables in → 30 out** (38 absorbed by the kernel, 1 by the canvas, 10 merged into a sibling). Contributed by Builderforce 4 · hired.video 24 · BurnRateOS 2.

Flattening still to apply:

- **Lookup → an enum + CHECK** (1): `assessment_dimension_norms`

### Revenue & CRM — owned by the **CRO**

Root entity `deal`. **48 source tables in → 27 out** (15 absorbed by the kernel, 0 by the canvas, 6 merged into a sibling). Contributed by Builderforce 6 · hired.video 9 · BurnRateOS 12.

Flattening still to apply:

- **Kind-split → one `contacts` with a kind**: `business_contacts` = `sales_contacts` — shared: name, company, email
- **Kind-split → one `searches` with a kind**: `saved_contact_searches` = `saved_searches` — shared: user_id, name, filters

### Identity & tenancy — owned by **the platform**

Root entity `party`. **123 source tables in → 26 out** (56 absorbed by the kernel, 3 by the canvas, 38 merged into a sibling). Contributed by Builderforce 8 · hired.video 10 · BurnRateOS 8.

Flattening still to apply:

- **Facet → columns on `party`** (1): `company_crm`
- **Kind-split → one `sessions` with a kind**: `auth_user_sessions` = `extension_sessions` = `sessions` — shared: user_id, user_agent, ip_address
- **Thin → a column, array or JSONB key** (1): `team_projects`

### People & HR — owned by the **HR**

Root entity `employment`. **74 source tables in → 25 out** (38 absorbed by the kernel, 1 by the canvas, 10 merged into a sibling). Contributed by Builderforce 1 · hired.video 20 · BurnRateOS 4.

Flattening still to apply:

- **Kind-split → one `enrollments` with a kind**: `course_enrollments` = `learning_path_enrollments` — shared: user_id, enrolled_at, started_at, completed_at

### Commerce — owned by **the platform**

Root entity `listing`. **58 source tables in → 24 out** (32 absorbed by the kernel, 0 by the canvas, 2 merged into a sibling). Contributed by Builderforce 4 · hired.video 10 · BurnRateOS 10.

_No flattening left: every table here is a distinct noun with its own columns._

### Investor & portfolio — owned by the **CEO**

Root entity `company`. **54 source tables in → 16 out** (21 absorbed by the kernel, 7 by the canvas, 10 merged into a sibling). Contributed by Builderforce 3 · hired.video 1 · BurnRateOS 12.

Flattening still to apply:

- **Kind-split → one `scenarios` with a kind**: `mvp_scenarios` = `validation_scenarios` — shared: name, description, status

### Platform & observability — owned by **the platform**

Root entity `signal`. **137 source tables in → 16 out** (92 absorbed by the kernel, 3 by the canvas, 26 merged into a sibling). Contributed by Builderforce 7 · hired.video 3 · BurnRateOS 6.

_No flattening left: every table here is a distinct noun with its own columns._

### Governance & security — owned by the **Security**

Root entity `control`. **27 source tables in → 15 out** (9 absorbed by the kernel, 1 by the canvas, 2 merged into a sibling). Contributed by Builderforce 13 · hired.video 2 · BurnRateOS 0.

_No flattening left: every table here is a distinct noun with its own columns._

### Support & knowledge — owned by the **Support**

Root entity `ticket`. **22 source tables in → 9 out** (12 absorbed by the kernel, 1 by the canvas, 0 merged into a sibling). Contributed by Builderforce 6 · hired.video 0 · BurnRateOS 3.

_No flattening left: every table here is a distinct noun with its own columns._

### Canvas & ideas — owned by the **Brain**

Root entity `creation_session`. **57 source tables in → 8 out** (46 absorbed by the kernel, 1 by the canvas, 2 merged into a sibling). Contributed by Builderforce 6 · hired.video 2 · BurnRateOS 0.

_No flattening left: every table here is a distinct noun with its own columns._

### Integrations — owned by **the platform**

Root entity `connection`. **41 source tables in → 1 out** (33 absorbed by the kernel, 0 by the canvas, 7 merged into a sibling). Contributed by Builderforce 1 · hired.video 0 · BurnRateOS 0.

_No flattening left: every table here is a distinct noun with its own columns._

---

## 3.3 · The last pass — 391 → 362, and where the machine stops

The five moves ran globally before the domains were drawn; §3.2 lists what each domain had left.
Running them again over the 391 survivors, then re-running the duplication test, gives three
passes with very different standing. **Read the third one differently from the first two.**

| Pass | What it is | Removed |
|---|---|---|
| **A — residual flattening** | The five moves re-applied per domain, with kind-split gated at the 0.55 shared-column rule | **−9** |
| **B — cross-cutting noun collapse** | Same head noun, qualifier is a value of one dimension, mean column kinship ≥ 0.25 | **−2** |
| **C — adjudicated** | Same noun, *no* column kinship — because two teams wrote the same fact in different shapes | **−18** |

Passes A and B are reproducible: re-run the scripts and you get the same 11 tables.
**Pass C is twelve named judgements**, each with the evidence that justifies it. Reject any line
and the total moves by exactly its count.

| Collapses into | Tables removed | Why the machine could not see it |
|---|---|---|
| `campaign` (+ channel) | `marketing_push_campaigns`, `ri_campaigns`, `sales_campaigns` | Each is a named send to an audience with a status and reply counters; three teams named the counters differently |
| `enrollment` (sequence) | `outplacement_enrollments`, `nurture_flow_enrollments`, `recruiter_outreach_enrollments` | All four are person + sequence + status + `current_step` + `next_send_at` |
| `scenario` (+ kind) | `forecast_scenarios`, `what_if_scenarios`, `validation_scenarios` | Assumptions in, projected numbers out. `break_even_scenarios` survives as the root; its cost columns become assumption keys |
| `brand_kit` | `marketing_brand_kits` | One stores colour and font as columns, the other as a `colors` JSON — the same fact in two shapes, so column overlap reads as 0.11 |
| `board` | `kanban_boards` | Both are a named lane container scoped to a team or project. **Zero** column overlap: Builderforce stores policy, BurnRateOS stores dates and budget |
| `deal` (+ kind) | `recruiter_deals` | Both carry `pipeline_id`, a stage, an owner and a fee — a placement fee is a deal |
| `plan` | `pricing_plans` | Third member of `billing_plans` = `subscription_plans`; missed because `pricing` is also a head noun elsewhere |
| `enrollment` (learning) | `learning_path_enrollments` | Its columns are a strict subset of `course_enrollments` |
| kernel `work_item` | `features` | `reach`, `impact`, `confidence`, `effort`, `rice_score` — a scored idea is a work item of kind `feature` |
| kernel `setting` | `account_features` | `account_id` + `feature_id` + `is_enabled` + consent fields is an entitlement grant |
| kernel `relation` | `learning_path_courses` | `path_id` + `course_id` + `display_order` + `is_required` is an ordered join row |
| kernel `metric_fact` | `marketing_sessions` | `visitor_id`, `landing_path`, `referrer`, `utm`, `converted` — an analytics visit, not an entity |

**The three tables the machine kept, and should have.** `promo_projects` is a client creative
*order*, not a project. `modules` is a permission module, `course_modules` a chapter.
`mvp_scenarios` carries pricing model, team size and timeline constraint — a business-model
variant, not a financial projection. Same word, different noun, in all three.

### The duplication test now passes on its own output

Re-running the IDF-weighted signature check across all 382 survivors of passes A and B:

| Band | Pairs |
|---|---|
| ≥ 0.55 (the CI gate) | **0** |
| 0.35 – 0.55 | 0 |
| 0.30 – 0.35 | 4 |

The four are `marketing_leads` ~ `sales_leads` (already merged in pass B),
`follow_up_enrollments` ~ `recruiter_outreach_enrollments` (merged in pass C),
`landing_pages` ~ `website_pages`, and one false positive
(`job_applications` ~ `queue_job_to_resume`, matching on the word *job*).

**A clean signature test is not proof of a clean model, and that is the finding.** The same run
that returned zero pairs above 0.55 also found **56 head nouns living in two or more domains**.
The signature test finds tables that *look* alike; it is blind to tables that *mean* alike —
`boards` and `kanban_boards` share not one payload column. That is the ceiling stated in §7,
measured: the machine gets to 405 and the last 18 need a person who knows the domain.

---

## 4 · Validation — the model is checkable before a line of application code

The model is not "validated" by review. It is validated by five machine checks that run in CI
against the target schema, plus one coverage proof.

| Check | Invariant | Fails when |
|---|---|---|
| **Coverage** | Every one of the 1,130 source tables maps to a target | A capability was dropped silently. Current state: 1,130 mapped, **0 unaccounted**, and the 362 distinct `keep` targets reconcile with the domain roster row-for-row. |
| **Tenancy** | Every table carries `tenant_id NOT NULL` | 162 BurnRateOS models carry `company_id` and no tenant column; every gate in the platform runs on tenant. |
| **Referential integrity** | Every polymorphic `(kind, id)` references `object` | A generic table can orphan rows the old per-entity table could not. |
| **Shape lint** | No table outside the kernel implements a kernel shape | Someone adds `X_comments`. This is the rule from §0 as a test. |
| **Domain boundary** | No query joins across two domains without going through the kernel or a named view | The 15 modules stop being independently reviewable. |
| **Signature duplication** | No two tables exceed 0.55 IDF-weighted column-signature similarity | The next `boosts` / `company_boosts` / `job_boosts` gets caught at review, not two years later. |

The last one is the important one: **the analysis that produced this document becomes a test.**
It found 35 duplicate clusters, 23 of them inside a single codebase. Running it in CI is what
stops the 24th.

---

## 5 · Sequence — what to do, in order, starting now

Two of these steps are **not blocked** on §6. Do those first; they are what makes the blocked
steps safe.

### Step 0 · Six checks landed as ratchets against today's schema — ✅ **DONE 2026-08-08**

The checks in §4 did not need the target schema to exist. Run against the current
`api/src/infrastructure/database/schema/*.ts` (374 `pgTable` declarations across 16 modules) each
reports a **baseline** that can only shrink. That is the existing repo pattern — `api/package.json`
already chained eleven such guards before `vitest run`; it now chains seventeen.

All six ride the existing `scripts/lib/drizzleSchema.mjs` parser (**no new parser was written**),
and share one new `scripts/lib/ratchet.mjs` for the baseline file format, the `--update` flag and
stale-entry reporting — extracted from the pattern `check-tenant-scope.mjs` and
`check-migrations.mjs` already used by hand.

| Script in `api/scripts/` | **Baseline it printed** |
|---|---|
| `check-signature-duplication.mjs` | **8** duplicate-shape clusters at ≥0.55 |
| `check-shape-lint.mjs` | **93** table names matching a kernel shape |
| `check-tenant-column.mjs` | **72** tables with no tenant-scoping column |
| `check-polymorphic-fk.mjs` | **3** `(kind, id)` pairs with no `objects` registry |
| `check-domain-boundary.mjs` | **82** cross-module schema imports, including cycles |
| `check-model-coverage.mjs` | 1,130 mapped · 0 unaccounted · 362 keeps + 25 kernel = 387 |

**The eight duplicate clusters inside this repo today, before any merge:**

`drive_connections` = `mailbox_connections` · `portfolios` = `initiatives` ·
`tenant_custom_roles` = `platform_modules` · `tool_runs` = `marketing_tool_runs` ·
`tenant_manager_defaults` = `project_manager_configs` ·
`tenant_skill_assignments` = `agent_host_skill_assignments` ·
`import_type_mappings` = `board_type_mappings` ·
`kanban_template_lane_requirements` = `swimlane_requirements`

Three of those are already the target design (`drive` + `mailbox` fold into kernel `connection`;
`portfolios` / `initiatives` into `work_item`), which means **this guard would have prevented them
being written at all.** That is the argument for landing it before the merge rather than after.

`check-model-coverage.mjs` is deliberately more than a parse check: it independently recounts the
number the whole PRD rests on, and fails if the map and §3 stop agreeing. It also reports how much
of the target schema exists (**140 / 362 today**) and becomes a hard gate at 100%.

**Exit criteria:** met — `cd api && npm test` green with all six wired.

### Step 1 · Settle the model — the only genuinely blocked step

The five decisions in §6. Everything below waits on decisions 1, 2 and 5; nothing below waits on
3 or 4, which can be answered at any point before step 4.

### Step 2 · Write the target schema, kernel first, then domains ascending

Kernel (25) into a new `schema/kernel.ts`, then domain by domain in ascending final size so the
pattern is proven where being wrong is cheapest:

> Integrations 1 · Canvas 8 · Support 9 · Investor 14 · Governance 15 · Platform 16 ·
> Identity 23 · People 23 · Commerce 24 · Revenue 24 · Finance 26 · Hiring 27 · Agents 40 ·
> Delivery 54 · Growth 58

The 16 modules that exist are already most of the domain map, so this is largely a rename plus
four new files, not a greenfield:

| Existing module | Becomes |
|---|---|
| `drive.ts`, `mailbox.ts` | fold into kernel `connection` + `credential` + `sync_state` |
| `brain.ts`, `collaboration.ts` | merge → `canvas.ts` |
| `work.ts`, `delivery.ts`, `pmo.ts` | merge → `delivery.ts` |
| `runtime.ts`, `llm.ts` | merge → `agents.ts` |
| `billing.ts` | → `finance.ts` |
| `growth.ts`, `commerce.ts`, `governance.ts`, `identity.ts`, `platform.ts` | keep the name, adopt the domain boundary |
| `common.ts` | → `kernel.ts` |
| — | **new:** `hiring.ts`, `people.ts`, `investor.ts`, `revenue.ts`, `support.ts` |

**Exit criteria:** `cd api && npx tsgo --noEmit` clean, and `check-model-coverage.mjs` reports
362 targets present.

### Step 3 · Turn the ratchets into gates

Same six scripts — already written and green — now pointed at the target schema with the
baselines **emptied**. A check written after the migration is a check written to pass; these were
written in step 0 against a schema that violates all six, which is the whole point.

Baselines to drive to zero: signature-duplication 8 → 0 · shape-lint 93 → (allowlisted or 0) ·
tenant-column 72 → (global catalogues only) · polymorphic-fk 3 → 0 once `objects` exists ·
domain-boundary 82 → 0 · model-coverage 140/362 → 362/362.

**Exit criteria:** all six pass at zero with no allowlist entries.

### Step 4 · Convert

The Prisma→Drizzle codemod (PRD 19 B0) emits the **target** shape directly and stamps
`tenant_id NOT NULL` in the same pass. Converting faithfully and consolidating afterwards means
writing and reviewing the same 404 tables twice.

Migrations land in `api/migrations/` — next free prefix is **0418** — and
`check-migrations.mjs` already fails the build on any duplicate numeric prefix.

### Step 5 · Migrate the collapsible families, in this order

1. **Tokens / share links / invitations / revisions** — small, self-contained, prove the pattern.
2. **The ledger** — 59 tables, real money, do it once the pattern is proven and not before.
3. **Events and connectors** — migrations 0295 and 0410 are the in-repo precedent to copy.
4. **The nine contested capability areas** — last, because they are operator decisions.

### Step 6 · Build the application, domain by domain, each behind its seat

Steps 0–5 are the data model. Step 6 is the product. **Nothing in step 6 starts before step 3
passes at zero**, because every shortcut taken in the schema is paid for in every feature built
on it.

### Who is waiting on whom

| Step | Blocked by | Can start |
|---|---|---|
| 0 · checks as ratchets | — | ✅ **done 2026-08-08** |
| 1 · settle the model | operator (§6) | **now** |
| 2 · target schema | step 1 | after §6 decisions 1, 2, 5 |
| 3 · gates at zero | step 2 (step 0 done) | — |
| 4 · convert | step 3 | — |
| 5 · migrate families | step 4 | — |
| 6 · build | step 3 at zero | — |

---

## 6 · Open — operator decisions

1. **Which of the 25 kernel primitives are accepted.** Each is independently rejectable; the
   published analysis lets you toggle any of them and see the resulting count.
2. **Which product wins each of the nine contested capability areas** — kanban, marketplace,
   objectives, SOC 2, support, affiliates, bookings, company, pitch decks. Settled per row in
   [PRD 19 §2](./19-prd-burnrateos-consolidation.md); the schema work behind each is small once
   the decision exists.
3. **`account_*` or `tenant_*`.** BurnRateOS's 11 and Builderforce's 17 are the same axis under
   two words. Renaming is free now; not renaming means every future reader learns both.
4. **The database tier.** 387 tables is a different bill from 78.
5. **The twelve adjudications in §3.3.** They are the last 18 tables and the only part of the
   count that is judgement rather than measurement. Each is independently rejectable.

---

## 7 · Method and its limits

- **Exact:** the 1,206 / 1,130 counts, the 79 name collisions, the column distribution, and the
  coverage map. All parsed from source, brace-matched. An earlier pass under-counted hired.video at
  215 by matching only single-line declarations.
- **Inferred:** assignment to primitives, by an ordered name-and-shape classifier, first match
  wins. A deterministic 32-sample spot check found **3–4 misfiled, every one into an adjacent
  primitive** rather than into "should have stayed separate". The 564 aggregate is robust; the
  per-primitive split carries ~10% noise.
- **Judgement:** the domain assignment (prefix rules, then a token vocabulary, then eight placed by
  hand) and the residual dedupe. ~5% noise — `admin_impersonation_sessions` landed in Growth,
  `geocoder_cache` in Agents. It does not move the totals.
- **Judgement, isolated and countable:** the twelve adjudications in §3.3 — **18 of the 387**.
  They are quarantined in their own pass precisely so the headline can be read two ways: the
  machine floor is **405**, the model as proposed is **387**. Nothing else in this document
  depends on accepting them.
- **Not done:** this reads no row counts, no index usage, no query plans. Two tables can look
  identical and diverge for a good reason nobody wrote down. **Every primitive needs one engineer
  with the domain in their head to confirm before its migration is written.** The analysis narrows
  1,206 candidates to about 40 clusters worth an hour each — it says where to look, not what to run.
