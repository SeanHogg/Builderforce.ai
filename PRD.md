> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #306
> _Each agent that updates this PRD signs its change below._

# PRD: Per-Dimension Breakdown with Evidence

## Problem & Goal

Analytics dashboards and evaluation tools currently surface aggregate scores and per-dimension numbers without explaining the reasoning behind them. Users see *what* scored poorly but not *why*, forcing them to dig through raw data manually or trust opaque ratings. This erodes confidence in the system and slows decision-making.

**Goal:** Augment every per-dimension score with inline, human-readable evidence — cited excerpts, data references, or reasoning traces — so users immediately understand what drove each rating.

---

## Target Users / ICP Roles

| Role | Pain Point | Primary Need |
|---|---|---|
| **Product Manager** | Can't act on a score of "3/5 for Clarity" without knowing which parts were unclear | Actionable, cited explanations per dimension |
| **QA / Eval Engineer** | Must manually correlate scores with source data to validate correctness | Reproducible evidence linked to scoring logic |
| **LLM / AI Researcher** | Needs to audit model outputs for bias or systematic failure modes | Full reasoning trace per dimension, not just final scores |
| **Business Analyst** | Presents evaluation results to stakeholders who demand justification | Exportable, readable evidence summaries |
| **End-User of a Scored Product** (e.g., writing assistant) | Receives feedback scores but doesn't know how to improve | Specific, excerpted examples tied to each dimension |

---

## Scope

### In Scope
- Per-dimension score display enhanced with evidence panels
- Evidence types: quoted excerpts, referenced data rows, model reasoning traces, rule matches
- UI component for collapsible evidence per dimension
- Backend logic to collect, store, and retrieve evidence at score-generation time
- Evidence rendered in evaluation reports, detail views, and exports (PDF, JSON, CSV)
- Support for text-based evaluation domains as the initial target (documents, conversations, model outputs)

### Out of Scope
- Redesign of the core scoring algorithm or rubric definitions
- Real-time streaming evidence (v1 is synchronous/batch only)
- Image or audio evidence rendering
- Multi-language evidence localization beyond English
- User annotation or rebuttal workflows on evidence (future phase)

---

## Functional Requirements

### FR-1 — Evidence Capture at Score Time
- When a dimension score is computed, the system **must** record the specific inputs, rules, or model reasoning that produced that score.
- Evidence must be stored atomically with the score record (same transaction / document).
- Each evidence item must carry: `source_type` (excerpt | data_ref | rule | reasoning_trace), `content`, `location` (char offset, row ID, or step index), and `confidence` (optional, 0–1).

### FR-2 — Per-Dimension Evidence Schema
Every dimension result object must conform to:
```json
{
  "dimension": "string",
  "score": "number",
  "max_score": "number",
  "label": "string",
  "summary": "string (≤ 120 chars, plain-language verdict)",
  "evidence": [
    {
      "source_type": "excerpt | data_ref | rule | reasoning_trace",
      "content": "string",
      "location": "string | object",
      "confidence": "number | null",
      "polarity": "positive | negative | neutral"
    }
  ]
}
```

### FR-3 — Evidence Panel UI Component
- Each dimension row in the UI must include an expandable **"Why?"** control.
- On expand, the panel displays:
  - Plain-language `summary` at the top
  - Ordered list of evidence items with `polarity` visually indicated (green / red / grey chip or icon)
  - Quoted `content` rendered in a styled blockquote or code block depending on `source_type`
  - `location` shown as a clickable anchor where applicable (jumps to source excerpt in document view)
- Collapsed state shows score + label only (no layout shift on expand).
- Panel is keyboard-accessible and screen-reader compatible (ARIA).

### FR-4 — Evidence in Exports
- JSON export: full evidence array included per dimension, no truncation.
- CSV export: `evidence_summary` column (pipe-delimited concatenation of top 3 evidence `content` strings, truncated to 500 chars).
- PDF export: evidence rendered as a sub-list under each dimension heading; positive evidence in normal weight, negative in **bold**.

### FR-5 — Evidence Completeness Validation
- A dimension score **must not** be saved without at least one evidence item (hard constraint for rule-based scorers).
- For model-generated scores, if the model returns no evidence, the system must insert a `reasoning_trace` item with the raw model output and flag the record with `evidence_quality: low`.
- A data quality dashboard metric — **Evidence Coverage Rate** — must be exposed: `(dimensions with ≥1 evidence item) / (total dimensions scored)`.

### FR-6 — Evidence Linking in Document View
- When the source is a document or conversation, evidence excerpts must be highlighted inline in the source view.
- Clicking a dimension's evidence item scrolls to and highlights the corresponding passage.
- Multiple overlapping evidence highlights must be visually distinguishable by dimension color.

### FR-7 — API Contract
- `GET /evaluations/{id}/dimensions` must return the full per-dimension evidence array.
- `GET /evaluations/{id}/dimensions/{dim}/evidence` must return only that dimension's evidence list.
- Both endpoints must support `?include_evidence=false` to return scores-only for performance-sensitive callers.

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | Every saved dimension score record contains at least one evidence item, or is flagged `evidence_quality: low` | Automated DB assertion in CI |
| AC-2 | The "Why?" panel renders within 200 ms of user interaction (no additional network call for pre-loaded data) | Lighthouse / Playwright perf test |
| AC-3 | Evidence polarity chips display correctly (green = positive, red = negative, grey = neutral) for all evidence types | Visual regression test (Percy or equivalent) |
| AC-4 | Clicking an evidence item in the panel scrolls to and highlights the correct passage in document view | Playwright E2E test |
| AC-5 | JSON export contains full, untruncated evidence arrays for all dimensions | Automated export diff against fixture |
| AC-6 | CSV export `evidence_summary` column is ≤ 500 chars and contains ≤ 3 pipe-separated items | Unit test on export formatter |
| AC-7 | `GET /evaluations/{id}/dimensions` response schema validates against FR-2 schema for 100% of test fixtures | Schema validation in API test suite |
| AC-8 | `?include_evidence=false` reduces response payload by ≥ 60% compared to default | Automated payload size assertion |
| AC-9 | Evidence panel passes WCAG 2.1 AA accessibility audit | axe-core automated scan + manual keyboard walkthrough |
| AC-10 | Evidence Coverage Rate metric appears on the data quality dashboard and updates within 5 min of new evaluations | QA manual verification against seeded data |

---

## Out of Scope

- **Scoring rubric changes** — existing dimension definitions and weighting are frozen for this feature.
- **Real-time / streaming evidence** — evidence is captured and returned after scoring completes; live token-by-token reasoning trace is a separate workstream.
- **User rebuttal or annotation** — the ability for users to dispute or label evidence items is deferred to a follow-on phase.
- **Non-English evidence content** — UI and schema support Unicode strings, but localization of evidence text itself is not required.
- **Image, audio, or video evidence** — evidence `content` is string-only in v1; multi-modal evidence types are out of scope.
- **Historical backfill** — existing evaluation records without evidence will not be retroactively re-scored; they will appear with `evidence_quality: missing` label only.
- **Comparative evidence across evaluations** — showing why Score A changed vs. Score B across runs is a future analytics feature.