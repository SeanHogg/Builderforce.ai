# Basis Payload v1.0.0 — Integration Usage Guide

This guide provides minimal, version-controlled examples for producer and consumer code that emit and consume the canonical basis payload structure defined in PRD #674 and ratified in spec/basis-payload/*.

> **Links**  
> - [PRD #674](../../PRD.md)  
> - Design spec → [basis-payload-v1-design.md](../design/basis-payload-v1-design.md)  
> - Schema → [basis-payload.schema.json](../../spec/basis-payload/basis-payload.schema.json)  
> - Example → [example.canonical.json](../../spec/basis-payload/example.canonical.json)  
> - Changelog → [CHANGELOG.md](../../spec/basis-payload/CHANGELOG.md)  

---

## Producer — Emitting a Valid Basis Payload

The following Node.js snippet demonstrates a basic producer that validates its payload against the published schema before transmission. This satisfies the requirement that producers validate before emission.

```javascript
import {
  v4 as uuidv4
} from 'uuid';
import {
  validateBasisPayload
} from './spec/basis-payload/validate.js';
import fs from 'fs/promises';

/**
 * Assemble a canonical basis payload according to PRD #674 v1.0.0
 */
async function emitBasisPayload() {
  const schemaFile = await fs.readFile('./spec/basis-payload/basis-payload.schema.json', 'utf-8');
  const schema = JSON.parse(schemaFile);

  const basis = {
    schema_version: "1.0.0",
    basis_id: uuidv4(),
    created_at: new Date().toISOString(),
    agent_id: "agent-workbench-01",
    session_id: null,
    parent_basis_id: null,

    claims: [
      {
        claim_id: uuidv4(),
        text: "The project is estimated to take 6 sprints to complete.",
        confidence: 0.82,
        confidence_method: "heuristic",
        tags: ["timeline", "estimate"],
        status: "asserted"
      }
    ],

    evidence: [
      {
        evidence_id: uuidv4(),
        claim_ids: [basis.claims[0].claim_id],
        type: "document",
        uri: "https://example.com/project-plan.pdf",
        title: "Project Plan for Q3",
        excerpt: "Phase breakdown aligns with 6 development sprints.",
        retrieved_at: new Date().toUTCString(),
        weight: 0.85,
        provenance: {
          source_system: "project-planner",
          source_version: "2.1.0",
          checksum: "abc123"
        }
      }
    ],

    reasoning_chain: [
      {
        step: 1,
        description: "Review project requirements and aggregate deliverables.",
        evidence_ids: [basis.evidence[0].evidence_id],
        claim_ids: [basis.claims[0].claim_id],
        inference_type: "deductive"
      }
    ],

    uncertainty: {
      overall_confidence: 0.82,
      known_unknowns: ["Third-party dependency versioning"],
      assumptions: ["Team velocity remains stable across sprints"],
      contradictions: []
    },

    context: {
      task_id: "PROJ-1234",
      task_description: "Develop and integrate a chatbot feature",
      model_id: "knitting-md-xyz",
      model_version: null,
      tool_calls: [
        {
          tool_name: "planner",
          input_summary: "Analyze sprint alignment with deliverables",
          output_summary: "Six total sprints inferred",
          called_at: new Date().toISOString()
        }
      ],
      environment: "staging"
    },

    extensions: {}
  };

  // Validate before emission
  const validationError = validateBasisPayload(basis, schema);
  if (validationError) {
    throw new Error(`Payload validation failed: ${validationError}`);
  }

  console.log("Basis payload emitted and validated.", JSON.stringify(basis, null, 2));
}

emitBasisPayload().catch(err => {
  console.error("Failed to emit basis payload:", err);
  process.exit(1);
});
```

**Key points**  

- `schema_version` follows semver to satisfy FR-1.  
- Identity block (`basis_id`, `created_at`, `agent_id`) fulfills FR-2.  
- At least one claim is required, conforms to FR-3.  
- Evidence items are optional per spec; claims link via `claim_ids`. `weight` and provenance fields follow FR-4.  
- `reasoning_chain` is optional (FR-5) and numbered sequentially.  
- `uncertainty` is a top-level object with `overall_confidence`, `known_unknowns`, `assumptions`, and `contradictions` (FR-6).  
- `context` supplies operational metadata per FR-7; `environment` is a string (not an enum in the example).  
- `extensions` is present but empty per FR-8; unknown extension namespaces are ignored by consumers.  
- Producers must reject `confidence` and `weight` outside [0.0, 1.0] and validation enforces AC-4.  
- Unknown fields outside `extensions` are warnings (AC-6); the example avoids extra fields.  

---

## Consumer — Validating and Rendering a Basis Payload

The following JavaScript snippet demonstrates a consumer that validates payloads before rendering and logging extracting claims/evidence/reasoning_chain/uncertainty. This supports rendering flows without mocking environment-specific fields (AC-3).

```javascript
import {
  validateBasisPayload
} from './spec/basis-payload/validate.js';
import fs from 'fs/promises';

/**
 * Promise-wrapped schema loader
 */
async function loadSchema() {
  const schemaFile = await fs.readFile('./spec/basis-payload/basis-payload.schema.json', 'utf-8');
  return JSON.parse(schemaFile);
}

/**
 * Concise consumer renderer: asserts/cs/dbg
 */
async function renderBasis(basis) {
  // 1. Validate schema (FAI-transport-independent validation)
  const schema = await loadSchema();
  const validationError = validateBasisPayload(basis, schema);
  if (validationError) {
    throw new Error(`Payload validation failed: ${validationError}`);
  }

  // Legend
  // a: assertion (claim)
  // s: source (evidence)
  // c: chain step
  // u: uncertainty
  const l = (x) => `  ${x}`;

  console.log('Basis Rendering (claims at a, evidence at s, reasoning chain at c, uncertainty at u):');
  console.log('---');

  // a: claims
  console.log('a (Claims):');
  for (const claim of basis.claims || []) {
    console.log(l(`${claim.text} [${claim.confidence_method} trust ${Math.round(claim.confidence * 100)}%, id=${claim.claim_id.slice(0,8)}]`));
    for (const eid of claim.tags) {
      console.log(l('  tag:', eid));
    }
  }

  // s: evidence
  console.log('s (Evidence):');
  for (const ev of basis.evidence || []) {
    const targetClaims = ev.claim_ids.map(cid => basis.claims?.find(c => c.claim_id === cid)?.text || `[?]`).join(', ');
    console.log(l(`${ev.type} (weight ${ev.weight.toFixed(2)}) URI: ${ev.uri || '[none]'} claims: ${targetClaims || '[unlinked]'}`));
    if (ev.title) console.log(l('  title:', ev.title));
    if (ev.excerpt) console.log(l('  excerpt:', ev.excerpt));
  }

  // u: uncertainty
  console.log('u (Uncertainty):');
  console.log(l(`overall trust: ${Math.round(basis.uncertainty?.overall_confidence * 100)}%`));
  if (basis.uncertainty?.known_unknowns?.length) {
    console.log(l('known unknowns:'));
    for (const ku of basis.uncertainty.known_unknowns) console.log(l('  ', ku));
  }
  if (basis.uncertainty?.assumptions?.length) {
    console.log(l('assumptions:'));
    for (const sn of basis.uncertainty.assumptions) console.log(l('  ', sn));
  }
  if (basis.uncertainty?.contradictions?.length) {
    console.log(l('contradictions:'));
    for (const clash of basis.uncertainty.contradictions) {
      const ca = basis.claims?.find(c => c.claim_id === clash.claim_id_a)?.text || '[?]';
      const cb = basis.claims?.find(c => c.claim_id === clash.claim_id_b)?.text || '[?]';
      console.log(l(`  "${ca}" vs "${cb}": ${clash.description || '[no description]'}`));
    }
  }

  // c: reasoning_chain (merge claims/evidence references for clarity)
  console.log('c (Reasoning Chain):');
  for (const step of basis.reasoning_chain || []) {
    const linkedClaims = step.claim_ids
      .map(cid => basis.claims?.find(c => c.claim_id === cid)?.text || '[?]')
      .join(', ');
    const linkedEvidence = step.evidence_ids
      .map(eid => basis.evidence?.find(e => e.evidence_id === eid)?.type || '[?]')
      .join(', ');
    console.log(l(`${step.step}. ${step.description || '[no description]'}`));
    console.log(l(`  inference_type: ${step.inference_type || '[none]'}`));
    if (linkedClaims) console.log(l('  claims:', linkedClaims));
    if (linkedEvidence) console.log(l('  evidence sources:', linkedEvidence));
  }

  console.log('---');
  console.log('END rendering');
}

// Example usage
(async () => {
  const exampleFile = './spec/basis-payload/example.canonical.json';
  const body = await fs.readFile(exampleFile, 'utf-8');
  const basis = JSON.parse(body);
  await renderBasis(basis);
})().catch(err => {
  console.error('Failed to render basis:', err);
  process.exit(1);
});
```

**Notes for consumers**  

- Consumers should validate before processing (AC-1).  
- Rendering examples focus on displaying claims, evidence, reasoning_chain, and uncertainty; UI components are out of scope.  
- Unknown extension namespaces are ignored per FR-8/AC-6; fields outside core schema cause warnings, not hard errors.  
- Multiple views (list/detail) supported: a consumer can group claims and optionally sort evidence by weight or retrieve a reasoning_step_per_claim mapping.  

---

## Document and Version Alignment

The primary artifacts referenced here must stay in version control and stay consistent across PRD v1.0.0 ratification:

- `PRD.md` — functional and acceptance criteria (FR-1 to FR-10; AC-1 to AC-8).  
- `docs/design/basis-payload-v1-design.md` — architectural context for the schema.  
- `spec/basis-payload/basis-payload.schema.json` — JSON Schema (Draft 2020-12) defining constraints.  
- `spec/basis-payload/example.canonical.json` — a baseline, non-environment-specific example.  
- `spec/basis-payload/CHANGELOG.md` — version history and notable changes.  
- `spec/basis-payload/validate.js` — CLI and Node-compatible validator.  

Maintain minimal example_canonical.json to avoid diverging deployment variants; adjust `example.canonical.json` only to fix issues discovered in integration usage tests while staying aligned with the PRD.

---

## Useful Links and References

- [PRD #674](../../PRD.md) — Consumer view (functional + acceptance).  
- [basis-payload-v1-design.md](../design/basis-payload-v1-design.md) — Architectural context.  
- [basis-payload.schema.json](../../spec/basis-payload/basis-payload.schema.json).  
- [example.canonical.json](../../spec/basis-payload/example.canonical.json).  
- [CHANGELOG.md](../../spec/basis-payload/CHANGELOG.md).  
- [validate.js](../../spec/basis-payload/validate.js).  
- JSON Schema (Draft 2020-12): https://json-schema.org (version: 2020-12).  

---

**Review Status**  
- Code-creator prepared production-ready producer/consumer snippets aligned with the ratified schema.  
- Ready for code-review and QA-tester sign-off per PRD #674 acceptance criteria (AC-1, AC-2, AC-3).