# Specs — the domain PRDs

Open product work lives in **one PRD per stage of the arc**. Each file holds only what is left to build;
finished sections are archived word for word in [DONE.md](../../DONE.md). Outstanding work is also tracked
in [ROADMAP.md](../../ROADMAP.md) (the Consolidated Gap Register), under the same stage. Consolidated and
verified against the code on 2026-11-17.

| Domain | File | Holds |
|---|---|---|
| 💡 Idea | [idea.md](./idea.md) | Ideas, sessions, briefs, creation-canvas sessions, experiments, surveys |
| 🔨 Make | [make.md](./make.md) | Agent runs and the kernel, autonomous delivery, knowledge graph and local-first, canvas runtimes, the customer app platform |
| ⚙️ Run | [run.md](./run.md) | Governance and SOC 2, BurnRateOS consolidation, hiring and HR, advisors |
| 📊 Measure | [measure.md](./measure.md) | Vertical KPI dashboards, Insights (session replay), creation outcome metrics |
| 📣 Reach | [reach.md](./reach.md) | Marketing campaigns, the blog capability register, the company directory, marketing content |
| 🧰 Platform | [platform.md](./platform.md) | Data model, the UI design system and collection view, browser performance, identity federation, close-out, search, typed ids, cutover |

## Where a numbered PRD went

A citation like `PRD 38 §4.3` resolves to the `## PRD 38` section of its domain file when that section is
still open. If the section is missing there, it shipped, and you'll find it in DONE.md under
"PRD 38: finished sections archived on consolidation" or an earlier PRD 38 entry. Numbers are never reused.

| PRD | Title | Domain file | State on 2026-11-17 |
|---|---|---|---|
| 05 | Integration, embed-back & identity federation | platform | Mostly built |
| 08 | Agentic security & governance | run | Partly built |
| 09 | Cloud agent validation & hardening | make | Mostly built |
| 18 | hired.video port | run (hiring), make (studio), reach (content), platform (cutover) | Mostly built |
| 19 | burnrateos.com consolidation | run | Mostly built; shutdown gates open |
| 20 | Consolidated data model | platform | Mostly built |
| 21 | Unified experience: the design system (start here for UI work) | platform (rules + build), reach (company claim) | Mostly built |
| 22 | Browser performance & code health | platform | Partly built |
| 23 | Manager PR review & ticket recovery | make | Mostly built, dry-run only |
| 25 / 25a | Vertical KPI dashboards | measure | Partly built (Slice A) |
| 26 | Advisor platform | run ([redirect](./26-prd-advisor-platform.md) kept for board links) | Partly built |
| 30 | Prompt-driven marketing campaign | reach | Partly built |
| 31 | Customer app platform | make | Partly built |
| 33 | Insights: session replay | measure | Shipped in code; provisioning open |
| 35 | One agent, one kernel | — | Shipped (DONE.md) |
| 37 | Coordinated role participation | make | Shipped except 3 gaps |
| 38 | Knowledge graph & extraction | make | Mostly built |
| 39 | Platform close-out | platform | Mostly built |
| 40 | Portable knowledge packs | — | Shipped (DONE.md) |
| 41 | Offline understanding & the run delta | make | Mostly built |
| 43 | Knowledge 3D stage | make | Mostly built |
| 45 | Deterministic run gates | make | Mostly built |
| 46 | Agent-run findings | — | Shipped (DONE.md) |
| 47 | One Collection view | platform | Partly built (W0 landed) |
| — | SOC 2 Type I checklist | run | Partly built |
| — | Internet search subsystem | platform | Phases 1–2 shipped |
| — | Blog capability gap register | reach | Open |
| — | Agent framework registrations | make | Shipped; legacy-table drop open |

## Also here

- [API-CONTRACTS.md](./API-CONTRACTS.md): the standing wire contracts.
- [MERGE_PROCESS.md](./MERGE_PROCESS.md): the merge checklist.
- [`data-model/`](./data-model/): the consolidation coverage map read by the `check:burnrate-parity` and
  model-coverage guards.
- [`tasks/`](./tasks/): per-ticket PRDs (`task-<id>.md`) committed by the platform
  (`api/src/application/repos/commitPrdToRepo.ts`). These are snapshots and may cite retired PRD paths;
  use the table above.

Design references live in [`../design/`](../design/). Code headers cite them, and their open items are
carried in the domain files. Implementation guides (email, multi-auth) live in [`../guides/`](../guides/).
