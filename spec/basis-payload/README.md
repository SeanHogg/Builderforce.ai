# Agent/Board Basis Payload Structure — Spec

This directory contains the canonical, versioned contract for **basis** payloads that
agents produce and boards consume. See the root [PRD.md](../../PRD.md) (task #674) for
the product requirements.

## Contents

| File | Purpose |
|------|---------|
| [`basis-payload.schema.json`](./basis-payload.schema.json) | JSON Schema (Draft 2020-12) artifact — the machine-readable, validating contract. |
| [`basis-payload.md`](./basis-payload.md) | Human-readable reference documentation, integration guidelines, and rendering guidance. |
| [`example.canonical.json`](./example.canonical.json) | Full canonical example payload that validates against the schema (FR-10 / AC-7). |
| [`validate.js`](./validate.js) | Self-contained Node.js (18+) validation script — validates the canonical example and runs the AC test plan (no npm dependencies). |
| [`CHANGELOG.md`](./CHANGELOG.md) | Versioned changelog; the current schema version is **1.0.0** (AC-8). |

## Current Version

`1.0.0` — tagged in version control as `basis-payload-v1.0.0`.

## Validating a payload

The schema is a standard JSON Schema Draft 2020-12 document, so any conformant
validator can check a payload against it. For example:

```bash
# Node.js, using ajv-cli (with the 2020-12 dialect + format assertions enabled)
npx ajv-cli validate \
  --spec=draft2020 \
  -c ajv-formats \
  -s spec/basis-payload/basis-payload.schema.json \
  -d spec/basis-payload/example.canonical.json
```

```python
# Python, using jsonschema
import json
from jsonschema import Draft202012Validator

schema = json.load(open("spec/basis-payload/basis-payload.schema.json"))
payload = json.load(open("spec/basis-payload/example.canonical.json"))
Draft202012Validator(schema).validate(payload)  # raises on invalid
```

## Requirement traceability

| Requirement | Where satisfied |
|-------------|-----------------|
| FR-1 Schema versioning | `schema_version` (required, semver pattern) in schema |
| FR-2 Basis identity | `basis_id`, `created_at`, `agent_id`, `session_id`, `parent_basis_id` |
| FR-3 Claim block | `claims[]` (required) with bounded `confidence` |
| FR-4 Evidence block | `evidence[]` items referenced by `claim_ids`, `weight`, `provenance` |
| FR-5 Reasoning chain | `reasoning_chain[]` with sequential `step` |
| FR-6 Uncertainty | `uncertainty` object |
| FR-7 Context | `context` object with `tool_calls[]` |
| FR-8 Extensions | `extensions` with reverse-DNS namespaces |
| FR-9 Validation | This JSON Schema (Draft 2020-12) + producer/consumer rules in docs |
| FR-10 Canonical example | `example.canonical.json` |
