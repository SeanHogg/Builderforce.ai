> **PRD** — drafted by Ada (Sr. Product Mgr) · task #163
> _Each agent that updates this PRD signs its change below._

# PRD: Retrain & Transfer — Feed Learnings to Future Models

## Problem & Goal

Evermind accumulates validated learnings from user interactions, feedback loops, and correction signals, but these learnings currently die at the session boundary. There is no systematic mechanism to propagate them back into future model behaviour — either immediately (via context) or permanently (via weight updates). This creates a compounding knowledge debt: the system repeatedly makes the same recoverable mistakes, fails to personalise at scale, and cannot demonstrate measurable improvement over time.

**Goal:** Build a durable, observable transfer layer that closes the feedback loop — taking validated learnings from the learning store and systematically injecting them into future Evermind model responses through four coordinated mechanisms: RAG-based prompt augmentation, fine-tuning dataset generation, retrain pipeline integration, and A/B benchmark validation.

---

## Target Users / ICP Roles

| Role | Relationship to This System |
|---|---|
| **ML Engineer** | Owns pipeline configuration, retrain triggers, dataset versioning, and model promotion gates |
| **AI Product Manager** | Monitors uplift metrics, approves retrain cycles, reviews A/B benchmark results |
| **Data Scientist** | Curates learning quality, tunes retrieval relevance thresholds, analyses benchmark outputs |
| **Platform / MLOps Engineer** | Integrates retrain pipeline with CI/CD, manages compute scheduling and artifact storage |
| **End User (indirect)** | Benefits from progressively more accurate and contextually aware model responses |

---

## Scope

This PRD covers the full transfer layer from the validated learning store to measurable model improvement, across four subsystems:

1. **RAG / Prompt Injection** — immediate, inference-time context augmentation
2. **Fine-Tuning Dataset Generation** — structured export of learnings into training-ready formats
3. **Model Retrain Pipeline Integration** — orchestrated retraining with learning-enriched datasets
4. **A/B Benchmark Validation** — instrumented measurement of uplift attributable to transferred learnings

It does not cover the upstream processes that produce and validate learnings (assumed complete) or downstream user-facing product features.

---

## Functional Requirements

### 1. RAG / Prompt Injection

**FR-1.1** The system shall maintain a vector index of all validated learnings, updated incrementally within 5 minutes of a learning being marked validated in the learning store.

**FR-1.2** At inference time, the retrieval module shall query the learning index using the current user query and conversation context, returning the top-K most semantically relevant learnings (K configurable, default 5).

**FR-1.3** Retrieved learnings shall be injected into the system prompt under a clearly delimited section (`## Validated Learnings`) with metadata: learning ID, source type, confidence score, and creation date.

**FR-1.4** The injection layer shall enforce a maximum token budget for injected learnings (configurable, default 800 tokens), truncating lower-ranked results when the budget is exceeded.

**FR-1.5** Retrieval relevance threshold shall be configurable (default cosine similarity ≥ 0.75); learnings below threshold shall not be injected regardless of K.

**FR-1.6** A/B flag support: prompt injection shall be disableable per-request or per-cohort for controlled experiments.

---

### 2. Fine-Tuning Dataset Generation

**FR-2.1** The system shall expose a dataset generation pipeline that reads from the validated learning store and produces structured training examples in standard fine-tuning formats (OpenAI JSONL, Alpaca JSON, and HuggingFace `datasets`-compatible Parquet).

**FR-2.2** Each training example shall be derived from a validated learning and its source interaction, containing at minimum: `system`, `user`, and `assistant` fields, plus metadata fields for learning ID, validation source, and quality score.

**FR-2.3** The pipeline shall support incremental generation: on each run, only net-new validated learnings since the last export timestamp shall be processed and appended to the dataset.

**FR-2.4** The pipeline shall apply configurable quality filters before inclusion: minimum confidence threshold (default 0.80), deduplication by semantic similarity (threshold configurable, default 0.92), and exclusion of learnings flagged for review.

**FR-2.5** Generated datasets shall be versioned with a semantic version tag, stored in the artifact store, and accompanied by a manifest file capturing: record count, date range, quality filter parameters, and SHA-256 checksum.

**FR-2.6** A dry-run mode shall produce dataset statistics and sample records without writing to the artifact store.

---

### 3. Model Retrain Pipeline Integration

**FR-3.1** The retrain pipeline shall accept a versioned fine-tuning dataset artifact as input and support both full fine-tune and parameter-efficient fine-tuning (PEFT/LoRA) modes, selectable via configuration.

**FR-3.2** Pipeline execution shall be triggerable via: (a) manual invocation by an authorised ML Engineer, (b) scheduled cron trigger, and (c) event-driven trigger when the validated learning store exceeds a configurable net-new record threshold (default 500 new records).

