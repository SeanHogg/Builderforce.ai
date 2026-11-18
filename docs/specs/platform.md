# 🧰 Platform — enabling work outside the arc

> **Domain PRD — open work only.** Consolidated 2026-11-17 from the per-PRD specs that used to live in
> `docs/specs/NN-*.md`; every section was verified against the code that day. This file holds only
> what is left to build. Finished sections are archived word for word in `DONE.md` ("✅ RESOLVED 2026-11-17 — PRD NN:
> finished sections archived on consolidation"), with their § numbers kept, so a citation such as
> `PRD 38 §4.3` resolves to the `## PRD 38` section here (open) or to DONE.md (shipped).
> A gap in a PRD's numbering is a shipped section. Outstanding work is tracked in `ROADMAP.md` under **🧰 Platform**.

**Holds:** Data model, the UI design system and collection view, browser performance, identity and integration federation, infrastructure, search, typed ids, cutover.

## Contents

- [PRD 20 — The Consolidated Data Model, the API on it, and the Experience on that](#prd-20--the-consolidated-data-model-the-api-on-it-and-the-experience-on-that)
- [PRD 05 — Integration, Embed-Back & Identity Federation](#prd-05--integration-embed-back--identity-federation)
- [Design — Typed entity ids](#design--typed-entity-ids)
- [PRD 21 — The Unified Experience: one design system, one canvas shell (start here for any UI work)](#prd-21--the-unified-experience-one-design-system-one-canvas-shell-start-here-for-any-ui-work)
- [PRD 47 — One Collection view: Card | List, selection, bulk Delete/Archive/Merge, server paging and sort](#prd-47--one-collection-view-card--list-selection-bulk-deletearchivemerge-server-paging-and-sort)
- [PRD 22 — Browser Performance, Domain Execution, and Codebase Health](#prd-22--browser-performance-domain-execution-and-codebase-health)
- [PRD 39 — Platform close-out](#prd-39--platform-close-out)
- [Design — Internet search subsystem](#design--internet-search-subsystem)
- [PRD 18 — hired.video → Builderforce.ai port (cutover and retirement)](#prd-18--hiredvideo--builderforceai-port-cutover-and-retirement)

---

## PRD 20 — The Consolidated Data Model, the API on it, and the Experience on that

> Consolidated 2026-11-17 from `docs/specs/20-prd-consolidated-data-model.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 20: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.
> The experience layer (where a domain appears, to whom) is owned by PRD 21. The coverage map stays at
> `docs/specs/data-model/source-to-target.tsv`; `api/scripts/check-model-coverage.mjs` reads it.

### §0 The rule
**A feature may add domain tables. It may not add another instance of an existing shape.**
Needing comments earns a row kind, not a comments table; needing a balance earns a denomination, not a
balance table; needing an integration earns a manifest row, not a connections table. Enforced by
`check-shape-lint.mjs` (verdicts argued in `api/scripts/adjudications/shape-lint.mjs`).

### §2 The kernel — 25 tables, owned by no domain
Every domain uses these. No domain may fork one.

**Remaining (verified 2026-11-17):**
- `runs` (`api/src/infrastructure/database/schema/kernel.ts:962`) and `work_items` (`kernel.ts:918`) have no feature writer — no `insert(runs)` / `insert(workItems)` anywhere in `api/src`; only the generic entity layer (`application/domains/kernel/entities.ts`) touches them. Move a real job/execution writer and the task/epic/objective writers onto them, or record why not.

### §3.2 Per-domain detail — residual flattening
**Remaining (verified 2026-11-17):** the coverage map files these as flattened/merged, but the schema still declares them:
- **Derived → `metric_fact`:** `site_traffic_daily` (`schema/growth.ts`), `rd_financials_quarterly` (`schema/finance.ts`).
- **Thin → column/array/JSONB:** `agent_host_projects`, `team_projects` (`schema/delivery.ts`).
- **Kind-split:** `business_contacts` (`schema/commerce.ts:152`) = `sales_contacts` (`commerce.ts:459`); `saved_contact_searches` = `saved_searches` (`schema/revenue.ts`); `auth_user_sessions` / `extension_sessions` / `sessions` (`schema/identity.ts`) — `sessions` is ruled superseded in `api/scripts/adjudications/table-adoption.mjs` and should be dropped (expand/contract).
- Either apply each move, or flip the map row to `keep` with an adjudication — the map and schema must agree.

### §3.3 The last pass — adjudicated collapses
**Remaining (verified 2026-11-17):**
- `sales_campaigns` is still declared (`schema/commerce.ts`) though `source-to-target.tsv` reads `merged → marketing_campaigns`. Fold it into `campaign` (+ channel) or re-adjudicate.

### §4 Validation — six machine checks
| Check | Invariant |
|---|---|
| Coverage | Every one of the 1,130 source tables maps to a target |
| Tenancy | Every table carries `tenant_id NOT NULL` (global catalogues adjudicated) |
| Referential integrity | Every polymorphic `(kind, id)` references `objects` |
| Shape lint | No table outside the kernel implements a kernel shape |
| Domain boundary | No query joins across two domains without the kernel or a named view |
| Signature duplication | No two tables exceed 0.55 IDF-weighted column-signature similarity |

**Remaining (verified 2026-11-17):**
- `check-model-coverage.mjs:98` reports target-schema presence as "Reported, not required" — make it the hard gate this section promised.
- Map drift: `brain_chat_trace` is `keep` at `source-to-target.tsv:232` but was dropped by migration `1212_drop_brain_chat_trace.sql` (357 / 358 keep targets declared). `check-model-coverage.mjs:48` expects `keeps: 358, total: 383`.

### §5 Step 3 · Turn the ratchets into gates
**Exit criteria:** all six pass at zero with no allowlist entries.

**Remaining (verified 2026-11-17)** — baselines in `api/scripts/`:
- `.signature-duplication-baseline.txt`: 1 (`initiatives = portfolios`, both still in `schema/delivery.ts`; target is kernel `work_item`).
- `.polymorphic-fk-baseline.txt`: 3 (`activity_log.(target_type,target_id)`, `creation_session_objects.(resource_type,resource_id)`, `proposal_evaluations.(subject_type,subject_id)`).
- `.domain-boundary-baseline.txt`: 22 cross-module edges.
- `.table-adoption-baseline.txt`: 109 tables reachable only through the generic entity layer.
- Shape-lint and tenant-column baselines are empty but carry ~174 and 51 adjudications respectively; the "no allowlist entries" exit needs an explicit operator call on whether adjudications count.

### §5 Step 4 · Convert
The Prisma→Drizzle codemod (PRD 19 B0) emits the **target** shape directly and stamps `tenant_id NOT NULL`
in the same pass. Migrations land in `api/migrations/`; `check-migrations.mjs` fails on duplicate prefixes.

**Remaining (verified 2026-11-17):**
- No codemod exists (`api/scripts`, `scripts` contain no prisma/codemod tool). Owned by PRD 19 B0.
- Migration numbering: 8 historical prefix collisions remain (0009 0014 0018 0060 0064 0068 0075 0076).

### §5 Step 5 · Migrate the collapsible families, in this order
1. Tokens / share links / invitations / revisions. 2. The ledger. 3. Events and connectors (0295, 0410 are
the precedent). 4. The nine contested capability areas.

**Remaining (verified 2026-11-17):** the access layer is built; the rows have not moved.
- Connectors: `drive_connections` and `mailbox_connections` still own tables (`schema/integrations.ts`) instead of kernel `connections` + `credentials` + `sync_state`.
- Legacy shape tables still hold live rows — backfill, cut over and drop per family (expand/contract across two pushes).
- Drop `sessions` and `ai_usage_records` (no writer; ruled superseded in `adjudications/table-adoption.mjs`).

### §5 Step 6 · Collapse the middle layers onto the domain modules
Per domain: one application service, one route group, one domain folder; the kernel exposed once (§6.3).
**Exit criteria:** application folders → 16, route groups → 16, layering baseline at 0.

**Remaining (verified 2026-11-17):** moving the wrong way and with no owning lane — 159 folders under `api/src/application`, 337 non-test files under `api/src/presentation/routes`, `.layering-baseline.txt` at 95. Each folder/route is a per-feature behaviour move onto `application/kernel/DomainService.ts` + `presentation/routes/domainRoutes.ts`.

### §5 Step 7 · Build the experience on the kernel components
Fifteen domain surfaces plus the canvas, composed from the kernel components — not rewritten pages.

**Remaining (verified 2026-11-17):** 208 `page.tsx` under `frontend/src/app` (target: 15 seats at `/seat/[domain]` + the canvas). `RosterNav` was retired by PRD 21 §11.4.2 (`frontend/src/app/seat/[domain]/page.tsx:33`), not owed.

### §6 The stack — one domain, four layers, one seat
| Layer | Unit | Now (2026-11-17) | Target |
|---|---|---|---|
| Infrastructure · schema | module file | 22 | 15 domains + kernel (extra modules: `legal`, `operations`, `discovery`, `search`, `sync`, `runDeltas`, `runOutcomes` need a home or a roster row) |
| Domain | folder | 49 | 16 |
| Application | folder | 159 | 16 |
| Presentation | route file | 337 | 16 route groups |
| Frontend | `page.tsx` | 208 | 15 seats + the canvas |

Working rule: a domain is a vertical slice; a layer is a horizontal cut; a module is where they intersect.
Infrastructure owns tables/migrations/cache; domain owns invariants and `kind` taxonomies; application owns
use cases, ports, tenancy and cache keys; presentation owns HTTP only and imports no infrastructure.

### §6.3 The API surface falls out of the roster
```
/api/<domain>/…            one group per domain
/api/objects/:id           + /activity /annotations /members /shares /revisions
```
**A new read endpoint must either be served through `getOrSetCached` or state why it cannot.**

**Remaining (verified 2026-11-17):**
- The kernel routes exist once (`presentation/routes/objectRoutes.ts`, mounted `api/src/index.ts:752`), but the six-to-forty legacy per-feature copies are not retired or tracked.
- The `getOrSetCached` rule has no guard (no `check-*` script enforces it).
- Legacy routes register into `objects` only on the sweep (ROADMAP).

### §7.2 Non-negotiables for every surface built on this
- Both themes, every surface — colour through theme tokens only.
- Mobile-first fluid layout; no fixed widths that overflow near 360px.
- Localised in the same pass in all five catalogs (`en`, `zh`, `es`, `fr`, `de`).
- Shared components decide their own visibility; no prop-drilled `canX`.

---

## PRD 05 — Integration, Embed-Back & Identity Federation

> Consolidated 2026-11-17 from `docs/specs/05-integration-embed-and-identity.md`. Verified against code 2026-11-17: Mostly built (Builderforce side).
> Finished sections are archived in DONE.md ("PRD 05: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.
> **Decided (PRD 19, 2026-08-25):** burnrateos.com is deprecated. The host-side
> work (§4.1 BI pull, §4.4, §5.1, §5.3, host thin-shell pages, embed consent) is obsolete under that
> directive and is not carried here. What remains is the federation contract for ANY external host IdP.

### §2.1 SSO
A host IdP signs a JWT (`iss`, `sub`, `tenant`, `accountId`/`acct`, `companyId`/`co`, `role`, `persona`,
`plan`, `teamIds`, profile, `exp`). BuilderForce verifies signature + issuer + expiry, then
`resolveSegment()` maps `(tenant, account, company)` → Segment. Claims gate features and seed the credit tier.

**Remaining (verified 2026-11-17):**
- Verification is built (`api/src/application/auth/hostOidc.ts`, used by `presentation/middleware/serviceTokenAuth.ts:39`) but only `acct`/`co` are consumed (`hostOidc.ts:213`). `role`, `persona`, `plan`, `teamIds` and profile claims are never read; there is no identity cache.
- No host currently mints these tokens (ROADMAP Identity › PRD 05) — reword or retire that entry once the BurnRateOS decision is taken.

### §2.2 Tenancy enforcement (the no-bleed guarantee)
`resolveSegment(jwt)` is the only entry to data; every `/v1` handler and agent action runs inside a
`(tenantId, segmentId)` context; a token for company A can never resolve to company B's Segment.

**Remaining (verified 2026-11-17):**
- No cross-segment integration test exists (`grep no-bleed|cross-segment` over `*.test.ts` → none). Add one per `/v1` resource.
- Segmented mode is unusable: inserts on `segment_id` tables omit `segmentId`, so the 0056 fill trigger raises for a segmented tenant; no RLS, no segment roles (ROADMAP Identity).

### §3 Segment provisioning handshake
**Remaining (verified 2026-11-17):**
- §3.2: eager provisioning creates the row only; default board/deck seeding is not done (`presentation/routes/seamRoutes.ts:172-173`).
- §3.3: `PUT /v1/admin/segments/:id` stores `plan` (`seamRoutes.ts:216`) but nothing reads a segment's plan (grep `segments.plan` → none) — feature gating and credit tier per Segment are not wired.

### §6 LLM gateway — per-Segment credit
The credit ledger, tier rates and viewer projection are **scoped per Segment**.

**Remaining (verified 2026-11-17):** spend is only *reported* by segment (`application/llm/usageAttribution.ts:107`); there is no per-Segment ledger, tier or budget cap.

### §7 Security & compliance checklist (open items only)
- [ ] `resolveSegment()` is the sole data entry; no handler runs without `(tenantId, segmentId)` — see §2.2.
- [ ] Cross-Segment read is impossible (integration test: Segment A token cannot fetch Segment B rows for every `/v1` resource).
- [ ] Repo tokens vault-only; agent file access confined to the Segment's repos — no segment check in `api/src/application/repos` (grep `segmentId` → none).
- [ ] Per-Segment credit ledger; per-run/orchestration budget caps.

---

## Design — Typed entity ids

> Reference doc stays at `docs/design/typed-entity-ids.md` (code cites it). Verified 2026-11-17: Shipped except the items below.

### §4 Storage — Server contract push (drop `server_id` on mappings)
**Remaining (verified 2026-11-17):** `api/src/application/sync/syncIds.ts mappedServerKey` still prefers `server_id`; drop `sync_entity_mappings.server_id` after a backfill re-run, read `sync_id` first, stop sending `serverId` text, drop `ServerMapping.serverId` on the device. Gate: `/api/sync` push telemetry shows no client below the version that reads `syncId` (already ROADMAP).

### §7 Not in scope (logged) — api non-sync UUID sweep
**Remaining (verified 2026-11-17):** 26 api files validate route/param ids with their own UUID regex, allowlisted in `scripts/entity-id-parsing.allowlist.mjs:31-58` under `API_NON_SYNC_UUID_SWEEP`. Move each onto `isLocalId` from `packages/local-first/src/entityId.ts` and delete the allowlist block. **Not in ROADMAP.**

---

## PRD 21 — The Unified Experience: one design system, one canvas shell (start here for any UI work)

> Consolidated 2026-11-17 from `docs/specs/21-prd-unified-experience.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 21: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.
> The company directory / claim half of §11.5 and decisions §11.9.4–5 moved to the **reach** domain file.

### Working rules (binding — the live design system)

These are standing rules, not build work. They stay here verbatim; an agent builds a compliant surface from
them. The text below is PRD 21's binding rules, word for word; the errata after it override the text where the code has moved on.


### 0 · The rule

**The canvas is the product. Everything else is a panel over it.**

After sign-in a person lands on the board they last worked on and never leaves it. The left panel
lists their **sessions**. The footer holds their **team** — the always-on C-suite agents beside the
humans they invited — and dragging a teammate onto the board is how it joins the session. Every
other destination opens as a **slide-in panel over a board that stays mounted**. Only marketing,
docs and auth remain pages.

Two corollaries that decide most arguments downstream:

1. **A route may change what is on screen. It may never unmount the stage.** Presence, camera,
   screen share and an in-flight agent turn all belong to the session, and the session outlives
   every navigation.
2. **A seat is a teammate, not a menu.** PRD 20 already assigns every bounded context an owner.
   That owner is a person-shaped thing in the footer, not a nav item in a rail.
3. **An authoring runtime is a Canvas mode, not a destination.** Video, audio, image, document,
   animation, game, comic and CAD editors replace the body of the already-mounted Canvas according
   to the active object's kind. “Studio” is hired.video source provenance only. In particular,
   prompt-to-video, screen/camera capture, timeline editing, music/voice/SFX mixing, preview and
   export are one continuous Canvas workflow over one editable object; none opens a separate area.


### 2 · The design system

> **This section is the implementable reference.** An agent should be able to build a compliant
> surface from §2 alone, without reading `globals.css`. Where a value appears here and in
> `globals.css`, **`globals.css` wins** — it is the runtime source of truth and this is its
> documentation. If they disagree, that is a bug in this document; fix it here.

#### 2.0 Where everything lives

| What | Path |
|---|---|
| All tokens, both themes | `frontend/src/app/globals.css` (`:root` = dark, `html[data-theme='light']` = light) |
| React primitives | `frontend/src/components/ui/` — `Button` · `Surface` · `Badge` · `Field` · `PageHeader` · `EmptyState` |
| Primitive CSS | `globals.css`, `.ui-*` classes |
| Token guard | `frontend/scripts/check-design-tokens.mjs` → `npm run check:design-tokens` |
| Tailwind bridge | `frontend/tailwind.config.js` — the `gray-*` ramp is **remapped to theme tokens** |
| Locale catalogs | `frontend/src/i18n/messages/{en,zh,es,fr,de}.json` |
| Panel primitive | `frontend/src/components/SlideOutPanel.tsx` (`width: 'sheet' \| 'wide' \| 'full'`, `crumb`, `index`); its body is `.ui-panel-body`, the `panel` size container (§3.4) |
| Board's own palette | `frontend/src/components/creation-canvas/CreationCanvas.module.css` (`--canvas-*`, both themes) · author-picked colour: `creation-canvas/authoredColors.ts` |
| Panel host over the board | `frontend/src/components/shell/ShellPanel.tsx` |
| THE index (replaced three tab bars) | `frontend/src/components/shell/DestinationIndex.tsx` · route-driven wrapper `shell/ShellIndex.tsx` |
| The footer roster | `frontend/src/components/team/TeamBar.tsx` · client read `lib/team/useTeamRoster.ts` |
| Join-a-session payload (drag **and** keyboard) | `frontend/src/lib/team/teammate.ts` |
| Left-panel sessions | `frontend/src/components/SessionList.tsx` |
| Roster read model (api) | `api/src/application/kernel/TeamRoster.ts` → `GET /api/roster/team` |
| Panel / stage policy | `frontend/src/lib/workbenchPolicy.ts` (`panelOpen`, `panelWidth`) |
| Scale ratchets | `frontend/scripts/check-design-scale.mjs` → `npm run check:design-scale` |
| Nav data | `frontend/src/lib/navGroups.ts` |

#### 2.1 ⚠ Three naming traps that will burn an agent

1. **`--coral-*` is the brand BLUE.** The name is historical. `--coral-bright` is `#4d9eff` in dark
   and `#1d4ed8` in light. There is no coral in the brand. Do not "fix" a blue you find behind a
   coral-named token.
2. **`--cyan-bright` is the SECONDARY signal**, `#00e5cc` dark / `#0284c7` light. It is not an
   accent you may reach for freely; it marks the second thing, not any thing.
3. **`gray-*` Tailwind classes are remapped.** `bg-gray-900` resolves to `var(--bg-surface)`, so it
   already flips per theme. Never add `dark:` variants to a `gray-*` class — you will double-flip it.

#### 2.2 Colour tokens — the complete set

**Grounds — a real three-step elevation scale in both themes.**

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-deep` | `#050810` | `#f4f1ec` | Page ground |
| `--bg-surface` | `#0a0f1a` | `#fdfcfa` | Panels, the board |
| `--bg-elevated` | `#111827` | `#ffffff` | Cards, inputs, anything on a panel |
| `--surface-sunken` | `rgba(0,0,0,.16)` | `rgba(60,48,36,.045)` | Wells, chrome bands, inset rows |

**Translucent surfaces — the family the marketing pages actually paint with.** The three grounds
above are opaque. Every card on `/`, `/product`, `/pricing`, `/soc2`, `/evermind`, `/compare` and
the `RouteMarketing` teaser is instead `--surface-card`, and an agent building "from §2 alone"
would have reached for `--bg-elevated` and produced a surface that does not match a single
neighbour. Documented here because the omission, not the code, was the bug.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--surface-card` | `rgba(10,15,26,.65)` | `rgba(255,255,255,.9)` | **The default card.** Translucent over the page ground |
| `--surface-card-strong` | `rgba(10,15,26,.85)` | `rgba(255,255,255,.97)` | A card that must stay readable over imagery |
| `--surface-interactive` | `rgba(255,255,255,.08)` | `rgba(60,48,36,.07)` | Chips, ghost buttons, hoverable rows |
| `--surface-interactive-hover` | `rgba(255,255,255,.14)` | `rgba(60,48,36,.13)` | Their hover state |
| `--surface-overlay` | `rgba(0,0,0,.3)` | `rgba(60,48,36,.1)` | Scrims behind a panel |
| `--surface-coral-soft` / `--surface-cyan-soft` | — | — | Tinted wells for the brand and secondary signals |

`--surface-page`, `--surface-panel`, `--surface-raised` and `--surface` are **aliases** of
`--bg-deep` / `--bg-surface` / `--bg-elevated` / `--bg-elevated`. Prefer the `--bg-*` name; the
aliases exist so older call sites keep resolving.

**Ink.**

| Token | Dark | Light | Use |
|---|---|---|---|
| `--text-primary` | `#f0f4ff` | `#1c1917` | Body, headings |
| `--text-secondary` | `#8892b0` | `#4f463d` | Supporting copy |
| `--text-muted` | `#5a6480` | `#736961` | Metadata, placeholders, disabled |
| `--text-on-accent` | `#fff` | `#fff` | Text on an accent fill |

**Rules.** `--border-subtle` (`rgba(136,146,176,.15)` / `rgba(60,48,36,.14)`) ·
`--border-strong` (`rgba(136,146,176,.28)` / `rgba(60,48,36,.24)`) ·
`--border-accent` (`rgba(77,158,255,.3)` / `rgba(29,78,216,.32)`).

**Signals.** Each has `-text`, `-bg` and `-border` companions. `--danger-*` **aliases** `--error-*`
— one hue, defined once.

| Family | Dark | Light | Means |
|---|---|---|---|
| `--error` / `--danger` | `#f87171` | `#b91c1c` | Failure, destructive |
| `--success` | `#22c55e` | `#15803d` | Done, healthy |
| `--warning` | `#f59e0b` | `#b45309` | Blocked, needs attention |
| `--info` | `#60a5fa` | `#1d4ed8` | Neutral notice |

**Categorical hues** — for chart series, speaker tiles, run-source badges. Distinct from each other
and from the brand in dark mode. In light mode the historical teal slot deliberately aliases the
primary blue; pair categorical colour with text or an icon, as required by §2.5. Never hardcode:
they flip per theme like everything else.
`--violet-bright` `#a78bfa`/`#6d28d9` · `--indigo-bright` `#7c83fd`/`#4338ca` ·
`--emerald-bright` `#34d399`/`#047857` · `--amber-bright` `#fbbf24`/`#b45309` ·
`--red-bright` `#ff6b6b`/`#b91c1c` · `--teal-bright` `#14b8a6`/`#1d4ed8` (historical name; primary blue in light) ·
`--pink-bright` `#ec4899`/`#be185d` · `--purple-bright` `#8b5cf6`/`#7e22ce` ·
`--sky-bright` `#38bdf8`/`#0369a1` · `--yellow-bright` `#eab308`/`#a16207` ·
`--orange-bright` `#f97316`/`#c2410c`. Eleven, because the shared `CHART_PALETTE` needs ten and the
first five ran out at series six — which is why it carried raw literals until 2026-08-09.

**Ink on a computed fill.** Two more, for the surfaces whose fill is decided at runtime rather than
by the theme. `--ink-on-light` (`#16241c`, both themes) is for a surface that is light in BOTH — a
DevEx score chip is an HSL ramp at 68–88% lightness, so it is pale on slate as much as on paper.
`--ink-on-categorical` (`#0b1220` dark / `#ffffff` light) is the label printed ON a categorical
fill: the whole `*-bright` family is pale on slate and deep on paper, so that is one relationship
and one token — a chart segment cannot measure a fill that is a `var()`, and does not need to.

**Severity.** `--error-strong` (`#fb7185`/`#7f1d1d`) is the rung above `--error`. A fatal is not
"very error"; a swatch you cannot tell from the one below it is not carrying information.

**Two families that are identities rather than palette.** `--ev-*` (Evermind's brain regions) and
`--canvas-obj-*` (Canvas object kinds) are declared in `globals.css` for both themes, because more
than one surface reads each of them. Each existed as two or three drifting copies before that.

**Elevation.** Dark builds depth from **matte darkness**; light builds it from **warm neutral
shade**. `--shadow-xs` · `--shadow-sm` · `--shadow-lg`. **Accent-coloured shadow is a dark-mode
mechanic only — never use it as elevation in light.**

**Focus.** `--focus-color` (`#60a5fa` / `#1d4ed8`), `--focus-ring`
(`0 0 0 3px rgba(...,.28)`). Every interactive element shows it. Removing focus without an
equivalent visible treatment fails review.

#### 2.3 Typography — All Sans

One family. Mono is reserved, never decorative. **No serif anywhere.**

```
--font-sans / --font-display / --font-body   ui-sans-serif, -apple-system, BlinkMacSystemFont,
                                             "Segoe UI", Roboto, Helvetica, Arial, sans-serif
--font-mono                                  'SF Mono', 'Fira Code', 'JetBrains Mono', monospace
```

| Role | Size | Weight | Tracking | Line height |
|---|---|---|---|---|
| Hero | `clamp(2.6rem, 7.4vw, 5.1rem)` | 800 | `-.045em` | `.95` |
| Page title | `clamp(1.85rem, 4.4vw, 2.9rem)` | 700 | `-.033em` | `1.02` |
| Section | `clamp(1.25rem, 2.6vw, 1.62rem)` | 700 | `-.022em` | `1.15` |
| Card title | `1rem` | 650 | `-.006em` | `1.3` |
| Body | `.95rem` | 400 | — | `1.6` |
| Small / meta | `.82rem` | 400 | — | `1.5` |
| **Eyebrow** (mono) | `.68rem` | 600 | `.15em`, uppercase | — |
| **Field label** (mono) | `.62rem` | 600 | `.12em`, uppercase | — |

**Mono is for:** eyebrows, field labels, IDs, paths, counts and anything in a numeric column
(pair with `font-variant-numeric: tabular-nums`). **Mono is not for:** body copy, headings, buttons.



#### 2.4 Metrics — fixed scales, no exceptions

```
--space-1..12   4  8  12  16  20  24  32  40  48        (1,2,3,4,5,6,8,10,12)
--radius-sm/md/lg/xl/full     6px  8px  12px  16px  9999px
--control-sm/md/lg            32px  36px  44px          (44 is the touch floor)
--content-readable 1100px  ·  --content-narrow 720px
Panel widths       sheet 440  ·  wide 660  ·  full 94%
Duration           --duration-fast 120ms; nothing over 260ms
```

**Any radius not in the five-step scale is a defect.** Today there are 20+ distinct values across
26 CSS modules; §2.7's ratchet is what stops that returning.

#### 2.5 Component contracts

**`<Button>` / `<ButtonLink>`** — `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`,
`size: 'sm' | 'md' | 'lg'`, `block`, `loading`. `loading` supplies the spinner **and**
`aria-busy` — never hand-roll either. **One `primary` per action group.** `danger` is
outline-on-transparent, never a filled red button.

**`<Surface>`** — `tone: 'panel' | 'raised' | 'sunken' | 'accent'`, `padding: 'none' | 'sm' | 'md' | 'lg'`,
`interactive`. `interactive` is **only** for a surface that actually navigates or selects.

**`<Badge>`** — status metadata. Never a substitute for a heading or a button. Colour alone never
carries status: always pair with text or an icon.

**`<TextField>` / `<TextAreaField>`** — label, hint, optional marker, error wiring. A bare `<input>`
in a form is a defect.

**`<PageHeader>`** — title, description, eyebrow, actions. **`<EmptyState>`** — icon, explanation,
recovery action. Both are canonical; do not re-lay-out either at a call site.

**`<SlideOutPanel>`** *(the shell primitive — see §3.4)* — `width: 'sheet' | 'wide' | 'full'`,
`title`, `crumb`, `index?`, `onClose`. Closes on `Esc` and on scrim click. Never a modal: modals are
reserved for destructive confirmation via `useConfirm` — **never `window.confirm`**.

**`<TeamBar>`** *(new — §4)* — reads the one roster (`kind: 'human' | 'agent'`). Chips are drag
sources; the canvas is the drop target; focus + `Enter` is the required keyboard equivalent.

#### 2.6 Rules an implementing agent must follow

1. **Never a literal hex or `rgba()` at a call site.** `var(--x, #fallback)` is allowed *only* when
   `--x` is genuinely declared, so the other theme is covered.
2. **Never a `dark:` Tailwind variant.** Tokens flip themselves; a `dark:` variant double-flips.
3. **Import the primitive.** If you are writing `border: '1px solid var(--border-subtle)'` inline,
   you want `<Surface>`. 301 files got this wrong; do not make it 302.
4. **Localize in the same pass.** Every visible string — labels, placeholders, `aria-label`, toasts,
   empty and error states — through `useTranslations` / `getTranslations`, with real translations in
   **all five** catalogs. Namespace to mirror the route. Only genuinely non-translatable tokens
   (code, IDs, brand names, role acronyms per the `home.roles` precedent) stay literal.
5. **Both themes, and 360px.** Fluid layouts; horizontal scroll only where intended; tap targets
   ≥44px on coarse pointers.
6. **Respect `prefers-reduced-motion`.** Every transition and animation.
7. **Disable, never hide.** A locked destination, teammate or control stays visible and disabled
   with an upgrade path. Hiding turns "you need Pro" into "this product cannot do that".
8. **The composer is bottom-centre on the canvas.** Never in a side panel.
9. **The board declares its own palette.** The canvas is a dark art surface in both themes; do not
   quietly convert it into a shell-themed surface.
10. **Run the guards before claiming done:** `npm run check:design-tokens` and the component's tests.


#### 2.8 The decisions

- **Palette — Deep Space.** The existing `--bg-deep` / `--coral-bright` family is kept in both
  themes. Coral stays the live/record/destructive signal and never becomes the brand.
- **Typography — All Sans.** One sans family across marketing and product; mono reserved for
  eyebrows, labels, identifiers and anything with digits in a column. No serif.
- **Scale — fixed and enforced.** Radius `6 / 8 / 12 / 16 / full`; controls `32 / 36 / 44px`; the
  existing `--space-*` ramp. Panels `440 / 660 / 94%`.
- **Every colour is a token.** A literal fallback is allowed only where the variable is also
  declared, so the other theme is covered.


#### 3.4 Panels

One primitive (`SlideOutPanel`, which already exists and is the house convention), three widths:

| Width | Used for |
|---|---|
| **Sheet** (440) | Settings, Profile, `⌘K`, short forms |
| **Wide** (660) | Index + detail — Workforce's 14 sub-views, Projects' tickets |
| **Full** (94%) | Dashboards that need the room; the board is one `Esc` away |

**The panel body is a size container, and that is not a detail.** A route rendered here is the same
route that used to own the screen — it renders unchanged, which is the only reason this shell
survives the hundreds of surfaces PRD 18/19 bring. What it must not do is measure the *viewport*: a
panel at 660px inside a 2560px window means `@media (max-width: 700px)` never fires and the
destination lays itself out for a screen it does not have. `.ui-panel-body` carries
`container-type: inline-size; container-name: panel`, so a destination asks the panel instead:

```css
@container panel (max-width: 640px) { .myGrid { grid-template-columns: 1fr } }
```

Wide content (a table, a Gantt) scrolls *inside* the panel rather than pushing the drawer past the
viewport. Asserted in `unifiedExperience.test.tsx`.

The nested menu becomes the panel's **index column**, grouped by the question a person is actually
asking — *You* vs *Workspace* in Settings; *People / Working / Measure* in Workforce. Fourteen
items fit vertically; a horizontal tab bar cannot hold them.

`SectionTabs`, `PillTabs` and `AdminGroupNav` are **deleted**. Three components in, one out.

#### 3.5 URLs

Deep links keep working and keep naming a **state**, not a replacement for the stage. `/settings`
resolves to *your last board plus the settings panel open* (`?panel=settings/profile`). Sign-in,
sign-up and the OAuth return stay pages, and each **ends by landing you on your last board** —
which is what "the canvas is the front door" has to mean to be true.

#### 3.6 What stays a page

Marketing, blog, docs, pricing, legal, auth. The split is by **who is looking**: signed in means
there is a board, so everything is a panel; signed out means there is no board, so real pages with
real URLs and real SEO.


#### 5.1 Against PRD 19's tracks

E0–E2 **block B1–B9's frontend work**, and only that. A track may land its schema, its migrations
and its API against PRD 20 at any time. What it may not do is ship a surface as a page — every
track's UI arrives as a panel and registers its destination once, in the pass that lands it.


#### 11.0 The rule

**A destination appears in exactly one registry, is named exactly once, and is placed by two facts
it already carries: its OWNER (which seat) and its STAGE (idea · make · run).**

1. **The left panel is the arc.** Idea → Make → Run, plus Measure, Market and Admin. It answers
   *where am I in the journey* — the only question a first-time visitor can actually ask.
2. **The footer is the roster.** One chip per seat, always listed. It answers *who owns this*. A
   seat is never *also* a nav item — §4 settled that, and the code currently does it twice.
3. **A destination never points at a marketing page from inside the app.** The signed-out twin is a
   field on the same row, not a second registry.
4. **The marketplace is the second front door.** Canvas is "I have an idea". Marketplace is "I have
   a business". Both end in the same place: a company you run with the whole Run stack behind it.


#### 11.10 What the merge adds to the design system

§2 settles palette, type and scale for one product. Consolidating two products' menus adds exactly
three token families, and each one exists for the same reason: **a value that was being re-invented
per surface now has more than one reader.** Nothing here introduces a new colour — every value is
drawn from the eleven categorical hues §2.2 already declares.

##### 11.10.1 Seat hue — `--seat-*`

BurnRateOS assigns each domain a Mantine colour on its marketing cards. Builderforce's roster picks
its own. The canvas picks a third for agent objects. Twelve seats × three surfaces is how a CFO
ends up green in one place and blue in another, and it is the colour equivalent of the four-name
problem §11.1 describes.

**One declaration, both themes, five readers** — the roster chip, the nav row's seat badge, the
panel's top rule and index marker, the marketing card, and any chart series broken down by owner.

| Seat | Token | Categorical hue |
|---|---|---|
| CEO | `--seat-ceo` | violet |
| CFO | `--seat-cfo` | emerald |
| CRO | `--seat-cro` | amber |
| CMO | `--seat-cmo` | pink |
| CTO | `--seat-cto` | sky |
| CPO | `--seat-cpo` | yellow |
| HR | `--seat-hr` | primary blue in light (historical `--teal-bright` alias) |
| Recruiter | `--seat-recruiter` | orange |
| Security | `--seat-security` | red |
| Support | `--seat-support` | purple |
| Manager | `--seat-manager` | indigo |
| Brain | `--seat-brain` | the brand blue |

Twelve seats consume exactly the eleven categorical hues plus the brand — which is why §2.2's
eleventh hue was needed and is now spent. **A thirteenth seat needs a twelfth hue before it needs a
menu entry**, and that is a deliberate constraint on how many always-on seats the product grows.

Soft fills derive with `color-mix(in srgb, var(--seat-x) 12%, transparent)` rather than twelve more
tokens: the mix follows the base through both themes, so there is still one declaration per seat.

##### 11.10.2 Brand gradient — `--grad-brand`, `--wash-hero`

Ported from `burnrateos.com/features`, and deliberately restricted to **two positions on a page**:
the hero word-mark and the closing CTA band. `--wash-hero` is its ~8% tint for the hero ground.
Everything between them stays flat. A gradient that also appears on cards stops meaning *this is
the beginning or the end of the page* and becomes decoration, which is the failure mode §2.6 rule 1
guards against for colour generally.

##### 11.10.3 Marketing band rhythm

BurnRateOS ships **95 marketing pages built from `MarketingPageShell` plus six section primitives**
(Hero / FeatureGrid / NarrativeSplit / FAQ / FinalCTA / PartnerBadge). **Port the system, never the
pages** — hand-authoring a third marketing system is how a product gets a fourth.

The rhythm, which the Features page is the reference implementation of:

```
wash (hero + overview card)  →  tint (domain grid)  →  raised (foundations, dashed cards)
   →  tint (tier table)  →  raised (FAQ)  →  gradient (final CTA)
```

Five content bands and a close. A page that needs a sixth content band is two pages. The primitives
carry `.mk-*` names and sit beside the existing `.ui-*` set, because a marketing section and a
product surface are different contracts and merging their class namespaces is how `.card` came to
mean three things.

**Two DRY consequences worth naming, both visible in the mockup:**

1. **The features page is a registry projection.** Every domain card's title, seat badge, seat hue,
   stage pill and feature bullets come from the same array the left panel reads — so a features
   page cannot advertise a capability under a name the product does not use. This is the same rule
   as §11.4.6, applied to the page rather than the menu.
2. ~~**The FAQ disclosure is the nav disclosure.**~~ **Corrected on contact with the code,
   2026-08-09.** They are deliberately NOT one component. `/features` is a server component, so its
   FAQ is `<details>/<summary>` — the platform primitive, keyboard-correct and zero JS. The nav's
   stage header cannot be: it is controlled, its state persists per stage, and it has to stay shut
   when the rail collapses to icons. Forcing one component on two different contracts would have
   made the marketing page ship JavaScript to open a paragraph. Same `aria-expanded` contract, two
   implementations, and the reason is written at both call sites.

##### 11.10.3a The marketing column — added 2026-08-09

Above the band rhythm sits something the spec never named and therefore never got: **one content
column for the whole public site.**

Every page had picked its own. The header was 1320, the landing hero 1240, the domain pages 1240,
pricing / about / the deck / the demo showcase 1180, the homepage's own sections 1160, the tutorials
catalog 1160 and its hero 900, `/features` and `/compare` and `/evermind` and `/product` 1100,
`/soc2` 1080, the tools hub 980, `/book-demo` 960, `/marketplace` 100%. Nine values plus a
full-bleed. The visible consequence was not subtle: content jumped left and right as you moved
through the site, and jumped **within the homepage** between one band and the next, while the header
above it never moved.

The measure is declared once, in `globals.css`:

| Token | Meaning |
|---|---|
| `--marketing-max` | the OUTER box, gutter included — `1320px` |
| `--marketing-gutter` | `24px`, `18px` under 560px |
| `--marketing-column` | `--marketing-max` minus both gutters; for a band whose gutter is already on an ancestor |
| `--marketing-section-padding` | the vertical twin — bands had drifted the same way (9vw / 8vw / 7vw) |

`.mh-inner` reads the same two tokens, which is the whole point: **the header IS the measure**, so a
band that uses the column starts under the logo and ends under "Open the canvas", and the site
cannot drift away from its own chrome. `.mkt-in` is the primitive (`.mk-in` composes it under the
band system's own name); a band that is deliberately narrower sets `--mkt-width` rather than its own
`max-width`, so the narrow case cannot lose a source-order fight with the primitive.

Two things follow that are worth naming:

1. **The mega panel is anchored to the column, not to its trigger.** It was `left: 50%` +
   `translateX(-50%)` on `.mh-item`, and because Learn ▾ sits left of centre the panel opened
   ~70px outside the logo. `.mh-item.has-menu:has(> .mh-panel-wide)` drops its containing block so
   the panel resolves against `.mh-inner` and is pinned to both gutters — it cannot extend past the
   header's edges at any viewport, for any trigger position.
2. **A component's chrome lives inside its box.** The Meet carousel put its arrows in 64px of side
   padding *outside* the card, so the card was 128px narrower than every other band. The arrows now
   ride on the card, inset into a `--meet-panel-gutter` the panel reserves for them.

`check:design-scale` carries the ratchet (`publicColumnLiterals`, baselined at **0**): a `max-width`
or `width` typed as a literal between 900px and 1500px on a public-surface file is, by definition,
somebody re-declaring the column. Breakpoints are excluded; reading measures below 900px are not
columns and stay legal.

##### 11.10.4 What this adds to `check:design-tokens`

Three assertions, landing with M0:

1. Every seat in kernel `DOMAINS` has a `--seat-*` token declared in **both** themes.
2. No `--seat-*` value is used by more than one seat (a duplicate hue defeats the point).
3. `--grad-brand` appears at most twice per page (hero + CTA), enforced as a lint over `.mk-band`
   usage rather than a runtime check.



**Errata (verified 2026-11-17)** — these override the rules text above where the code has moved on:
- §2.0 row "Board's own palette": author-picked colour lives at `frontend/src/domains/canvas/domain/authoredColors.ts`.
- §2.0 row "Nav data": `frontend/src/lib/navGroups.ts` IS the one destination registry (not a `destinations.ts`); marketplace families are `frontend/src/lib/marketplaceFamilies.ts`.
- §2.3: replace the stale ⚠ block (source lines 227-247) with: *"The eight roles are declared as `--font-size-*` tokens in `globals.css` (`--font-size-hero` … `--font-size-field-label`) and the role classes read them. Off-scale sizes are counted by `check-design-scale.mjs` (`offScaleFontSizes`, shrink-only). Type a token, never a number."*
- §11.0 item 1: the arc is **Idea → Make → Run → Measure → Reach**, plus Admin (`market` was renamed `reach`; `navGroups.ts:55-64`).
- §11.10.4: seat-hue assertions 1–2 live in `check-destinations.mjs` (§4 of that script), not `check-design-tokens.mjs`.

### §2.3 Typography — All Sans (adoption)

The roles are now tokens; the surface has not caught up.

**Remaining (verified 2026-11-17):**
- 3,240 off-scale font-size literals remain (`frontend/scripts/check-design-scale.mjs:311`, `offScaleFontSizes`). Sweep them onto `--font-size-*` and lower the baseline with each pass toward 0.
- `.ui-page-header__description` still declares `font-size: 14px` (`frontend/src/app/globals.css:3221`) — a primitive carrying an off-scale literal.

### §2.7 / §2.9.1 Migrate onto the primitives

Moving inline styles onto `<Surface>` and the other primitives is a continuing sweep with no ratchet, because a ratchet that counts verbosity would fail builds over nothing (§2.7).

**Remaining (verified 2026-11-17):**
- 412 files still hand-roll `border: '1px solid var(--border-subtle)'` (grep over `frontend/src`); 411 import `@/components/ui`. Continue the sweep surface-by-surface, starting with surfaces the shell touches.

### §11.2 The unified model — `parent`

The registry (`frontend/src/lib/navGroups.ts`) carries `seat` and `stage`. It does not yet carry level 2.

**Remaining (verified 2026-11-17):**
- Add `parent?: string` to the row shape (`grep parent navGroups.ts` = 0). A row with `parent` is a leaf of its seat's workbench index.
- `ADMIN_GROUP_META` is still its own list (`frontend/src/lib/adminGroups.ts:33`). Absorb it as `stage:'admin'`, `parent:'admin'` rows and delete the list (§11.6, M3).

### §11.4.3 The seat workbench — where 549 destinations actually go

Level 2 is §3.4's index column, and it is `destinations.filter(d => d.parent === seat)`. Fourteen items fit
vertically; a tab bar cannot hold them — `DestinationIndex` already turns vertical past six items. **No new
component is needed for level 2.** The registry is the work; the renderers exist.

**Remaining (verified 2026-11-17):**
- The index is still each destination's own tab set; nothing projects `filter(parent === seat)`. Build it on `frontend/src/components/shell/DestinationIndex.tsx` / `ShellIndex.tsx` once rows carry `parent`.
- (The width control half shipped: `SlideOutPanel.tsx:69,115`.)

### §11.4.4 Progressive disclosure — one field, not a prop

| Rung | Left panel | Footer |
|---|---|---|
| visitor with an idea | Idea + Reach live; Make/Run **listed and dim** | all seats listed, only Brain active |
| signed in | + Recents activates | + your own row |
| tracking work | + Make and Measure activate | Manager, CPO activate |
| someone joins | unchanged | + the actual people in the room |
| **claimed or formed a company** | **+ Run activates** | CFO/CEO/CMO/CRO/HR/Recruiter/Security/Support activate |
| several companies | + company chip in the session bar | unchanged — seats are TENANT-level |

**A dim row is an invitation; a missing row is a secret.** Clicking a dim row opens its workbench in
preview — real index, real empty states, one honest line, and one button that hands you to the seat
that owns the unlock (the CEO owns company formation). This is §2.6 rule 7 applied to the menu.

**Remaining (verified 2026-11-17):**
- Reachability is ONE helper, `destinationReachable(href, isAuthenticated)` (`frontend/src/components/Sidebar.tsx:176-179`) — signed-out vs signed-in only. The "tracking work" and "claimed a company" rungs do not exist; extend the one helper rather than adding a second ladder.
- A locked row renders as an inert `<span aria-disabled>` (`Sidebar.tsx:111-121`); clicking it opens nothing. Build the preview (M5).
- The "claimed a company" rung depends on the company claim in the **reach** domain (PRD 21 §11.5.1–11.5.3).

### §11.6 What gets deleted (open rows)

| Deleted | Replaced by | Milestone |
|---|---|---|
| `ADMIN_GROUP_META` as its own list | `stage:'admin'`, `parent:'admin'` rows | M3 |

**Remaining (verified 2026-11-17):** `frontend/src/lib/adminGroups.ts:33` still declares it.

### §11.7 Sequence (open milestones)

| # | Work | Gate |
|---|---|---|
| **M3** | Seat workbench index = `filter(parent === seat)`. Absorb `ADMIN_GROUP_META` and, as PRD 19 tracks land, their leaves. | §6.3 still holds; every ported leaf has a `parent` |
| **M5** | Progressive disclosure through the one reachability helper; dim rows open a real preview. | A visitor sees every row; a claimed company activates eight seats |

M4's remaining half (company claim) is in the reach domain.

### §11.8 Acceptance criteria (open)

5. Every BurnRateOS leaf and every hired.video page group has exactly one `parent` in the registry before its track's UI ships.

**Remaining (verified 2026-11-17):** no `parent` field exists yet (see §11.2).

### §11.10.4 What this adds to `check:design-tokens` (open item)

3. `--grad-brand` appears at most twice per page (hero + CTA), enforced as a lint over `.mk-band` usage rather than a runtime check.

**Remaining (verified 2026-11-17):** no script under `frontend/scripts` references `grad-brand`; assertions 1–2 already live in `check-destinations.mjs`.

---

## PRD 47 — One Collection view: Card | List, selection, bulk Delete/Archive/Merge, server paging and sort

> Consolidated 2026-11-17 from `docs/specs/47-prd-collection-view.md`. Verified against code 2026-11-17: Partly built (W0 framework landed, zero consumers, zero ports).
> Finished sections are archived in DONE.md ("PRD 47: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.
> Builds on PRD 21 (design system, tokens, panels).

PRD 47 is almost entirely open. Its spec follows word for word, then the verified "Remaining" blocks.


**Requested by the operator (2026-11-17):** every page that shows a list or cards uses ONE shared Card | List
component, with checkbox selection + select-all, bulk **Delete / Archive / Merge** executed server-side in ONE
request (ids + tenant), pagination at **50 / 100 / 250**, a fixed header and footer with only the rows/cards
scrolling, and column sorting. List-only pages gain Card (e.g. `/projects?tab=tasks`); bespoke data pages adopt
the component (e.g. `/workforce?tab=roles`).


### 2. Scope rule

**In scope:** every surface that browses a collection of records — persisted entities (projects, tasks, roles, …)
and read-only catalogs (marketplace, blog, models, traces, audit log, report rows). Each one renders through
`<Collection>` with Card and List modes, sort, paging and a pinned header and footer. Selection and the bulk bar
appear **only** when the entity has a registered bulk port and the viewer holds the permission (§5). The
component makes that decision itself; the page passes no `canX` flag.

**Out of scope (named, with reason):**

| Surface | Why it is not a collection |
|---|---|
| `CeremonyHistoryPanel`, `CeremonyStage`, `PmVisualizersContent`, `TaskPrdTab` ViewToggles | The toggle picks a filter or a mode (ceremony kind, stage, tree/timeline, preview/raw), not a layout. `ViewToggle` with `options` stays for these. |
| `components/insights/*` lens/widget tables | Chart companions inside a widget, sized by the widget. |
| `PermissionsPanel` role × permission matrix | An editable matrix, not rows. |
| `app/import/BulkDryRunReport`, `BulkMappingTable` | Local, transient wizard state. |
| Canvas internals (`creation-canvas/*`, `domains/canvas`) | Canvas object selection is a different model. |
| Board, Calendar, Gantt views | They stay and become **extra views** on the Collection (§4.4), not replacements. |

### 3. End state

```
page (≤ ~150 lines: descriptor + filters only)
 └─ <Collection descriptor={tasksCollection} source={useServerSource(tasksPage)} filters={…} extraViews={{board, calendar, gantt}} />
     ├─ CollectionHeader      (fixed)  search · filter slot · count · sort (card mode) · ViewToggle
     ├─ CollectionBulkBar     (fixed, when selection > 0)  N selected · Select all {total} · Archive/Restore · Merge · Delete · Clear
     ├─ body                  (scrolls)
     │   ├─ CollectionTable   sticky <thead>, checkbox column, SortableTh per sortable column
     │   └─ CollectionCards   auto-fill grid, checkbox per card, header "select page" checkbox
     ├─ CollectionFooter      (fixed)  "1–50 of 4,453" · <Pagination> · per page [50|100|250]
     └─ MergeTargetPanel      SlideOutPanel: pick the record to keep → preview counts → Merge

api
 GET  /api/<entity>?page=1&pageSize=50&sort=updatedAt&dir=desc&archived=exclude|only|all&q=…   → Page<T>
 POST /api/collections/:entity/bulk   { action, ids[], targetId?, dryRun? }                  → BulkResult
       └─ runBulkAction (application/collections) → BulkEntityPort registry (one port per entity, owned by its domain)
```


The bulk bar decides its own visibility. It renders nothing when `entity` is null or the selection is empty, and
it shows each action only if the entity's capability row lists it **and** `usePermission(capability.permission)`
passes. Disabled-with-reason follows the RoleGate convention: an action is disabled, never hidden, when the
entity supports it but the viewer's role does not allow it.

#### 3.2 Behaviour contract

- **Fixed header and footer.** The header, the bulk bar, the table `<thead>` and the footer never scroll. Only the
  row or card area scrolls. `Collection` fills its parent's height. A page that is not a flex column gets a
  `max-height: calc(100dvh - var(--shell-top))` default.
- **Page sizes** are 50, 100 and 250 (default 50), persisted per surface. Changing the size, the sort or a filter
  returns to page 1.
- **Sorting.** In List mode a header click cycles asc → desc. In Card mode a "Sort by" select lists the same
  sortable columns. Sort is persisted per surface. Server sources send `sort`/`dir`. Local sources use `compare`.
- **Selection.**
  - The header checkbox selects or clears the **current page**, and shows `indeterminate` when part of the page
    is selected.
  - When the whole page is selected and `total > pageSize`, a banner offers **"Select all {total}"**. That calls
    the same list endpoint with `fields=id` (one request, ids only), capped at `BULK_MAX = 1000`. Above the cap
    the banner says so, and the action can run on the first 1000.
  - Selection survives page changes. A filter change clears it.
- **Bulk actions.**
  - **Delete:** `useConfirm({destructive:true})` with the count and the first three labels.
  - **Archive:** no confirm. A toast offers Undo (a Restore call). When the view shows archived items, Archive
    becomes **Restore**.
  - **Merge:** enabled at 2 or more selected. The slide-out picks the record to keep, shows a `dryRun` preview
    ("moves 34 tasks, 3 PRDs; 2 projects archived"), then applies.
- **One request per action**, regardless of the count. The response reports `succeeded[]` and `skipped[{id,
  reason}]`, and the toast reads "Archived 48 · 2 skipped" with the reasons expandable.
- **Archived filter.** Every entity with archive support shows a uniform Active / Archived / All segmented filter
  in the header. It maps to `archived=exclude|only|all`, the param `brainRoutes` already uses.
- **Responsive.** List mode scrolls horizontally inside the body, with the checkbox column and the first column
  sticky. Under a 640px container width the default view is Card. Tap targets are at least 40px. The layout must
  not overflow at 360px.
- **Theme.** Tokens only (`--bg-elevated`, `--border-subtle`, `--text-*`, `--coral-bright`). No literals
  (`check:design-scale`).
- **i18n.** New `common.collection.*` keys cover selection, bulk, sort, the archived filter, merge, the range
  text and the skipped reasons. Add them to en/zh/es/fr/de with real translations. Retire the duplicate
  `sessionManagement.bulk*` and `taskMgmt` hardcoded "selected" string.
- **a11y.** Row checkboxes get `aria-label` "Select {label}". The bulk bar is `role="toolbar"`. Range changes are
  announced through `aria-live="polite"`.



#### 3.3 Server contracts

**Shared types** live in `packages/interaction-contract/src/api/collection.ts`, consumed by both api and
frontend.

```ts
export const PAGE_SIZES = [50, 100, 250] as const;
export const BULK_MAX = 1000;
export interface PageQuery { page: number; pageSize: 50 | 100 | 250; sort: string; dir: 'asc' | 'desc'; archived: 'exclude' | 'only' | 'all'; q?: string }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number; sort: string; dir: 'asc' | 'desc' }
export type BulkAction = 'delete' | 'archive' | 'restore' | 'merge';
export interface BulkRequest { action: BulkAction; ids: string[]; targetId?: string; dryRun?: boolean }
export interface BulkResult { action: BulkAction; succeeded: string[]; skipped: { id: string; reason: 'not_found' | 'forbidden' | 'builtin' | 'conflict' | 'already' }[]; preview?: Record<string, number> }
```

**Paging.**
- `api/src/presentation/routes/pageQuery.ts` exports
  `parsePageQuery(c, { sorts: Record<string, Column>, defaultSort })`. It is built on `limitParam`/`offsetParam`,
  rejects any sort key outside the allowlist with a 400, and returns `{ limit, offset, orderBy, archived, q }`.
- `total` comes from `count(*) over()` in the same query, so one round trip returns both rows and total.
- Every list `GET` behind a Collection accepts the params. It returns `Page<T>` **when `page` is present**. With
  no `page` it returns its current shape, which keeps the non-UI callers (VS Code, MCP tools, agents) working.
- A `check:collection-endpoints` guard keeps the frontend honest: no Collection calls a list endpoint without
  `page`.
- **Caching:** a list already on `getOrSetCached` (projects, teams, workflow definitions) folds `page`, `pageSize`,
  `sort`, `dir`, `archived` and a `q` hash into its key under the existing version token. Bulk writes bump that
  token. Lists that are not cached today (tasks: per-row enrichment) state the reason in the route.
- **Fix the workflows list in place.** It filters in memory after an unbounded select (`workflowRoutes.ts:259-263`).
  Push those filters into SQL.

**Bulk.**
- The route is `POST /api/collections/:entity/bulk` in `presentation/routes/collectionBulkRoutes.ts`. It parses
  with zod: `ids` holds 1 to `BULK_MAX` unique strings, and `merge` needs a `targetId` that is one of `ids`. It
  then calls `runBulkAction`. It never imports a table.
- `application/collections/runBulkAction.ts` runs these steps in order:
  1. Resolve the port from the registry. An unknown entity is a 404.
  2. Check the action is in `port.capabilities`. If not, 400.
  3. `requirePermission(port.permissions[action])`.
  4. Call the port with `{ tenantId, segmentId, actor, db, env }`. The tenant is **always** the authenticated
     tenant from the JWT. The body carries no tenant id, and any id outside the tenant comes back as
     `skipped: not_found`, so the response never confirms that a record exists.
  5. `recordActivityBatch` writes one activity per succeeded id.
  6. `port.invalidate(touched)` bumps the version tokens and broadcasts.
  7. Return `BulkResult`.
- **Idempotency:** reuse `middleware/idempotentReplay.ts`. The client sends `Idempotency-Key`.
- **Rate limiting:** a bulk call costs one token in the tenant bucket. That is the fix for F6.
- **The port** is `application/collections/BulkEntityPort.ts`, and each domain implements its own under
  `application/<domain>/bulk/<entity>BulkPort.ts`:
  ```ts
  interface BulkEntityPort {
    entity: BulkEntityKey;
    capabilities: BulkAction[];
    permissions: Partial<Record<BulkAction, Permission>>;
    delete?(ctx, ids): Promise<BulkOutcome>;
    archive?(ctx, ids, archived: boolean): Promise<BulkOutcome>;   // archive + restore
    merge?(ctx, targetId, sourceIds, dryRun): Promise<BulkOutcome>;
    invalidate(ctx, touched: Touched): Promise<void>;
  }
  ```
- **One path per action.** Each port does its work set-based: `scopedToTenant(tbl, tenantId, inArray(tbl.id,
  ids))`, `bulkUpdateById` for per-row values, and `db.batch([...])` where several tables move together (Neon
  http has no interactive transaction). The existing single-record route for that entity is rewritten to call the
  same port with `[id]`. There must not be two delete implementations per entity.
- **Superadmin entities** (users, tenants, suspect accounts) use the same registry with `scope: 'admin'`. They
  are served at `POST /api/admin/collections/:entity/bulk` behind `superAdminMiddleware`. This is the only case
  where `tenantId` is a body field, and it matches the existing `backlogDispositionRoutes` pattern.

**Archive storage.**
- An entity that already represents archive keeps its column. Its port is the one adapter that translates it:
  `tasks.archived`, `projects.status`, `creation_sessions.status`+`archived_at`, `brain_chats.is_archived`,
  `specs.status`.
- An entity with no archive state gets `archived_at timestamptz NULL` plus a partial index on
  `(tenant_id) WHERE archived_at IS NULL`. This ships as **one expand migration** with no drops, so it is a single
  push under the expand/contract rule.
- A Collection list excludes archived rows by default.


### 4. Entity matrix

Legend: **D** delete · **A** archive/restore · **M** merge · — not offered (the action is hidden because the
entity does not support it).

The "Merge semantics" column says what moves to the kept record. Every merged-away source is archived (or
tombstoned with `merged_into_id` where the entity already uses that pattern), never hard-deleted, so a merge can
be revisited.

| Entity (bulk key) | Surfaces | D | A (storage) | M — merge semantics | Permission |
|---|---|---|---|---|---|
| `project` | /projects, /dashboard | hard (existing `deleteProject`) | `status` | tasks, specs, integrations, creation sessions, role assignments → target | `PROJECT_DELETE` / `PROJECT_WRITE` |
| `task` | /projects?tab=tasks, drawers | ✓ | `archived` | comments, links, subtasks, attachments → target; sources archived with a "merged into #N" note (reuse backlog-disposition `consolidate`) | `TASK_DELETE` / `TASK_WRITE` |
| `creationSession` | /create, /dashboard | soft (`status=deleted`) | `status` | existing graph merge, run sequentially **inside** the port | existing |
| `spec` (PRDs) | /prds, project drawer | ✓ | `status` | — | `SPEC_WRITE` |
| `workflow` | /workflows | ✓ | new `archived_at` | — | workflow write |
| `workflowDefinition` | workflow library | ✓ | new `archived_at` | — | workflow write |
| `team` | /workforce?tab=teams | ✓ | new `archived_at` | members and agent seats → target | team write |
| `role` (custom roles) | /workforce?tab=roles, roster | custom only (built-ins → `skipped: builtin`) | — | assignments → target role | MANAGER |
| `member` / `invitation` | /workforce | remove / revoke | — | existing consolidate in `WorkforceAgents` moves here | MANAGER |
| `contributor` | /workforce?tab=performance | — | — | existing `mergeContributors` (tombstone + revert), applied per source inside the port | existing |
| `brainChat` | chats | = archive (existing semantics) | `is_archived` | existing `consolidate` | existing |
| `chatSession` | /workforce?tab=chats | ✓ | new `archived_at` | — | — |
| `persona` (own) | /personas | ✓ | new `archived_at` | — | owner |
| `prompt` (own) | /prompts | ✓ | new `archived_at` | — | owner |
| `workspaceSkill` | /skills | ✓ | `status` | — | skill write |
| `integration` / `connection` | /settings/integrations | disconnect | — | — | integration write |
| `mcpServer` | /settings/integrations | ✓ | — | — | integration write |
| `apiKey` | /settings/api-keys | revoke | — | — | `APIKEY_WRITE` |
| `providerKey` | /settings (models) | ✓ | — | — | owner |
| `ceremonySchedule` | /projects?tab=ceremonies | ✓ | — | — | MANAGER |
| `meeting` | /workforce?tab=meetings | cancel | — | — | organizer |
| `alert` | /alerts | ✓ | new `archived_at` | — | — |
| `fact` | /facts | ✓ | — | — | — |
| `knowledgeDoc` | /knowledge | ✓ | new `archived_at` | — | — |
| `template` | /templates | custom only | — | — | MANAGER |
| `incident` | /incidents | ✓ | new `archived_at` | duplicates → target (timeline, war-room notes) | incident write |
| `rfp` | /projects?tab=rfp | ✓ | new `archived_at` | — | — |
| `errorGroup` | /quality | — | resolve-as-archive | events → target group | — |
| `recording` | /replay | ✓ | — | — | — |
| `humanRequest` | /workforce?tab=approvals | — | dismiss-as-archive | — | approver |
| admin `user` / `tenant` / `suspectAccount` | /admin | deactivate / — / revoke | — / `status` / — | — | superadmin |

Every other collection is **read-only**: marketplace sections, blog, models, startups, showcase, shoutouts,
public skills, the integrations catalog, LLM traces, audit and error logs, report and finance tables, metrics,
and leads. Those collections get Card | List, sort and paging, but no checkbox column.

#### 4.4 Extra views

`<Collection extraViews={{ board, calendar, gantt }}>` adds those modes to the ViewToggle in canonical order, and
renders the supplied component in the body slot. The header, filters and archived toggle still apply. Selection
and the bulk bar apply in Board as well (the card checkbox). Tasks and Projects keep their current Board,
Calendar and Gantt this way, and `/projects?tab=tasks` gains **Card**.


### 5. Surface migration

This is the full inventory from the 2026-11-17 analysis. Paths are under `frontend/src`. Surfaces are grouped
into waves on disjoint files so implementers can work in parallel. A surface counts as migrated only when the
page holds a descriptor and filters and nothing else: its private grid, `<table>`, pager, selection state and
toggle state are deleted.

**W0 — contracts and primitives.** These land first, and nothing migrates before they do.
- Shared types in `interaction-contract`.
- `parsePageQuery`.
- `runBulkAction`, the port registry and `collectionBulkRoutes`.
- The archive `archived_at` expand migration.
- `components/collection/*` and `lib/collectionsApi.ts`.
- The `common.collection.*` i18n keys.
- Change `PAGE_SIZE_OPTIONS` to 50/100/250.

**W1 — the operator's examples and the existing bulk surfaces.**

| Surface | File(s) | Change |
|---|---|---|
| /projects | `ProjectsContent.tsx`, `ProjectTable.tsx`, `ProjectCard.tsx` | Descriptor. Card and List with Calendar and Gantt as extras. Bulk D/A/M. Delete `ProjectTable.tsx`. `ProjectCard.tsx` (430 lines) loses its outer chrome to `CollectionCards`. |
| /projects?tab=tasks | `TaskMgmtContent.tsx` (2,771 lines) | Gains Card. Board, Calendar and Gantt become extras. The bespoke selection and the per-id status/move loops are replaced by `useCollectionSelection` and bulk ports. Status change and move become two more bulk actions on the `task` port: `setStatus` and `move`. **Split the file** into `tasks/TasksCollection.tsx` (descriptor), `tasks/TaskBoardView.tsx`, `tasks/TaskCalendarView.tsx`, `tasks/TaskGanttView.tsx`, `tasks/TaskFilters.tsx`, `tasks/useTaskBoardData.ts`. That clears the god-module entry in ROADMAP › Code health. |
| /workforce?tab=roles | `workforce/RolesView.tsx`, `RoleAssigneePicker.tsx` | Stacked cards become a Collection. Card mode keeps the role card with its Assign button and chips. List mode columns: Role, Kind (Standard/Custom), Discipline, Assignees, Actions. The template select and discipline filter move into the header slot. Bulk D (custom only) and M. |
| /create, /dashboard library | `creation-sessions/CreationLibraryPanel.tsx`, `CreationSessionTile.tsx`, `SessionBulkBar.tsx`, `useCreationLibraryActions.ts`, `libraryViewPreference.ts` | Becomes a descriptor. `SessionBulkBar`, `libraryViewPreference` and the loop actions are deleted after the extraction. "Load more" becomes pages. |

**W2 — surfaces that already have ViewToggle (group A).**
- `WorkflowsContent`, `PRDsContent`
- `workforce/WorkforceAgents` (892 lines; split into members and invitations descriptors)
- `teams/TeamsView` (642 lines; split list from detail), `TeamPeopleView`
- `humanRequests/HumanRequestsView`, `contributors/ContributorsView`
- `ceremony/CeremonySchedulesPanel`
- `hiring/HiringClient` (Board is an extra view)
- `quality/QualityDashboard`
- `settings/ApiKeysContent`
- `ProviderKeysSettings` (1,332 lines; split per provider section)
- `connectors/ConnectorsGallery`, `mcp/McpServersGallery`, `integrations/IntegrationsGallery`,
  `MailboxIntegrations`
- `app/settings/integrations/page.tsx` (drops its own `viewMode` prop drilling)
- `app/skills/SkillsClient`, `app/agents/skills/SkillsBrowser`
- `app/personas/PersonasClient` (602 lines)
- `app/prompts/PromptsPageClient`
- `app/marketplace/MarketplacePageClient` (1,161 lines; one descriptor per section), `ModelsExplorer`,
  `components/startups/StartupDirectory`
- `app/blog/BlogPageClient`
- `app/agents/integrations/IntegrationGrid`, `app/agents/showcase/ShowcaseGrid`, `app/agents/shoutouts/ShoutoutsView`
- `app/admin/LlmTracesPanel`, `admin/panels/UsersPanel`, `admin/panels/TenantsPanel`

**W3 — list-only surfaces gain Card (group B).**
- `app/alerts/AlertsClient`, `app/facts/FactsPageClient` (uses the existing server paging)
- `app/knowledge/KnowledgeTraining`, `app/projects/rfp/[id]/RfpDetailClient` (sections)
- `app/evermind/page.tsx`
- `workforce/EmpMetricsView`, `task/AccountabilityTab`
- `manager/ManagerContent` (1,138 lines; split blocked-PR and stall registers into their own descriptors),
  `ManagerBlockedPrs`, `ManagerStallRegister`
- `pm/PmoRollup`, `pm/RoiDashboard`, `pm/EpicTreeView` (its table mode)
- `security/WorkspaceAuditLogPanel`
- `replay/RecordingsTable` + `RecordingsList` (merged into one descriptor), `replay/heatmap/ElementTable`,
  `replay/funnels/SmartEventsView`
- `agent-ops/MemoryPanel`, `CoordinationPanel`, `RehearsalPanel`
- `TenantApiKeyUsageRow`, `admin/TenantApiKeysAdminTab`
- finance: `CashflowView`, `RunwayView`, `EarningsReport`, `TaxReportPanel`, `BillingClient`
- sales: `SalesHubClient`, `SalesReportView`, `sell/ProspectDealView`
- governance: `TrackerSurface`, `Soc2AutomationPanel`, `VulnerabilityFindingsPanel`, `RunScanPanel`
- `builder/database/RecordsTable`, `ProjectBackendPanel`
- `kernel/EntityBrowser`

**W4 — card-only surfaces gain List (group C).**
- `studio/StudioCardList`, `StudioApps`, `StudioRecentProjects`
- `builder/BuilderProjectsContent`
- `app/knowledge/KnowledgeClient`
- marketplace sections: `BuiltinAgentsSection`, `CreationsSection`, `KnowledgeMarketSection`,
  `MarketplaceGigsSection` (662 lines), `TalentCard`, `SellerEarnings`
- `app/agents/page.tsx` hub
- `talent/ShortlistPanel`, `workforce/WorkforcePlanView`
- `rfp/RfpContent`
- `app/references/ReferencesClient`
- `app/tools/ToolsHubClient`
- `app/incidents/IncidentsPageClient` (1,207 lines; split list from war room)
- `learning/CourseCatalogue`, `PathDirectory`
- `templates/TemplateGallery`, `KanbanTemplatesContent`
- `video/VideoGrid`, `app/media/page.tsx`
- `app/challenges/page.tsx`
- `points/RewardsView`

**W5 — bespoke stacked lists (group D).**
- `kanban/KanbanRosterCard`
- `talent/TalentView` (jobs, proposals and engagements become three descriptors)
- `chats/ChatsView`
- `meetings/MeetingsContent` (`MeetingsCalendar` becomes its calendar extra view)
- `QaContent` (628 lines)
- agent host drawer: `AgentHostSessionsContent`, `AgentHostProjectsContent`, `AgentHostSkillsContent`,
  `AgentHostNodesContent`, `AgentHostChannelsContent`, `CronJobsContent`
- `AgentCapabilitiesContent`, `SkillAssignmentsContent`, `PersonaAssignmentsContent`, `GovernanceContent`
- `ActiveRunsPanel`, `ObservabilityContent` (1,026 lines), `FleetMeshContent`
- `settings/MyLlmsContent`
- `integrations/IntegrationCredentialsManager`, `BoardConnectionsManager`
- security: `SessionList` (its bulk revoke moves onto a `session` port), `PolicyPacksPanel`,
  `IdentityProvidersPanel`, `PasskeysPanel`, `LegalAgreementsPanel`
- sourcing: `SourcedJobsList`, `JobSourcesPanel`
- `reports/ReportSchedulesPanel`
- `inbox/InboxClient`
- `insights/SurveysManager`
- `disputes/DisputePanel`
- freelance: `JobAlertsPanel`, `MilestoneSchedulePanel`, `ProfileResumePanel`, `TalentProfileView`
- investor: `CompaniesView`, `InvestorsView`, `DataRoomView`, `ListingView`, `PackView`, `RoundView`
- `dashboard/DashboardIdeasTab`

**W6 — admin panels (group E).**
- `HealthPanel`, `SystemHealthSection`, `OutcomeMetricsPanel`
- `CronPanel`, `SecurityPanel`, `ImpersonationSessionsPanel`
- `SuspectAccountsPanel` (its bulk revoke moves onto the admin port)
- `CreationSessionsPanel`, `ModulesPanel`
- `UsagePanel` (716 lines), `LlmRatingsPanel`
- `PersonasPanel`, `GovernancePanel`, `LegalPanel`, `PrivacyPanel`
- `BillingPanel`, `NewsletterPanel`, `ReleaseNotesPanel`
- `visitors/LeadsView` (its sort moves onto the shared sort), `FlowView`, `InsightsOpsPanel`
- `SalesLeadsPanel`, `SalesCommissionsPanel`, `BroadcastsPanel`
- `ErrorsPanel`, `EmailDeliveriesPanel`, `AuditLogPanel` (server paging already exists; adopt the `Page<T>` shape)
- `app/admin/sales/page.tsx`

Every wave's endpoints accept `PageQuery` in the same wave as their surface.

**Per-id fan-outs replaced in the same pass** (F6):
- `ConnectorsGallery.tsx:131`
- `IntegrationsGallery.tsx:127-128`
- `ProviderKeysSettings.tsx:1140`
- `security/AccountSecurityPanel.tsx:60`
- `security/SecurityClient.tsx:91`
- `replay/prompt/PagePromptBundle.tsx:64`
- `replay/prompt/useRecordPromptCopy.ts:19`

Each becomes a bulk port action or a single batched read.


### 6. Retirements

Each item is deleted at the end of the wave that removes its last consumer, after a zero-reference grep.

| Delete | When |
|---|---|
| `components/dataTable/DataList.tsx`, `DataTable.tsx`, `usePageSize.ts` (+ tests, run unchanged against `Collection` first) | W1 |
| `creation-sessions/SessionBulkBar.tsx` (+ css), `libraryViewPreference.ts`, loops in `useCreationLibraryActions.ts` | W1 |
| `ProjectTable.tsx` | W1 |
| `useTableSort` / `SortableTh` in `admin/adminShared.tsx` | W6 |
| `CatalogToolbar.tsx` | W2 |
| `dataTableStyles.ts`, `.table-wrap` / `.data-table` / `.th-sort*` in `globals.css` | after W6 (insights lenses keep a local style module if still needed) |
| `sessionManagement.bulk*`, duplicate `observability.selectAll`/`security` select keys | when their surface migrates |
| `ViewToggle` card/table flag pair used outside `Collection` | after W6. `ViewToggle` stays, used by `Collection` and by the `options` mode-pickers in §2. |

### 7. Guards

- **`check:collection-surfaces`** (frontend, added to the fast edit set). It fails on `<table`, `dataTableStyles`,
  `className="data-table"`, `ViewToggle` without `options`, or `Pagination` outside `components/collection/`.
  It runs against a **shrink-only allowlist** seeded with the §5 files, so each wave removes its rows and the
  list must be empty after W6. The §2 exclusions are permanent entries, each with a reason.
- **`check:collection-endpoints`** (frontend): every `useServerSource` fetcher passes `page`.
- **`check:bulk-fanout`** (frontend): fails on `Promise.all(<ids>.map(` or `for … of ids … await` calls into
  `*Api.` (allowlist-shrink). This stops F6 from recurring.
- **Api:** a route test asserts every registered `BulkEntityPort` has a permission for each capability and an
  `invalidate`. `check:tenant-scope` already covers the `scopedToTenant` use.

### 8. Tests

- **Consolidation parity.** `DataList.test.tsx`, `DataTable.test.tsx`, `usePageSize.test.tsx`,
  `TaskMgmtContent.test.tsx` and the creation-library tests run **unchanged** against the new components before
  the originals are deleted. The one exception is the page-size option list (200 → 250), which is an operator
  decision.
- **Component tests:**
  - selection: page-scoped indeterminate state, survives a page change, cleared by a filter change, select-all
    capped at 1000
  - the bulk bar hides when `entity` is null
  - an action is disabled-with-reason without the permission
  - Delete confirms, Archive gives an Undo toast, Merge needs 2 or more items and a preview
  - sort cycles, and the card-mode sort select works
  - the footer stays pinned
  - the 360px layout does not overflow
- **Api:**
  - `parsePageQuery`: allowlist, a 400 on an unknown sort, page-size clamp
  - `runBulkAction`: an unknown entity, an unsupported action, a missing permission, a cross-tenant id returned
    as `skipped: not_found`, `BULK_MAX + 1` gives a 400, `merge` without `targetId`, `dryRun` writes nothing,
    idempotent replay
  - one test per port covering delete, archive/restore and merge with cache-version bumps
  - **`regression:` the bulk archive of 200 tasks issues ONE request** (the client test asserts one
    `apiRequest` call). This is the F6 429.
- **Performance.** A tasks list at 4,453 rows renders 50 rows, and the page payload is ≤ 250 rows. The list
  query is one SQL round trip (`count(*) over()`).

### 9. Done-checks

1. `check:collection-surfaces` allowlist holds only the §2 permanent exclusions.
2. `check:bulk-fanout` allowlist is empty.
3. Every entity in §4 with D/A/M has a registered port. `/projects?tab=tasks` shows Card. `/workforce?tab=roles`
   shows Card | List with sort, paging and bulk.
4. The §6 retirements are deleted, with zero references.
5. `TaskMgmtContent.tsx`, `WorkforceAgents.tsx`, `TeamsView.tsx`, `ProviderKeysSettings.tsx`,
   `MarketplacePageClient.tsx`, `ManagerContent.tsx`, `IncidentsPageClient.tsx` and `ObservabilityContent.tsx`
   are each split below ~400 lines per module.
6. i18n parity holds across the five catalogs. The design-token, design-scale and raw-storage guards are green.
7. `release_notes` has a row (category `new`: bulk Delete/Archive/Merge and paging everywhere), plus a blog post
   per the marketing rule.

### 10. Delivery (model roles per CLAUDE.md)

- **W0 runs as two parallel implementers on disjoint paths.**
  - Implementer 1 (api): contracts, paging, bulk framework and migration. An **Opus review** is required because
    it touches a storage migration, auth/tenant scope and cross-package types.
  - Implementer 2 (frontend): `components/collection/*`, the client and i18n. A Sonnet review covers it.
- **W1 to W6 run in parallel by wave** on disjoint file sets. Each wave lands its endpoints' `PageQuery` support
  and its bulk ports with its surfaces.
- **Per wave:** Sonnet implements, Haiku runs targeted verification (typecheck, the guards, the named test
  files), Sonnet reviews the diff (Opus for any wave that adds a migration), and fixes go back to Sonnet.

### 11. Decisions taken in this PRD (defaults; the operator may override)

| # | Decision | Default chosen | Why |
|---|---|---|---|
| D1 | Select-all beyond the loaded page | "Select all {total}", fetching ids only, capped at 1000 per request | Keeps the "ids only" contract and bounds a single request |
| D2 | Where the tenant comes from | The authenticated JWT tenant, never the body (except superadmin admin routes) | A body tenant id would let a caller act on another tenant |
| D3 | Delete semantics | Each entity keeps its current single-delete semantics (hard vs soft), now set-based | No silent behaviour change |
| D4 | Merge result for sources | Archived or tombstoned, never hard-deleted | A merge can be revisited |
| D5 | List response shape | `Page<T>` when `page` is present, legacy shape otherwise | VS Code, MCP and agent callers stay unbroken |
| D6 | Archive storage | Existing columns kept and adapted by the port; new entities get `archived_at` | No 4-way data migration in this PRD; one adapter per entity |
| D7 | Page sizes | 50 / 100 / 250, default 50 | Operator request; replaces 200 |


(§1 findings are dropped as narrative; F6 is restated below. The §3.1 file table and `CollectionDescriptor` type — source lines 68-110 — are built and archived.)

### §3.1 Frontend files — remaining
**Remaining (verified 2026-11-17):**
- All 16 modules exist under `frontend/src/components/collection/` but **no page imports them** (0 importers outside the directory).
- `components/collection/collectionTypes.ts:1-20` re-declares `PAGE_SIZES`, `BULK_MAX`, `PageQuery`, `Page`, `Bulk*` as a "local mirror" of `packages/interaction-contract/src/api/collection.ts`. The frontend already resolves `@builderforce/interaction-contract` (`frontend/tsconfig.json:34`; used by `components/admin/insightsOps/*`). Delete the mirror and import the contract.
- No component tests exist in `components/collection/` (§8 list).

### §3.3 Server contracts — remaining
**Remaining (verified 2026-11-17):**
- `parsePageQuery` exists (`api/src/presentation/routes/pageQuery.ts`) but **no list route calls it**; no endpoint returns `Page<T>`; no query uses `count(*) over()`; no cached list folds page/sort into its key.
- The port registry exists (`api/src/application/collections/bulkEntityPorts.ts:79-105`) but **zero ports are registered** — no `api/src/application/<domain>/bulk/` exists, so `POST /api/collections/:entity/bulk` (mounted `api/src/index.ts:716`) returns 404 for every entity.
- Superadmin `POST /api/admin/collections/:entity/bulk` not built.
- `check:collection-endpoints` not built.
- Workflows list still filters in memory after an unbounded select (`api/src/presentation/routes/workflowRoutes.ts:260-263`).
- Migration `api/migrations/1352_prd47_collection_archived_at_expand.sql` added `archived_at` to 10 tables, but the Drizzle `workflows` and `workflowDefinitions` tables (`api/src/infrastructure/database/schema/agents.ts:1008,1047`) do not declare `archivedAt`.

### §5 Surface migration — remaining
**Remaining (verified 2026-11-17):**
- W0: `PAGE_SIZE_OPTIONS` is still `[50, 100, 200]` (`frontend/src/components/dataTable/usePageSize.ts:19`).
- W1–W6: no surface migrated. F6 fan-outs still live: `components/creation-sessions/useCreationLibraryActions.ts:82,89,96`.
- God files unchanged: `TaskMgmtContent.tsx` 2,703 · `ProviderKeysSettings.tsx` 1,332 · `IncidentsPageClient.tsx` 1,207 · `MarketplacePageClient.tsx` 1,161 · `ManagerContent.tsx` 1,138 · `ObservabilityContent.tsx` 1,026 · `WorkforceAgents.tsx` 892 · `TeamsView.tsx` 642.

### §7 Guards — remaining
**Remaining (verified 2026-11-17):** `check:collection-surfaces`, `check:collection-endpoints`, `check:bulk-fanout` are absent from `frontend/scripts/checks.manifest.mjs` / `edit-ratchets.manifest.mjs`; the api "every registered port has a permission per capability and an `invalidate`" route test is absent.

### §8 Tests — remaining
**Remaining (verified 2026-11-17):** api tests exist (`runBulkAction.test.ts`, `bulkEntityPorts.test.ts`, `pageQuery.test.ts`, `collectionBulkRoutes.test.ts`). Missing: every frontend component test, consolidation parity runs, per-port tests, and the `regression:` 200-task archive = ONE request test.

---

## PRD 22 — Browser Performance, Domain Execution, and Codebase Health

> Consolidated 2026-11-17 from `docs/specs/22-prd-browser-performance-domain-execution-analysis.md`. Verified against code 2026-11-17: Partly built.
> Finished sections are archived in DONE.md ("PRD 22: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

**Working rule (§0).** Put business policy in its owning domain. Put expensive work on the cheapest capable execution target that profiling proves suitable, without blocking the browser's interaction thread. Every finding states whether it is *observed* or a *likely consequence* (§1.2). No speed claim is made from static analysis alone.

**Current measurements (2026-11-17).**
- `'use client'` is on 200 of 3,914 `frontend/src` `.ts/.tsx` files. 21 of 208 `app/**/page.tsx` are client-rooted (baseline `useClientPages: 21`).
- `builderforceApi.ts` is 9,791 lines / 432 KB, with 89 API objects and 421 importers.
- `CreationCanvas.tsx` is 927 lines.
- API presentation→infrastructure baseline: 95. Cross-context schema imports: 22. Schema-shape clusters: 1. Registry-only tables without disposition: 109.

### §3.4 P0 — Canvas presentation owns multiple application and domain responsibilities

Presentation may coordinate display state and dispatch use cases. It must not parse files, own collaboration transport, define graph invariants, or implement analytical queries.

**Remaining (verified 2026-11-17):**
- History and undo/redo are still a presentation hook: `components/creation-canvas/hooks/useCanvasHistoryCheckpoint.ts`. There is no `domains/canvas/domain/history.ts`.
- There is no `domains/canvas/infrastructure/canvasDataWorkerClient.ts`; see §3.6.
- Done so far: `domains/canvas/{application,domain,infrastructure,presentation}` (`ImportCanvasFile`, `MaterializeDataset`, `PersistCanvas`, `ShareCanvasSession`, `canvasBoard.ts`, `selection.ts`, `guestRoomGateway.ts`).

### §3.5 P0 — A cross-domain API god module defeats ownership and code splitting

Move each client behind its owning domain's infrastructure port. Keep one small shared HTTP transport in infrastructure (`infrastructure/http/`). Do not keep every domain contract in one module (`domains/<ctx>/infrastructure/<ctx>Gateway.ts`). Each gateway consumes the §3.13 read-through contract and declares the key prefixes its writes invalidate.

**Remaining (verified 2026-11-17):**
- `frontend/src/lib/builderforceApi.ts` has grown from 363 KB to 432 KB (9,791 lines, 89 `export const … = {` objects, 421 importing files).
- Only 3 `domains/*/infrastructure/*Gateway*.ts` files exist.
- Add a size ceiling for this file to `check-frontend-architecture.mjs` (`oversizedProductionFileLines`) so it can only shrink.

### §3.6 P1 — File and dataset processing can block the interaction thread

Add a Canvas data worker with a narrow domain protocol:

```ts
type CanvasDataRequest =
  | { type: 'import'; id: string; name: string; mime: string; bytes: ArrayBuffer }
  | { type: 'profile'; id: string; source: TabularSource }
  | { type: 'query'; id: string; source: TabularSource; query: TabularQuery }
  | { type: 'mesh-preview'; id: string; format: MeshFormat; bytes: ArrayBuffer };
```

Transfer file buffers into the worker. Use streaming or incremental progress for large inputs. Keep the 48 MiB ceiling (`MAX_PARSEABLE_BYTES`) until memory traces justify changing it. Start with the existing TypeScript algorithms. Consider WASM/SIMD only when benchmarks show a win after crossing and allocation costs.

**Remaining (verified 2026-11-17):**
- The readers are split per format (`lib/office/*` behind `lib/officeFormats.ts`), but they still run in-thread from `domains/canvas/application/ImportCanvasFile.ts`. Tabular profile/query still runs in-thread (`lib/canvasTabularData.ts`).
- No `CanvasDataRequest` or canvas data worker exists.

### §3.7 P1 — Full-graph serialisation repeats after ordinary Canvas edits

The Canvas domain records immutable commands or patches and checkpoints full snapshots periodically in a worker. Persisted snapshots remain, but are not the unit of every local edit.

**Remaining (verified 2026-11-17):**
- `components/creation-canvas/hooks/useCanvasHistoryCheckpoint.ts:40,48` still runs `JSON.stringify({ nodes, edges })` (twice) per edit.
- The undo stack is `string[]` snapshots (`CreationCanvas.tsx:466`).

### §3.9 P1 — Service-worker and model caches need explicit storage policy

| Class | Store | Policy |
|---|---|---|
| Hashed JS/CSS | Cache Storage | cache-first, immutable, build-version cleanup |
| Navigation shell | Cache Storage | network-first, guaranteed offline fallback |
| Images/fonts | Cache Storage | stale-while-revalidate, bounded entries and age |
| WASM runtime files | Cache Storage | explicit version and integrity policy |
| Model weights | IndexedDB/OPFS | model/version key, LRU metadata, quota-aware eviction |
| User drafts | IndexedDB | durable, schema-versioned, never evicted as disposable cache |
| API/customer data | domain store | explicit offline contract; never incidental response caching |

Before a large model download, call `navigator.storage.estimate()`. Offer `navigator.storage.persist()` only in response to a user-visible offline/on-device action.

**Remaining (verified 2026-11-17):**
- The policy doc exists: `frontend/docs/browser-storage-policy.md`.
- `frontend/public/sw.js:90-94` stores every OK same-origin GET in `bf-static-*` with no entry, size, age, content-type or range-request bound.
- `studio/src/engine/weight-cache.ts` (118 lines) has no version enumeration, last-access/LRU, quota estimate or eviction.
- No `navigator.storage.estimate`/`persist` call exists in `frontend/src` or `studio/src`.
- There are no user-visible model download/storage controls (§5 Phase 4 step 4).

### §3.10 P2 — Do not replace the accessible 3D Canvas wholesale with WebGL

Preserve DOM cards. If traces show density limits, test a hybrid: GPU/`OffscreenCanvas` for dense non-semantic layers (edges, mesh surfaces, minimaps, selection backgrounds), DOM for focusable/editable objects, viewport culling, and an evidence-based threshold. A GPU layer is never the only semantic representation of an object.

**Remaining (verified 2026-11-17):**
- Profile-gated (Phase 5). No work until §5 Phase 0 measurements exist.

### §3.11 P2 — Static image delivery leaves an avoidable initial-load cost

Pre-generate responsive AVIF/WebP variants during the build, or use Cloudflare image resizing. Keep the original only where its resolution is required.

**Remaining (verified 2026-11-17):**
- `frontend/next.config.js:115` still has `images: { unoptimized: true }`.
- `public/images/hero/evermind-brain.png` is 1,876,959 bytes and is loaded with `priority` at `components/BrainBackdrop.tsx:143`.

### §3.12 P2 — The dependency-free diff algorithm is intentionally bounded, but belongs off-thread

Move diff construction behind the IDE/review domain's worker if traces show long tasks. WASM diff is optional and must beat the worker-hosted TypeScript path.

**Remaining (verified 2026-11-17):**
- `frontend/src/lib/unifiedDiff.ts:12,82` is still a main-thread O(n·m) LCS capped at 1,200 lines.

### §3.14 P0 — The application is a client-side SPA wearing an App Router

Push `'use client'` down to the leaf that needs it. The page shell, data fetch and static chrome become server components, and `<Suspense>` streams the rest. A converted page reads its locale server-side. Both counts may only fall.

**Remaining (verified 2026-11-17):**
- 21 client-rooted pages remain (baseline `useClientPages` in `frontend/scripts/.frontend-architecture-baseline.json`).
- Per-route first-load JS and dashboard/workforce hydration time have never been recorded (proof required).
- Done: the root layout carries only Locale, Auth, Confirm, Toast and Theme (`app/layout.tsx:233-322`). Route providers moved to `components/ConditionalAppShell.tsx:415`. Ratchets are `check-redundant-use-client.mjs` and `check-root-layout-providers.mjs`.

### §3.15 P1 — Frontend architecture ratchet (complexity half)

**Remaining (verified 2026-11-17):**
- The layering and size ratchets exist (`frontend/scripts/check-layering.mjs`, `check-frontend-architecture.mjs`).
- There is **no cyclomatic-complexity checker** for either `api` or `frontend` (grep `cyclomatic|complexity` across `scripts/`, `api/scripts/`, `frontend/scripts/`, eslint configs is empty). See §11.5.

### §3.18 P1 — Frontend reuse and object creation have no enforced maintainability contract

Layered presentation contracts: primitives → patterns → domain components. Extract on recurring semantics, with three occurrences as the review trigger. Creation: Factory Method or Abstract Factory where selection depends on capability or policy; Builder for staged validated values; registry + factory as the single Canvas object-creation path; engine, worker and SDK constructors live in infrastructure factories or composition roots.

**Remaining (verified 2026-11-17):**
- `directEngineConstruction` baseline = 3: `components/AITrainingPanel.tsx`, `components/AgentPublishPanel.tsx`, `components/AgentStateViewer.tsx` still construct `WebGPUTrainer` / `MambaEngine` / `MambaModelProvider`.
- There is no checked-in reuse census by semantic category (async state, dialogs, forms, filters, data tables).
- `components/ui/` has 22 files and `check-primitive-duplication.mjs` exists.

### §4.1 Domain owns policy; infrastructure owns execution target

`domains/training/domain/TrainingEngine.ts` (`train(request, signal): AsyncIterable<TrainingEvent>`) with `WorkerTrainingEngine` and `RemoteTrainingEngine` adapters. The application layer selects through a capability and policy service. Presentation never imports ONNX or the memory engine.

**Remaining (verified 2026-11-17):**
- There is no `frontend/src/domains/training` (current contexts: canvas, ceremony, collab, dataScience, finance, guest, hiring, marketing, teaching, workflow).

### §4.2 Execution-policy matrix

The target matrix in the source (Canvas import/profile/query → dedicated worker; LoRA → worker + WebGPU/WebNN/WASM; and so on) still stands.

**Remaining (verified 2026-11-17):**
- The Canvas import/profile/query, mesh and LoRA rows are not met (§3.2, §3.6).

### §4.3 Capability routing contract

One infrastructure service returns facts (`worker`, `offscreenCanvas`, `webgpu`, `webnn`, `wasmSimd`, `wasmThreads`, `crossOriginIsolated`, `webCodecs`, `storageEstimate`), not product policy. Each domain decides what they mean.

**Remaining (verified 2026-11-17):**
- grep `BrowserCapabilities` is empty. Capability checks are still scattered.

### §4.4 Where this document is and is not Domain-Driven — (b) events on the wire

Broadcast events, keep command validation on the originating aggregate.

**Remaining (verified 2026-11-17):**
- `CanvasCommand` / `CanvasEvent` / `broadcastableCanvasChange` exist (`frontend/src/lib/canvas/boundedContexts.ts:215-242`), but `broadcastableCanvasChange` is referenced only by its own test. The live room transport (`domains/canvas/presentation/useSharedCanvasRoom.ts`, `domains/canvas/infrastructure/guestRoomGateway.ts`) still exchanges graph snapshots.
- H-21's collaboration divergence test does not exist.

### §5 Delivery sequence (open steps only)

- **Phase 0:** production bundle reports per route (initial shell, dashboard, Canvas, IDE, training, voice, Studio). Perf scenarios: Canvas open, 500-object pan/zoom, 48 MiB import, dataset profile, local training, Studio init/dispose. Record long tasks, INP, heap and transferred bytes. CI max for shell JS once there is a baseline. Size/complexity ratchets for `api` and `frontend`. Client request census for the dashboard → workforce → dashboard loop.
- **Phase 1:** convert the remaining 21 client-rooted pages, highest traffic first. Migrate the first measured UI pattern families as complete vertical slices.
- **Phase 2:** LoRA worker (tokenizer + packaging). Route `MambaEngine` training through the Mamba worker protocol. Canvas data/import worker with transferable buffers. Deterministic cancellation and disposal tests.
- **Phase 3:** step 2 (events on the wire), step 4 (`builderforceApi.ts` split), step 6 (reduce the layering baseline), step 7 (factories for the 3 direct engine constructions).
- **Phase 4:** per-resource cache bounds. Model-cache metadata, versioning, storage estimates and eviction. User-visible storage controls.
- **Phase 5 (gated on 0–4):** hybrid GPU canvas layers at measured density. WASM/SIMD benchmarks against worker TS. Keep an optimisation only on p75/p95 improvement without accessibility, battery, memory or compatibility regressions.

### §6 Acceptance criteria (still unmet)

- **6.1** Production bundle reports name each heavy chunk by owning domain. The client page count keeps falling, and a new client-rooted `page.tsx` needs a checked-in reason.
- **6.2** Local training, Office import, mesh parsing, dataset profiling and large diffs produce no application-authored main-thread task over 50 ms in the reference scenarios. Canvas stays responsive while a worker runs. Cancellation releases worker, GPU and buffer state.
- **6.3** Presentation imports no ONNX, memory-engine, IndexedDB, worker or raw transport implementations. Each API gateway belongs to one bounded context.
- **6.4** Static, WASM, model, user-draft and API data use separate enforced storage policies. Model downloads check quota, and failed writes do not corrupt the active model record. Model versions can be enumerated and removed, and eviction never deletes drafts.
- **6.5** Training and Studio report the active backend (WebNN/WebGPU/WASM-CPU/remote). Detection is feature-based. GPU device loss yields an actionable domain error and releases resources. Unsupported hardware degrades explicitly.
- **6.6** The Canvas keeps keyboard, focus, screen-reader, reduced-motion, touch and 360 px parity. Offline and local-only modes state which operations need the network.
- **6.7** The request-count change on the reference loop is reported. Unbounded keyspaces use version tokens.
- **6.8** Collaboration broadcasts domain events, not commands.
- **6.9** Presentation does not construct engines, workers or SDKs. Every Canvas creation path uses the registry factory. Builders return a valid value or typed errors.

### §7 Non-goals (working rule)

- Do not move tenant-authoritative policy or secrets into browser code.
- Do not rewrite accessible DOM in WebGL because GPU rendering exists.
- Do not replace tested TypeScript with WASM without benchmarks.
- Do not precache the authenticated app or the model catalogue.
- Do not keep model sessions alive after their feature closes.
- PWA install is not permission for unbounded background downloads.
- Do not combine extraction with redesign in one change.

### §11.1 Presentation depends on use cases

For each baseline file: identify the use case, define a narrow application contract, move persistence and query composition behind it, inject it into the route, and remove the file from `.layering-baseline.txt` in the same change. Work by bounded context. Never build one global service.

**Remaining (verified 2026-11-17):**
- `api/scripts/.layering-baseline.txt` has 95 entries (from 127). Target 0.

### §11.2 Domain behavior owns invariants (working rule)

A rule moves into domain code when it decides transition validity or resulting state, needs no I/O or framework, and is reused or dangerous to duplicate. Retries, transactions, auth context, provider calls, telemetry and scheduling stay in application or infrastructure.

### §11.3 Cross-context reads use explicit contracts

Order of preference: kernel primitive → named read model/view → application query service → direct schema import only as a documented temporary baseline entry.

**Remaining (verified 2026-11-17):**
- `api/scripts/.domain-boundary-baseline.txt` has 22 entries (from 38).

### §11.4 Registry-only tables receive a disposition

Each table becomes exactly one of: feature-owned, reference/admin, migration-only, or dead target.

**Remaining (verified 2026-11-17):**
- `api/scripts/.table-adoption-baseline.txt` has 109 entries, checked by `api/scripts/check-table-adoption.mjs` and `adjudications/table-adoption.mjs`.

### §11.5 Complexity and source-size ratchets

A repository-owned checker with file/line/function output:
- New functions have CC ≤ 15. Existing functions above 15 may not increase. Functions above 25 need a named reduction task when materially touched.
- No new production file over 800 lines without a checked-in exception.
- Generated and schema files are classified separately.

**Remaining (verified 2026-11-17):**
- There is no CC checker anywhere.
- The 800-line ceiling exists for the frontend only (`check-frontend-architecture.mjs` `oversizedProductionFileLines`, 18 grandfathered). No API file-size ratchet was located.

### §11.6 Behavioral seam reductions

- **Cloud engine:** model cancellation/steering, compaction, completion/cascade, tool dispatch, governance approval, finish validation and persistence as explicit state transitions.
- **Manager service:** split planning, triage, queue policy, provider ops, recovery dispatch and action journaling. Keep PR operations serial.
- **Routes:** business branching moves behind use cases.
- **Brain reply:** separate model/tool policy, persistence and notification.

**Remaining (verified 2026-11-17):**
- The Creation Canvas split has landed (`CreationCanvas.tsx` 927 lines).
- The cloud engine, manager, route and Brain seams were not re-measured in this pass. They need a CC report (§11.5) to verify.

### §11.7 Semantic duplication priorities

**Remaining (verified 2026-11-17):**
- One schema-shape cluster remains: `initiatives = portfolios` (`api/scripts/.signature-duplication-baseline.txt`).
- Items 2–7 were not individually re-verified: assignment screens, login/register layout, ledgers, drive/mailbox, insight builders, web-container connection pages and manager stall surfaces.

### §11.8 Reusable frontend component program

Inventory recurring interaction contracts, extend `components/ui`, migrate one complete feature slice at a time, add tests and docs before declaring a component canonical, and add a baseline-aware duplication check.

**Remaining (verified 2026-11-17):**
- No semantic inventory is checked in. `check-primitive-duplication.mjs` exists (`.primitive-baseline.txt`, 3 lines).

### §11.9 Creational-pattern program

**Remaining (verified 2026-11-17):**
- Move `WebGPUTrainer`, `MambaEngine` and model-provider construction out of the 3 baseline components into infrastructure factories.
- Make `creationObjectRegistry` the sole production factory for `CreationFlowNode` (registry tests exist in `components/creation-canvas/creationObjectRegistry.test.ts`).

### §12 Backend speed and execution controls

- **12.1** Per route/use case: p50/p95/p99 latency, query count and DB time, provider time, cache hit/miss, cloud-agent time per turn, tool dispatch and telemetry persistence, and React commit time for the Canvas scenarios. No secrets, prompts, tenant data or raw SQL params.
- **12.2** Cursor pagination for measured high-volume entities. Optional/approximate totals. `pg_trgm` GIN only for measured leading-wildcard columns. Composite index checks against real plans. `countScope` rollups only when telemetry proves cost. `EXPLAIN (ANALYZE, BUFFERS)` evidence for index PRs.
- **12.3** Classify every await-in-loop as causal, rate-limited, independent or batchable. Add an allowlisted check so new sequential I/O loops need a classification comment. Never use unbounded `Promise.all`.
- **12.4** Keep business events ordered. Move noncritical telemetry to an outbox or batch insert. Measure writes per agent step. Keep fail-open/fail-closed explicit per meter.
- **12.5** Split Canvas stores and subscriptions. Split `builderforceApi.ts` (§3.5). Track route chunks and interaction latency.

**Remaining (verified 2026-11-17):**
- There is no await-in-loop check (grep empty).
- `pg_trgm` appears only in migrations 1094 and 1134, not on generic entity search.
- No per-route latency/query instrumentation was located in this pass.

### §14 Additional acceptance criteria (open)

H-1 (reproducible source report), H-4 (disposition manifest complete), H-5 (complexity ratchet), H-6 (API half), H-7 (token clone check), H-9 (async-loop classification), H-10…H-14 (perf evidence, cursors, wildcard plans, Canvas p95, cloud/manager characterization), H-21 (events on the wire), H-22 (reuse census), H-23 (no direct engine construction).

### §15 Risks and controls / §16 Definition of done per slice (working rules)

Every slice records the following:
- the measured smell and its owner
- a bounded file set
- characterization tests
- the canonical owner after the change
- focused tests and ratchets
- before/after clone or complexity evidence
- before/after latency, query or render evidence for perf work

LOC is inventory, not a gate. Use bounded pools, never unbounded parallelism. Extract only canonical policy with a shared change reason.

---

## PRD 39 — Platform close-out

> Consolidated 2026-11-17 from `docs/specs/39-prd-platform-closeout.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 39: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### §1 Gateway Worker split

Every `/llm` and `/v1` call boots the whole API. `builderforce-gateway` (`src/gatewayWorker.ts`) serves `/llm`, `/llm/v1/videos` and `/v1/semantic-cache`. The seam routes stay on the API (`presentation/gatewayApp.ts:25-31`). It reaches the API for route replay over the `API` service binding through the `RouteReplay` port.

Shipped (push 1): the port (`application/llm/routeReplay.ts`), `gatewayWorker.ts`, `gatewayApp.ts`, `gatewayPrefix.ts`, `wrangler.gateway.toml` (workers.dev only), the graph guard (`checks.manifest.mjs:48`) and the release step (`.github/workflows/release.yml:885-912`).

**Sequence still to run.**
1. **Measure first — failed the half-size test.** `api/scripts/measure-gateway-bundle.mjs` reports the gateway at about 59% of the API bundle, dominated by `unpdf/pdfjs` pulled in through the builtin-MCP catalog for route replay. Per this step, stop and cut that import (for example, keep the PDF tool behind the replay binding or lazy-load it) before push 2.
2. **Prove it live.** Run real completions, streaming, a builtin tool call, a BYO key and a video job against the `workers.dev` host. Unit tests do not count.
3. **Push 2.** Add `[[routes]]` to `wrangler.gateway.toml` and remove the `/llm`, `/llm/v1/videos` and `/v1/semantic-cache` mounts from `src/index.ts`. Rollback is removing the routes.

**Done when.** The graph guard passes in CI (done). Gateway bundle size and cold start are recorded here. The live checks pass on the production routes. `llm_usage_log` and traces match the pre-split shape. No `/llm` requests reach `builderforce-api` except replays.

**Open risk.** `api.builderforce.ai` is a Custom Domain, and a Custom Domain does not reliably beat a zone route (`frontend/wrangler.toml` comment). Route precedence for `/llm/*` must be proven on the rollout.

**Remaining (verified 2026-11-17):**
- `api/src/index.ts:658-659,672` still mount `/llm`, `/llm/v1/videos` and `/v1/semantic-cache`. `api/wrangler.gateway.toml` has no `[[routes]]`.
- The gateway is about 59% of the API bundle (`api/scripts/measure-gateway-bundle.mjs:15-18`), so the pdfjs import must be cut first.
- Bundle size and cold start are not recorded here. No live proof yet.

### §3 Retire the `agents` table

Shipped (push 1): migrations 1347, 1348 and 1351; `skills.agent_registration_id` (`schema/agents.ts:479`); `/api/agents` served from `agent_registrations` via `application/agent/legacyAgentRegistry.ts`; `RuntimeService.ts:202` legacy lookup; `AgentRepository`, `IAgentRepository`, `AgentService` and the domain `Agent` deleted; first-party clients moved to `/api/agent-registrations`.

**Sequence still to run.**
2. **Push 2.** Drop the table, and drop the legacy integer columns (`executions.agent_id`, `skills.agent_id`, `agent_dispatches.agent_id`) once `agent_registration_id` is confirmed as the only reader on all three. Remove the `agents` declaration in the same commit.
3. **After Sunset (Wed, 31 Dec 2026).** Remove the `/api/agents` and `/api/skills` alias routes.

**Done when.** No import of `agents` from the schema remains, checked by the export and not only the local alias. `/api/agents` responses match before and after for a tenant with legacy rows. Dispatch by numeric id still works. Every `skills` row has a registration.

**Remaining (verified 2026-11-17):**
- `api/src/infrastructure/database/schema/agents.ts:322` still declares `agents` (the comment says "dropped in push 2").
- `api/src/index.ts:1036` still mounts `/api/agents`.
- `agent-runtime/src/commands/workforce-agent.ts:60` still calls `/api/agents/:id/package` and must move before the post-Sunset alias removal.
- The bundled `clients/vscode/media/webview/index.js` still contains `/api/agents` (a stale build; the source `brain-embedded/src/agentPool.ts:52` has moved).

### §4b Fleet failover

When the reaper finds a host run stranded and another eligible host is online, it re-dispatches once. Otherwise it fails as it does today. The rule is **write-ahead**:
- Declare an allowlist of tools that are safe to re-run.
- A host advertises write-ahead support at run start. Older hosts send no intents, so their runs fail at the deadline exactly as today.
- Before any tool runs, the host takes the next per-run sequence number. Only a non-allowlisted tool waits for a server acknowledgement of its intent. No acknowledgement within the timeout means the tool does not run and the run fails.
- `executionId` is required on those intents.
- A run may re-dispatch only if its host advertised support, the server holds no intent for a non-allowlisted tool, and the sequence numbers have no gap. Anything else fails and asks a human, with the reason recorded.

Shipped (server side): `transactional-migrations/0034_write_ahead_intents.sql`, `toolIntents` (`schema/agents.ts:1207`), `application/runtime/writeAheadIntents.ts`, `writeAheadAllowlist.ts`, and `redispatchHostRun` in `staleExecutionReaper.ts:444-499`.

**Done when.** Killing a host mid-run after only allowlisted calls moves the run to a second host and completes it. Killing one after an acknowledged non-allowlisted intent fails it with the reason shown, even if the tool never ran. No run re-dispatches twice.

**Remaining (verified 2026-11-17):**
- `recordWriteAheadAck` and `recordIntentAck` (`api/src/application/runtime/writeAheadIntents.ts:30,44`) have **no callers**. No relay handler writes `tool_intents` or stamps `writeAhead` on a run.
- No host implements the protocol: grep for `writeAhead`/`toolIntent` in `agent-runtime/`, `clients/vscode/` and `packages/` finds nothing relevant. Missing on the host: advertise support on `task.assign` ack, per-run sequence, intent before every tool, and an ack wait for non-allowlisted tools.
- Until the host side ships, `parseWriteAheadSupport` never sees support and no run is ever re-dispatched.
- Live kill-host proof is pending.

---

## Design — Internet search subsystem

> Consolidated 2026-11-17 from `docs/specs/internet-search-subsystem.md`. Verified against code 2026-11-17: Partly built (phases 1–2 shipped).
> Finished sections are archived in DONE.md ("Internet search subsystem — finished sections, archived 2026-11-17").

### Decisions (still binding)
1. **Bounded context:** `web_search_*` tables and `application/webSearch` own crawling and retrieval. Presentation only validates HTTP input; infrastructure owns persistence and network access.
2. **Persistent frontier:** Postgres is the development frontier. Claims use row locks and leases so a failed Worker can resume. The port can later be implemented with Cloudflare Queues without changing the crawler.
4. **Hybrid seam:** semantic retrieval is an optional `SemanticIndex` port. Lexical-only operation is valid; Vectorize plus the existing embedding gateway is the production adapter planned for phase 3.
6. **Tenant isolation:** crawl configuration, frontier rows, documents, index terms, and API queries are tenant scoped. A shared global corpus can be introduced later as a separate policy decision.

### Delivery phases (open)
- **Phase 3:** embedding worker, model-versioned chunks, Vectorize adapter, reciprocal-rank candidate fusion, offline relevance fixtures.
- **Phase 4:** richer multi-search orchestration, citation provenance validation, source-quality classifiers, query rewriting.
- **Phase 5:** Queue consumers, per-domain Durable Object coordination, sharded lexical service, authority/link graph, dashboards and SLOs.

**Remaining (verified 2026-11-17):**
- Only the port exists: `api/src/application/webSearch/ports.ts` `SemanticIndex`, consumed optionally at `searchService.ts:17`; no Vectorize adapter, no embedding worker.
- No Queue consumer or crawl cron (`api/src/cronSweeps.ts` has no crawl entry); the frontier claim is Postgres-only (`infrastructure/webSearch/postgresWebSearchStore.ts:30-36`).

### Operational dependencies
Phase 3 will require a Vectorize index whose dimensions match the selected embedding model and metadata indexes created before ingestion. Queue bindings are deferred until crawl volume warrants dedicated consumers.

---

## PRD 18 — hired.video → Builderforce.ai port (cutover and retirement)

> Consolidated 2026-11-17 from `docs/specs/18-prd-hired-video-port.md`. Verified against code 2026-11-17: Mostly built. Cutover has not started.
> Finished sections are archived in DONE.md ("PRD 18: finished sections archived on consolidation"); section numbers are kept, so a gap in numbering is a shipped section.
> **Split across domains:**
> - **platform** (this file): §3, §6.3 external clients, §6.6 and the T6 whitelabel row.
> - **run:** hiring, résumé and the agents.
> - **make:** runtimes.
> - **reach:** T5 and affiliates.
>
> T0 (foundation) is shipped and superseded by the zero-new-table mapping (§5a).

### §3 Traffic cutover
Per surface, only after that surface's tracks land.

**Corrected:**
- Step 1 (dual-run through `application/integrations/hiredVideo.ts`) is obsolete. The seam was deleted before any dual-run: git grep for `hiredVideo|HIRED_API|isHiredConfigured` in api/src and frontend/src is empty.
- Résumé parity is proven by the native tests instead.

The remaining steps:
2. **Data migration.** One `pg_dump` → transform → load per group, tenant-scoped by workspace, along `docs/specs/data-model/source-to-target.tsv`. Résumé and video blobs move R2→R2 by key rewrite.
3. **URL map.** `hired.video/*` → `builderforce.ai/*` 301s, authored as a data table so that a redirect is not a deploy. SEO surfaces keep their slugs, and the public shell prefixes gain the ported public prefixes.
4. **Embeds and SDK.** Builderforce no longer consumes `@seanhogg/hired-video-sdk`.
   - If there are no third-party holders (§6.6.1), delete the SDK, the package and the hired-side `createEmbedToken`.
   - Otherwise publish a shim with a dated end-of-life.
5. **Chrome extension and Outlook add-in** repoint at `api.builderforce.ai`. They are version-bumped and store-reviewed; start early.
6. **Retire, 100%.** `hired.video` becomes a Worker that serves only 301s. Remove its DOs and crons, and release its R2/KV once the data migration is verified. A grep for `hired` across api/src and frontend/src returns only redirect-map data.

**Remaining (verified 2026-11-17):**
- No redirect-map table or route exists (git grep `redirectMap|redirect_map|hiredRedirect`: 0).
- No migration loader exists.
- The hired.video Worker is not reduced to 301s. It lives in the sibling repo `C:\code\hired\hired.video`.
- The extensions are not repointed. The Builderforce side has `api/src/presentation/routes/publicExtensionApiRoutes.ts`.
- The public `/jobs` and `/articles` targets for step 3 do not exist yet (reach T5).

### §6.3 Runtime infrastructure (open rows)
**Remaining (verified 2026-11-17):**
- DO `GameSignalingRoom`: no equivalent was found. It is needed for game multiplayer (make G-012).
- `hiredvideo-chrome-extension` (jobseeker and recruiter builds) and `outlook-plugin`: repoint and get store re-review under the Builderforce publisher.
- `microsoft-identity-association.json`, `public/*` and `scripts/prerender.mjs`: these move with the redirect.

### §6.6 Exceptions — decisions, not engineering
1. **Third-party API-key, partner and whitelabel holders.** Do external partners exist, and are their contracts migrated or terminated? If none exist, delete the SDK and shim at cutover. *Blocker: operator.*
2. **SEO equity.** Consolidate `hired.video` domain authority into `builderforce.ai`, or keep the domain serving. *Blocker: marketing call.*
3. ~~Neon tier~~ This is moot: the remaining port needs zero new tables (§5a, archived).
4. **Store-published clients.** Two Chrome extensions and one Outlook add-in need re-review under the Builderforce publisher identity, with 1–3 weeks of lead time. *Blocker: operator files the submissions.*

### T6 · Whitelabel (per-tenant branded domains)
Port onto the site-backend custom-domain work (0412). Do not run two domain systems; PRD 19 §2's one-owner rule applies.

**Remaining (verified 2026-11-17):**
- The table exists only in schema (`api/src/infrastructure/database/schema/commerce.ts`, migration 0425). No application or route code reads or writes it (git grep `whitelabel|white_label`: schema, entities and the migration only).
