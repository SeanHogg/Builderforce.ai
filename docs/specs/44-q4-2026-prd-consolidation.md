# Q4 2026 — PRD Status Consolidation

> Consolidated 2026-11-08 from `docs/specs/`. Every numbered PRD was re-verified against
> `main` this pass: each file was read, its claims checked against live code, and its blog
> coverage confirmed in `frontend/src/content/blog/`. This is the one-file answer to
> "what is the state of every PRD." Per-PRD contracts remain authoritative for their
> area; this file is the index.

## Status legend

- **Shipped** — feature complete, recorded in DONE.md; the PRD file may be retained as a
  conformance fixture or removed (number never reused).
- **Partly built** — core seams exist in code; named remainder is tracked in the PRD and ROADMAP.
- **Not built** — design only; no or only scaffolding code.
- **Obsolete** — superseded; file removed, state preserved in DONE.md.

---

## Shipped

### PRD 35 — One agent, one kernel · Complete 2026-11-01 · SHIPPED
One execution core for every surface: VS Code, web, Rovr and the on-prem channels run
the same agent loop. The per-surface `runLoop` and the engine switch are deleted.
- **Verified:** `runLoop.ts` absent from `brain-embedded/src`; `check:one-execution --enforce`
  PASS (0 importers); conformance oracle green (`referenceScenario.test.ts`).
- **File:** retained as a read fixture for the conformance tests. **Blog:** `one-agent-one-kernel`.

### PRD 38 — Knowledge graph & extraction · SHIPPED (open: linked-projects acceptance)
A knowledge graph over any directory with incremental content-hash-keyed review, Louvain
communities, and the visualizer.
- **Verified:** review pipeline (`review.ts`/`plan.ts`), communities (`communities.ts`),
  the full visualizer, and the bulk extracted-output API routes all present.
- **Open:** linked-projects batched path is in code; VSIX packaging + end-to-end acceptance
  rerun on `agentic` remain. **Blog:** covered by the knowledge-map articles
  (`point-it-at-a-folder-and-see-what-it-knows`, `one-folder-many-systems`).

### PRD 40 — Portable knowledge packs · Shipped 2026-11-06 · SHIPPED
`.bfpack` portable packs with provenance; the single `PackRegistry → PackRetrievalPort`
retrieval seam; the platform pack store.
- **Verified:** format, VS Code commands, registry + retrieval seam, Measure proof, and the
  pack store all recorded in DONE.md; no open decisions.
- **File:** retained — it holds the still-binding naming/seam rules. **Blog:** `portable-knowledge-packs`.

### PRD 42 — Browser built-in models · Complete 2026-11-07 · SHIPPED → **OBSOLETE (file removed)**
The browser's own model in every modality shipped in full; the design is archived in DONE.md.
No open work remained, so the PRD file was deleted this pass (number never reused).

---

## Partly built

### PRD 05 — Integration, embed-back & identity federation
Segment lazy-provisioning core (`segmentResolver.ts`, `tenants.idpIssuer`) shipped.
- **Open:** inbound OIDC JWT verification feeding `resolveSegment` (no live claims caller),
  scoped S2S service tokens. **Blog:** `security-and-multi-tenant-architecture` (nearest).

### PRD 08 — Agentic security & governance
§10 agentic DevSecOps (PR security scan/review/merge gate) shipped 2026-11-08.
- **Open:** the policy-pack domain — `governance-auditor` role, `governance_audit` tool, the
  four governance tables, `/api/governance/*`. **Blog:** `approval-gates-and-human-oversight` (nearest).

### PRD 09 — Cloud agent validation & hardening
G2 (secret redaction) and G3 (sandbox fs path-guard) closed; redaction runs at the one
`insertToolAudit` chokepoint.
- **Open:** GAP-G1 (P0) — operator-facing isolation-model doc + red-team against a deployed
  sandbox; the live golden-path E2E. **Blog:** `security-and-multi-tenant-architecture` (nearest).

### PRD 18 — hired.video port
Résumé spine + Recruiter/HR agents shipped; Studio components exist.
- **Open:** T4 video runtimes — teleprompter, multi-track `TimelineCanvas`, `WebcamRecorder`
  not present as components (checkpoint ahead of code). **Blog:** video-resume articles exist.

### PRD 19 — BurnRateOS consolidation · NO-GO for shutdown
Destination model, C-suite seats, runway + startup listing shipped.
- **Open:** per-track domain parity (finance 0/20, HR 0/22, investor portal 0/12 feature-reached).
  **Blog:** `list-your-startup-and-meet-investors`.

### PRD 20 — Consolidated data model
Kernel + access layer shipped (360/360 model coverage, 237→0 unreachable tables).
- **Open:** Step 4 (404 Prisma models conversion), Step 5 (live rows still in 96 legacy tables).
  **Blog:** none.