**FR-3.3** The pipeline shall enforce a pre-retrain checklist gate: dataset minimum size (configurable), dataset version not previously used for a successful retrain, and compute resource availability check.

**FR-3.4** Training runs shall emit structured logs and metrics (training loss, validation loss, perplexity) to the observability platform at configurable intervals (default every 50 steps).

**FR-3.5** On completion, the pipeline shall register the new model artifact in the model registry with: base model reference, fine-tuning dataset version, training configuration snapshot, and evaluation metric summary.

**FR-3.6** The pipeline shall support rollback: any promoted model version shall retain its predecessor artifact and be revertible via a single CLI command or API call.

**FR-3.7** Personally identifiable information (PII) detection shall run on the dataset prior to training; records containing detected PII shall be quarantined and the pipeline shall halt with an error unless the operator explicitly overrides with documented justification.

---

### 4. A/B Benchmark Validation

**FR-4.1** The benchmarking subsystem shall support two evaluation modes: (a) offline evaluation against a held-out golden dataset, and (b) online shadow evaluation replaying live traffic against a control (no transfer) and treatment (with transfer) model variant.

**FR-4.2** Offline evaluation shall compute and report: task accuracy delta, BLEU/ROUGE scores, hallucination rate proxy, and user preference win-rate (where human preference labels are available) — all compared against the control baseline.

**FR-4.3** Online A/B evaluation shall support configurable traffic splits (default 50/50), with deterministic user-level assignment to ensure a user consistently hits the same variant within an experiment window.

**FR-4.4** The system shall automatically compute statistical significance (two-proportion z-test, configurable α threshold, default 0.05) and surface a clear pass/fail promotion recommendation when sample size thresholds are met.

**FR-4.5** A benchmark dashboard shall display, per experiment: variant assignment counts, primary metric uplift with confidence intervals, secondary metric regressions (if any), time-to-significance estimate, and promotion readiness status.

**FR-4.6** The system shall emit an alert (via configured channel: Slack, PagerDuty, email) if a treatment variant shows statistically significant regression on any guardrail metric (e.g., safety refusal rate drops, toxicity rate increases).

**FR-4.7** Experiment results shall be persisted in an immutable experiment log for audit and reproducibility purposes; results shall not be deletable through standard tooling.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A validated learning written to the store appears in the RAG index and is retrievable at inference time within 5 minutes, confirmed by integration test. |
| AC-2 | Prompt injection inserts correctly formatted learnings under the `## Validated Learnings` delimiter without exceeding the configured token budget in 100% of test cases. |
| AC-3 | Dataset generation pipeline produces valid JSONL, JSON, and Parquet outputs for a 1,000-record test learning store; all records pass schema validation and the manifest checksum is verified. |
| AC-4 | Incremental dataset generation on a second run with 200 new learnings appends exactly 200 records (minus filtered) without duplicating existing records. |
| AC-5 | PII detection halts the retrain pipeline and quarantines offending records before any training compute is provisioned, verified with synthetic PII injection test. |
| AC-6 | A retrain pipeline run completes end-to-end (dataset in → model artifact registered) in a staging environment within the SLA defined for the target model size class, with all required metadata present in the model registry entry. |
| AC-7 | Rollback to a previous model version completes via single CLI command in under 2 minutes with zero traffic loss, verified by smoke test. |
| AC-8 | Offline benchmark on a 500-sample golden dataset produces a complete report including all FR-4.2 metrics, with statistical significance calculation correct to within 0.1% of a reference implementation. |
| AC-9 | Online A/B experiment correctly routes the same user to the same variant on 100 consecutive requests within an experiment window (deterministic assignment). |
| AC-10 | Guardrail regression alert fires within 3 minutes of a simulated guardrail metric breach in staging, confirmed by alert receipt in the configured channel. |
| AC-11 | All pipeline runs (dataset generation, retrain, benchmark) are captured in the audit log with operator identity, timestamps, input artifact versions, and outcome status. |

---

## Out of Scope

- **Upstream learning validation logic** — the criteria and workflows by which raw interactions become validated learnings are owned by a separate system and assumed as input.
- **Base model pre-training** — this PRD covers fine-tuning and transfer only; training a model from scratch is not in scope.
- **User-facing UI for learning management** — browsing, editing, or manually creating learnings via a product interface is a separate workstream.
- **Multi-tenant / per-user model personalisation** — all mechanisms described here operate at the shared model level; per-user fine-tuned model variants are out of scope.
- **Real-time streaming fine-tuning / online learning** — continuous gradient updates at inference time are not addressed; the retrain pipeline operates in batch mode.
- **Model architecture changes** — this system consumes a fixed base model architecture; architecture search or structural modifications are out of scope.
- **Data labelling tooling** — human annotation workflows and labelling interfaces for preference data generation are managed by a separate team.
- **Regulatory approval workflows** — compliance, legal sign-off, or model cards for regulated deployment contexts are out of scope for this engineering PRD.