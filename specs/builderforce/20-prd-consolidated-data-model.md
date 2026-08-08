# PRD 20 — The Consolidated Data Model, the API on it, and the Experience on that

> **Status:** §5 Step 0 is built and green; everything after it awaits the operator decisions in §8.
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
`boards` and `kanban_boards` share not one payload column. That is the ceiling stated in §9,
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

Two of these steps are **not blocked** on §8. Do those first; they are what makes the blocked
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

The five decisions in §8. Everything below waits on decisions 1, 2 and 5; nothing below waits on
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

### Step 6 · Collapse the middle layers onto the same fifteen modules (§6)

Not "build the API" — the API exists. What does not exist is the module boundary: 101 application
folders and 197 route files sitting on 16 schema modules. Per domain, in the same ascending order
as step 2: **one application service, one route group, one domain folder**, and the kernel exposed
once (§6.3) instead of the six-to-forty times each of its routes exists today.

Every domain moved this way also pays down `check-layering.mjs` — baseline 144 presentation files
still importing infrastructure — because a route that calls one application service has no reason
to import a table.

**Exit criteria:** application folders 101 → 16, route groups 197 → 16, layering baseline at 0.

### Step 7 · Build the experience on the kernel components (§7)

Fifteen domain surfaces plus the canvas, composed from the kernel components in §7.1 — one
timeline, one conversation, one viewer, one comment thread, one share sheet, one form runner, one
chart primitive. Not 134 rewritten pages.

Each surface ships to the §7.2 standards in the same pass: both themes, fluid to 360px, localised
in all five catalogs, shared components deciding their own visibility.

**Nothing in steps 6 or 7 starts before step 3 passes at zero**, because every shortcut taken in
the schema is paid for in every feature built on it — and, per §7.1, in every component too.

### Who is waiting on whom

| Step | Blocked by | Can start |
|---|---|---|
| 0 · checks as ratchets | — | ✅ **done 2026-08-08** |
| 1 · settle the model | operator (§8) | **now** |
| 2 · target schema | step 1 | after §8 decisions 1, 2, 5 |
| 3 · gates at zero | step 2 (step 0 done) | — |
| 4 · convert | step 3 | — |
| 5 · migrate families | step 4 | — |
| 6 · collapse API layers (§6) | step 3 at zero | — |
| 7 · build the experience (§7) | step 6 | — |

---

## 6 · The stack — one domain, four layers, one seat

The data model is the bottom of a stack, not the whole of it. The api already **declares** the
layering — presentation → application → domain, with infrastructure behind the domain's repository
interfaces — and `check-layering.mjs` already enforces the rule that matters most
(`src/presentation/` may not import `src/infrastructure/`). What has drifted is not the layer
contract. It is the **module boundary inside each layer**.

| Layer | Unit today | Count today | Target |
|---|---|---|---|
| Infrastructure · schema | module file | **16** | 16 — 15 domains + kernel |
| Domain | folder | **16** | 16 |
| Application | folder | **101** | 16 |
| Presentation | route file | **197** | 16 route groups |
| Frontend | `page.tsx` | **134** | 15 seats + the canvas |

Sixteen at the bottom, 101 in the middle, 197 above it. That spread is the same disease as the
1,206 tables, one layer up: a feature arrives and, rather than joining a module, brings its own.

**The rule that makes N-layer real here: a domain is a vertical slice; a layer is a horizontal
cut; a module is where they intersect.** Fifteen domains × four layers = sixty modules, each
reviewable on its own, each traceable to one seat on the roster.

### 6.1 · What each layer owns

| Layer | Owns | Must not know |
|---|---|---|
| **Infrastructure** | The 387 tables (§2, §3), migrations, the `getOrSetCached` L1+L2 read-through, R2/KV access | HTTP. What a route is. What a user sees. |
| **Domain** | Invariants, value types, the `kind` taxonomies, state machines | Drizzle. Hono. Any vendor. |
| **Application** | Use cases, ports, tenancy enforcement, cache keys and invalidation | Request and response shapes. |
| **Presentation** | HTTP: parse, authorise, call one application service, serialise | SQL. Table names. |

**The domain layer is the one this consolidation actually fixes.** It holds 40 files against the
application layer's 643 — an anemic domain, because when a concept is spread across 25 tables
there is nothing coherent to put invariants *on*. A single `work_item` with a `kind` has real
invariants (a key result cannot be its own parent; a milestone has no assignee) that twenty-five
separate tables could only express twenty-five times, or not at all. **Collapsing the schema is
what gives the domain layer something to be.**

### 6.2 · SOLID, as decisions already made in this document

Not the textbook version — each of these is a specific line in §2 or §3, and each has a guard.

- **Single responsibility.** One seat owns one domain (§3). This is why `scratch_pad_meetings` was
  wrong: the pad had two responsibilities, authoring and presence, so it grew a second table for
  the second one.
- **Open/closed.** The kernel *is* the open/closed test, and the platform has passed it three
  times already: adding a connector vendor adds a manifest row, not DDL (0410); adding an artifact
  kind adds a value to `CREATION_OBJECT_KINDS`, already at 74; adding an audit source adds an
  `activity_log` row, not a table (0295). **Extension without modification, proven in-repo before
  it was proposed here.**
