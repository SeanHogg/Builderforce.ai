> **PRD** — drafted by Ada (Sr. Product Mgr) · task #159
> _Each agent that updates this PRD signs its change below._

# PRD: Knowledge Baseline — Seed Corpus & Versioned Snapshots

## Problem & Goal

AI-assisted systems that track knowledge drift, generate delta reports, or audit compliance against a reference state require a stable, immutable "t₀ baseline" to measure against. Without a rigorously versioned and sealed starting point, all downstream comparisons are unreliable: diffs are noisy, regressions go undetected, and audit trails are invalid.

**Goal:** Design and implement a Knowledge Baseline system that ingests a heterogeneous seed corpus (documents, facts, rules, and procedures), constructs a versioned knowledge graph and snapshot, and seals the baseline so it serves as the authoritative t₀ reference for all future delta computations.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| **Knowledge Engineer** | Defines, curates, and publishes the seed corpus; triggers baseline sealing |
| **ML / AI Engineer** | Consumes the baseline snapshot via API for training, fine-tuning, and evaluation pipelines |
| **Compliance / Audit Officer** | Relies on sealed baselines as immutable evidence for regulatory audit trails |
| **Platform / DevOps Engineer** | Operates the ingestion pipeline, manages storage backends, and handles versioning infrastructure |
| **Product / Domain Analyst** | Queries baseline contents to validate coverage before sealing |

---

## Scope

### In Scope (v1.0)

- Seed corpus ingestion pipeline supporting four content types: **Documents**, **Facts**, **Rules**, and **Procedures**
- Knowledge graph construction from ingested content (entities, relationships, and typed edges)
- Snapshot generation producing a portable, serialized representation of the graph at a point in time
- Baseline versioning with semantic version tagging (e.g., `baseline/v1.0.0`)
- Baseline sealing mechanism that renders a snapshot immutable and cryptographically signed
- Metadata manifest attached to every snapshot (provenance, content hash, author, timestamp, seal status)
- Query API for reading baseline contents (read-only after sealing)
- CLI and/or REST API surface for ingestion, snapshotting, and sealing operations
- Storage adapter interface supporting at minimum: local filesystem and object store (e.g., S3-compatible)

---

## Functional Requirements

### FR-1 Seed Corpus Ingestion

**FR-1.1** The system must accept the following seed input types:

| Type | Description | Accepted Formats |
|---|---|---|
| Document | Free-form or structured textual artifacts | PDF, DOCX, Markdown, plain text, HTML |
| Fact | Discrete, atomic assertions (subject–predicate–object or key-value) | JSON, CSV, YAML, RDF/Turtle |
| Rule | Conditional logic expressions or policy statements | JSON-Logic, YAML rule DSL, Drools DRL (read-only parse) |
| Procedure | Ordered sequences of steps or workflows | BPMN (XML), Markdown checklists, YAML workflow definitions |

**FR-1.2** Ingestion must validate each artifact against its declared type schema before graph insertion; invalid artifacts must be rejected with a structured error report and must not partially enter the graph.

**FR-1.3** The pipeline must support both **batch ingestion** (directory/archive upload) and **single-artifact ingestion** via API.

**FR-1.4** Duplicate detection must be performed using content-addressed hashing (SHA-256); duplicate artifacts must be flagged and skipped unless an `--allow-overwrite` flag is explicitly set.

**FR-1.5** Ingestion jobs must be idempotent: re-running the same job against the same corpus must produce the same graph state.

---

### FR-2 Knowledge Graph Construction

**FR-2.1** All ingested artifacts must be represented as typed nodes in a directed knowledge graph with the following node types: `Document`, `Fact`, `Rule`, `Procedure`, `Entity`, `Concept`.

**FR-2.2** The graph engine must extract and link named entities and concepts across artifact types (cross-artifact relationship edges).

**FR-2.3** Edges must carry typed relationship labels (e.g., `DEFINES`, `REFERENCES`, `DERIVED_FROM`, `GOVERNS`, `PRECEDES`) and an optional confidence score (0.0–1.0) for machine-extracted relationships.

**FR-2.4** Human-asserted relationships must be distinguishable from machine-extracted relationships via a `source` attribute on the edge (`human` | `extracted`).

**FR-2.5** The graph must expose a query interface supporting at minimum: node lookup by ID, neighbor traversal, subgraph extraction by type filter, and full-text search on node content.

---

### FR-3 Snapshot Generation

**FR-3.1** A snapshot must capture the complete graph state (all nodes, edges, and metadata) at the moment it is generated.

**FR-3.2** Snapshots must be serialized in a **deterministic, reproducible format** such that identical graph states always produce byte-identical snapshots.

**FR-3.3** Each snapshot must include a **manifest** containing:
- Snapshot UUID
- Parent baseline version (if derived)
- Creation timestamp (UTC ISO-8601)
- Content hash of the serialized graph (SHA-256)
- Artifact count by type
- Author / system identity
- Seal status (`DRAFT` | `SEALED`)

**FR-3.4** Snapshots must be exportable to at least one portable interchange format: **JSON-LD** and/or **RDF N-Quads**.

**FR-3.5** The system must support incremental snapshot preview (dry-run) that reports what would change without writing to storage.

---

### FR-4 Versioning

**FR-4.1** Baselines must follow **semantic versioning** (`MAJOR.MINOR.PATCH`) with an optional pre-release label (e.g., `v1.0.0-rc1`).

**FR-4.2** Version tags must be immutable once a baseline is sealed; creating a new version always produces a new version number.