### PRD 21 — Unified experience · SHIPPED (deferred items documented)
One canvas shell, slide-in panels, one destination registry, design-system ratchets.
- **Open (intentional):** M3 workbench index, M4 company claim, M5 preview — blocked on PRD 19.
  **Blog:** `whats-new-always-on-canvas-workspace`.

### PRD 22 — Browser performance / domain execution
Read-through cache, route-tree dedup, canvas code-splitting, ratchet gates shipped.
- **Open:** client→server conversion (755/1,228 `'use client'` files), training-worker isolation,
  production profiling evidence. **Blog:** none.

### PRD 23 — Manager PR review, acceptance & ticket recovery
`task_reviews` lifecycle bridge, `ticket_dispositions` (dry-run), Manager canary flag shipped.
- **Open:** no live canary run / applied disposition batch (`applied_at` NULL); end-to-end
  green-PR canary proof. **Blog:** none dedicated (`role-gated-accountability…` covers signoffs input).

### PRD 25 / 25a — Vertical KPI dashboards
Slice A shipped: vocabulary (migration 1176), founder-layer presets, dashboard template kind,
`/finance` dashboard tab.
- **Open:** Slices B–D — growth/LTV metrics, exit waterfall, TAM-SAM-SOM, the other 8 verticals.
  **Blog:** `install-your-verticals-kpi-dashboard`.

### PRD 26 — Advisor platform (epic #2522)
`advisory` meeting kind registered; meetings/minutes infrastructure and an advisory surface exist.
- **Open:** Advisors talent filter, dedicated Meeting Notes agent, generalised minutes→board pull.
  **Blog:** none dedicated.

### PRD 30 — Prompt-driven marketing campaign
Canvas journey prompt direction approved; campaign ROI counters partial.
- **Open:** the journey build; ROI currently gap (`opens/clicks` are not ROI). **Blog:** campaign
  articles exist (`post-your-launch-video-to-youtube…`); none for the journey itself.

### PRD 31 — Customer app platform
W2 AppBlueprint (14 detectors, MCP tools) + W1 preview UI/API built.
- **Open:** W4–W7 provision/deploy/marketplace — no Cloudflare/Neon provisioning, no
  infra ledger, no build/deploy pipeline. **Blog:** none.

### PRD 33 — Session replay & heatmaps
Every slice S0–S8 built in code (rrweb replay, privacy masking, heatmaps, live visitors,
funnels/AI summaries). Per PRD: not yet compiled/test-run by the planning session; live
validation (§11) needs the operator.
- **Blog:** `see-what-every-conversation-costs`-adjacent insights posts; replay-specific post
  is the Insights pair (`see-why-visitors-leave`, `fix-what-visitors-tell-you`).

### PRD 37 — Coordinated role participation · Mostly built
Migrations 0334/0336, `ticketCoordinator.ts`, `coordinateTicket.ts`, `AccountabilityTab.tsx` shipped.
- **Open:** lane chaining / one notifier; per-role audit verification + Coordinator-routed
  stakeholder notifications. **Blog:** none dedicated.

### PRD 41 — Offline understanding & the run delta
Capability states (WS1), SQLite fact store (WS2), changeset records, one-folder-many-systems
(A9–A11) shipped.
- **Open:** the run delta itself (Part C — no `changeset:` reader yet), Part D `stats` module,
  offline drawing for linked workspaces. **Blog:** `watch-your-codebase-review-run`,
  `no-account-no-gpu-you-choose-where-it-runs`, `one-folder-many-systems`.

---

## Not built / design only

### PRD 39 — Platform close-out · design only
Each program (API Worker split, comment store, `agents` table, production hardening) waits for
operator review. **Blog:** n/a.

### PRD 43 — Knowledge 3D stage · design, revised 2026-11-08
One shared WebGL stage for every camera. Part A (compute worker) in flight; Part B
(`SceneSpec`/`CameraRig`/instanced stage, `src/stage/`) absent. **Blog:** n/a
(`build-a-3d-world-in-the-browser` is a general tutorial).

---

## Actions taken this pass (2026-11-08)

1. **Deleted `42-prd-browser-built-in-models.md`** — complete, no open work, design archived
   in DONE.md; the only inbound reference was DONE.md's own archive note.
2. **Created blog articles for the shipped PRDs that lacked one** — `one-agent-one-kernel.md`
   (PRD 35) and `portable-knowledge-packs.md` (PRD 40); regenerated `blogIndex.generated.json`
   (189 → 191 posts, `--check` clean).
3. **Refreshed `docs/specs/README.md`** status index.

## Blog coverage summary

Most partly-built PRDs that shipped a user-visible slice already have a ship post. Genuinely
missing (feature not yet user-visible, or only scaffolding): PRDs 20, 22, 23, 31, 37, 39, 43.
These are intentionally not marketed until their build lands.