- **Liskov.** This is the constraint behind §2.2's 0.55 rule, and it is worth naming as such: a
  kind-split subtype must be substitutable for the base in every query written against the base.
  That is precisely why the union must never be null-padded and why subtype payload goes in a
  typed `attrs` — a base query that silently returns rows full of meaningless nulls is an LSP
  violation wearing a schema.
- **Interface segregation.** The `object` registry is deliberately the narrowest possible
  interface: identity and kind, nothing else, so `annotation`, `membership` and `share_link`
  depend on almost nothing. The counter-example has a number: **144 presentation files still
  import infrastructure directly**, each depending on the entire schema to read three columns.
- **Dependency inversion.** Already the house pattern — `DriveProvider`, `MailboxProvider`,
  `BoardProvider`, `PolicyGate` are ports with swappable adapters. The rule to hold: the domain
  layer depends on the interface, the application layer chooses the adapter, infrastructure
  implements it.

### 6.3 · The API surface falls out of the roster

One route group per domain, one application service per domain, and the kernel exposed once
rather than fifteen times:

```
/api/<domain>/…                    15 groups, each owned by one seat
/api/objects/:id                   the registry — resolves any addressable thing
/api/objects/:id/activity          one timeline endpoint, not one per subsystem
/api/objects/:id/annotations
/api/objects/:id/members
/api/objects/:id/shares
/api/objects/:id/revisions
```

Every one of those kernel routes exists today between six and forty times under different names.
**A new read endpoint must either be served through `getOrSetCached` or state why it cannot** —
enforceable per-domain only because the cache key can finally be derived from
`(tenant, domain, object)` instead of from whichever table the feature happened to invent.

---

## 7 · The experience — the roster is the navigation

The navigation design argues that the team panel *is* the navigation, because ownership already
exists in the data. §3 is that claim in schema form. This section closes the loop: **the fifteen
domains and the fifteen seats are the same list, and neither may drift from the other.**

- **The canvas is the front door.** Not a feature behind a nav item — §2.1's session test says
  authored content plus presence plus shareable *is* the canvas, so the schema has no scratch pad
  to route to. The UI matches: there is one canvas, and everything else is a lens on it.
- **Progressive disclosure gates state, never capability.** The team roster is always listed; only
  the scope chips are earned, through one `earned(rung)` helper. A dimmed CFO is an invitation; a
  missing CFO is a secret. Schema equivalent: a domain's tables exist whether or not the tenant
  has reached the rung that lights them up.
- **Recents is derived, never a stored list.** Only possible because `object` + `activity_log`
  exist: one query answers "what did I touch", where today it would need a union across thirty
  tables and would silently miss the thirty-first.
- **The collapse seam.** Compress what is identity (initials stay legible at 21px → the rail), fly
  out what is text (titles → the flyout). One overlay serves both tooltip and list; a
  `ResizeObserver` sets the same state the toggle sets, through one `rail()` helper.
- **The public shell is a classification, not a copy.** `classifyShell()` returns one of four
  shell kinds from a deny-list default, so a new marketing page cannot accidentally render
  logged-in chrome.

### 7.1 · The UI dedupe is downstream of the schema dedupe

This is what justifies doing the data model first. Every kernel primitive collapses a family of
components, not just a family of tables:

| Kernel primitive | Component it makes singular |
|---|---|
| `object` | One detail route. One breadcrumb. One "open in canvas". |
| `activity_log` | **One** timeline component, instead of a per-subsystem feed. |
| `thread` + `message` | One conversation surface — chat, comments, support, ceremony notes. |
| `artifact` + `rendition` | One viewer with kind-specific renderers, instead of ~30 per-media pages. |
| `annotation` | One comment thread, mountable anywhere. |
| `share_link` | One share sheet with one revocation path — there are three API-key revocation paths alone today. |
| `question_set` + `response` | One form runner for surveys, pulses, check-ins, scorecards and screening. |
| `metric_fact` | One chart primitive fed by one shape, which is what makes "insights everywhere" affordable. |

134 `page.tsx` routes exist today. The target is not 134 rewritten pages — it is **15 domain
surfaces plus the canvas**, each composed from the kernel components above. Building the UI first
would mean building those components against thirty different shapes and then rebuilding them.

### 7.2 · Non-negotiables for every surface built on this

Existing platform standards, restated because §5 step 6 is where they get honoured or quietly
skipped:

- **Both themes, every surface.** All colour through theme tokens — never a literal that reads in
  only one theme — with contrast verified in both.
- **Mobile-first fluid layout.** No fixed pixel widths that overflow near 360px; horizontal scroll
  only where intended, such as a wide table inside its own `overflow-x` container.
- **Localised in the same pass.** Every visible string through `next-intl`, with real translations
  in all five catalogs (`en`, `zh`, `es`, `fr`, `de`) — not English copies.
- **Shared components decide their own visibility.** No prop-drilled `canX` booleans a consumer
  could compute; an unentitled component returns null on its own authority. The same DRY rule §0
  states for tables, one layer up.

---

## 8 · Open — operator decisions

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

## 9 · Method and its limits

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