**FR-4.3** The system must maintain a **version lineage graph** recording parent-child relationships between baseline versions.

**FR-4.4** Each version must be addressable by its semantic version tag and by its snapshot UUID.

**FR-4.5** The system must expose a version listing API returning all baselines with status, timestamp, and artifact counts.

---

### FR-5 Baseline Sealing

**FR-5.1** Sealing must be an explicit, irreversible operation requiring either an authorized user action or a verified CI/CD gate signal.

**FR-5.2** Upon sealing, the system must:
1. Finalize the snapshot and compute its canonical content hash.
2. Sign the hash using an asymmetric key (RSA-4096 or Ed25519); store the signature alongside the manifest.
3. Mark the baseline record as `SEALED` in the version registry.
4. Make all graph nodes and edges read-only; write operations must return `403 Sealed`.

**FR-5.3** A sealed baseline must remain queryable indefinitely and must not be deletable through normal API operations (deletion requires an explicit privileged purge command with audit log entry).

**FR-5.4** The sealing operation must be atomic: if any step fails, the baseline reverts to `DRAFT` and an error is logged.

**FR-5.5** The system must emit a `baseline.sealed` event (webhook or message-bus) carrying the version tag, snapshot UUID, and content hash for downstream consumers.

---

### FR-6 Access & Query API

**FR-6.1** Provide a REST API and a CLI with the following operations:

| Operation | REST | CLI |
|---|---|---|
| Ingest corpus | `POST /baselines/{id}/ingest` | `kb ingest --baseline <id> --path <dir>` |
| Create snapshot | `POST /baselines/{id}/snapshot` | `kb snapshot --baseline <id>` |
| Seal baseline | `POST /baselines/{id}/seal` | `kb seal --baseline <id>` |
| List versions | `GET /baselines` | `kb list` |
| Get manifest | `GET /baselines/{id}/manifest` | `kb manifest --baseline <id>` |
| Query graph | `GET /baselines/{id}/graph/query` | `kb query --baseline <id> --filter <expr>` |
| Export snapshot | `GET /baselines/{id}/export?format=jsonld` | `kb export --baseline <id> --format jsonld` |

**FR-6.2** All API responses must include the baseline version tag and seal status in response headers (`X-KB-Version`, `X-KB-Seal-Status`).

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | Given a valid seed corpus containing at least one artifact of each type (Document, Fact, Rule, Procedure), the ingestion pipeline completes without errors and all artifacts are represented as typed nodes in the knowledge graph. |
| AC-02 | Given two ingestion runs of the identical corpus, the resulting knowledge graph state (node set, edge set, and all attribute values) is byte-for-byte identical (idempotency). |
| AC-03 | Given an artifact that fails schema validation, the ingestion pipeline rejects that artifact, returns a structured error, and leaves the graph state unchanged (no partial writes). |
| AC-04 | Given a duplicate artifact (same SHA-256 hash), the system flags and skips it by default; with `--allow-overwrite` the artifact replaces the existing node without creating a duplicate. |
| AC-05 | A generated snapshot manifest contains all required fields (UUID, timestamp, content hash, artifact counts by type, author, seal status = `DRAFT`). |
| AC-06 | Two snapshots generated from the same graph state in different environments produce the same content hash, confirming deterministic serialization. |
| AC-07 | A sealed baseline returns `403 Sealed` for any write operation (ingest, node update, edge delete) attempted against it via API or CLI. |
| AC-08 | The cryptographic signature on a sealed baseline manifest is verifiable using the corresponding public key. |
| AC-09 | The `baseline.sealed` event is emitted within 5 seconds of a successful seal operation and contains the correct version tag, snapshot UUID, and content hash. |
| AC-10 | A sealed baseline cannot be deleted via the standard DELETE API endpoint; only a privileged purge command with explicit confirmation succeeds and records an audit log entry. |
| AC-11 | The version listing API returns all baselines with accurate status, creation timestamp, and artifact counts; lineage (parent-child) relationships are correctly reflected. |
| AC-12 | Snapshot export in JSON-LD format passes validation against the JSON-LD 1.1 specification. |
| AC-13 | Ingestion of a 10,000-artifact corpus (mixed types) completes within 10 minutes on reference hardware (8-core CPU, 16 GB RAM) in batch mode. |
| AC-14 | The dry-run snapshot preview correctly reports the count and types of nodes and edges that would be written, without modifying storage. |

---

## Out of Scope

- **Delta computation and drift detection** — consuming baselines to generate change reports is handled by a separate Delta Engine service.
- **Real-time / streaming ingestion** — v1.0 supports batch and single-artifact modes only; streaming connectors (Kafka, CDC) are deferred to v2.
- **Ontology management UI** — visual graph editing or ontology authoring tooling is not part of this system.
- **ML model training or embedding generation** — the baseline is a structured knowledge artifact, not a training dataset pipeline; embedding generation may be added as a post-seal processor in a later phase.
- **Multi-tenancy and tenant isolation** — v1.0 targets single-tenant deployment; RBAC scoped to tenants is deferred.
- **Conflict resolution for concurrent ingestion jobs** — concurrent writes are not supported in v1.0; callers must serialize ingestion jobs.
- **Automated ontology extraction / schema inference** — the graph schema (node types, edge label vocabulary) is defined statically in v1.0.
- **Baseline merging** — merging two independent baseline lineages is out of scope for v1.0.
- **Long-term archival and cold storage tiering** — storage lifecycle policies beyond "keep forever" are deferred to platform-level infrastructure decisions.