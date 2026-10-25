# docs

The one home for written specs, design docs and reference material. New documents go here,
not in a new top-level folder.

| Folder | What lives there |
|---|---|
| [`specs/`](specs/) | Product PRDs and implementation notes, numbered (`NN-prd-*.md`; `NNa-*` is the build hand-off for `NN`). [`specs/README.md`](specs/README.md) is the index; `specs/data-model/` is the consolidation coverage map the `check:burnrate-parity` / model-coverage guards read. |
| [`design/`](design/) | UI and system design docs (creation canvas, the PRD 35 one-kernel design, the local-first review). |
| [`compliance/`](compliance/) | Privacy, accessibility and data-processing policies and assessments. |
| [`guides/`](guides/) | How-to guides for contributors. |
| [`marketing/`](marketing/) | Marketing process rules (claims review). |
| [`partnerships/`](partnerships/) | Integration approval requests to third parties. |
| [`api/`](api/) | Machine-readable API contracts (schemas). |
| `private/` | **Operator-only, gitignored.** Strategy, competitor analysis, pitch-deck source, GTM and pricing research. This repository is public — anything that should not be read by competitors goes here (or in a `*.local.md` file), never in a tracked folder. |

Not here, on purpose:

- **`specs/tasks/task-<id>.md`** (repository root) — per-task PRDs the platform's agents
  commit to every bound repository (`commitPrdToRepo.ts`). That path is a product contract,
  so it stays where agents write it.
- **`ROADMAP.md` / `DONE.md`** (repository root) — outstanding work and its finished record.
- **`docs-site/`** — the published end-user documentation site.
- **Package `docs/` folders** (`agent-runtime/docs`, `sdk/docs`, …) — documentation that
  ships with that package.
