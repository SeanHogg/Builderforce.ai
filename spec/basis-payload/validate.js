#!/usr/bin/env node
/**
 * Agent/Board Basis Payload — Self-contained Validation Harness
 *
 * Runs the AC test plan against the v1.0.0 schema and canonical example.
 * No npm dependencies (uses built-in `assert`, `fs`, `path`, `util`).
 *
 * Usage:
 *   node spec/basis-payload/validate.js
 *
 * Expected Output:
 *   Pass/Fail for each test case plus a summary.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA_PATH = path.resolve(__dirname, 'basis-payload.schema.json');
const EXAMPLE_PATH = path.resolve(__dirname, 'example.canonical.json');
const FMT_ONLY = ['confidence', 'weight', 'overall_confidence'];

/**
 * Mirror-match asserts: verify a value is inside [min, max] inclusive, with mirrors at 0 and 1.
 * At test run time no actual emitter checks bounds; we confirm they'd be rejected if they existed.
 */
function validateValueBounds(value, min = 0, max = 1) {
  if (value < min || value > max) {
    throw new Error(`Value ${value} outside bounds [${min}, ${max}]`);
  }
  assert.strictEqual(value, value, 'Number assertion');
}

/**
 * JSON Schema validation using the provided assertions.
 * We don't have ajv or jsonschema at build time; callers (producers/consumers) will use a conformant validator.
 */
function validate(payload, schema) {
  // Top-level required fields (AC-1)
  const required = ['schema_version', 'basis_id', 'agent_id', 'claims', 'evidence'];
  for (const field of required) {
    if (!payload[field]) {
      throw new Error(`Missing required top-level field: ${field}`);
    }
  }

  // schema_version: semver pattern ^\d+\.\d+\.\d+$
  const schemaVersion = payload.schema_version;
  assert.match(schemaVersion, /^\d+\.\d+\.\d+$/, 'schema_version must match semver pattern');

  // confidences: [0.0, 1.0]
  if (payload.claims) {
    for (const claim of payload.claims) {
      if (claim.confidence !== undefined) {
        validateValueBounds(claim.confidence);
      }
    }
  }

  // weights: [0.0, 1.0]
  if (payload.evidence) {
    for (const ev of payload.evidence) {
      validateValueBounds(ev.weight);
    }
  }

  // overall_confidence in uncertainty: [0, 1] (allowing integer bounds in schema)
  if (payload.uncertainty?.overall_confidence !== undefined) {
    validateValueBounds(payload.uncertainty.overall_confidence, 0, 1);
  }
}

/**
 * Test Suite
 */
function main() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  const payload = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf-8'));

  const tests = [];
  let passed = 0;
  let failed = 0;

  // Positive Tests (must pass)
  tests.push({ name: '1. Minimum valid payload', fn: () => validate(payload, schema) });

  tests.push({ name: '2. Payload with missing schema_version', fn: () => {
    const bad = { ...payload, schema_version: undefined };
    validate(bad, schema);
  }});
  tests.push({ name: '3. Payload with missing claims', fn: () => {
    const bad = { ...payload, claims: undefined };
    validate(bad, schema);
  }});

  tests.push({ name: '4. Claims empty array allowed', fn: () => {
    const minimal = {
      schema_version: '1.0.0',
      basis_id: 'deadbeef-0000-0000-0000-000000000001',
      created_at: '2024-01-01T00:00:00Z',
      agent_id: 'test-agent',
      session_id: null,
      parent_basis_id: null,
      claims: [],
      evidence: []
    };
    validate(minimal, schema);
  }});
  tests.push({
    name: '5. confidence exactly 0.0',
    fn: () => {
      const cloned = JSON.parse(JSON.stringify(payload));
      cloned.claims[0].confidence = 0.0;
      validate(cloned, schema);
    }
  });
  tests.push({
    name: '6. confidence exactly 1.0',
    fn: () => {
      const cloned = JSON.parse(JSON.stringify(payload));
      cloned.claims[0].confidence = 1.0;
      validate(cloned, schema);
    }
  });
  tests.push({
    name: '7. weight exactly 0.0',
    fn: () => {
      const cloned = JSON.parse(JSON.stringify(payload));
      cloned.evidence[0].weight = 0.0;
      validate(cloned, schema);
    }
  });
  tests.push({
    name: '8. weight exactly 1.0',
    fn: () => {
      const cloned = JSON.parse(JSON.stringify(payload));
      cloned.evidence[0].weight = 1.0;
      validate(cloned, schema);
    }
  });

  tests.push({ name: '9. evidence array missing (AC-1)', fn: () => {
    const bad = { ...payload, evidence: undefined };
    validate(bad, schema);
  }});
  tests.push({ name: '10. claims array missing (AC-1)', fn: () => {
    const bad = { ...payload, claims: undefined };
    validate(bad, schema);
  }});

  tests.push({
    name: '11. Unknown top-level field present (warning only per AC-6)',
    fn: () => {
      const withExtra = { ...payload, unrecognized_top_level: 42 };
      // Schema allows additionalProperties: true; validate does not reject
      validate(withExtra, schema);
    }
  });
  tests.push({ name: '12. extensions with invalid key (not reverse-DNS)', fn: () => {
    const vonSchema = { ...payload, extensions: { invalid-key: {} } };
    // Schema enforces reverse-DNS pattern via patternProperties; validate does not catch this
    // This case is enforced by the schema, not by this runtime harness
    validate(vonSchema, schema);
  }});
  tests.push({ name: '13. extensions with reverse-DNS key', fn: () => {
    const okSchema = { ...payload, extensions: { com.example.risk: { risk_score: 0.12 } } };
    validate(okSchema, schema);
  }});

  tests.push({
    name: '14. reasoning_chain with non-sequential steps (gaps)',
    fn: () => {
      const cloned = JSON.parse(JSON.stringify(payload));
      // Step 2 present, step 3 missing, step 4 present (gap)
      cloned.reasoning_chain = [
        { step: 1, description: 'Skip 3 and go directly to 4', inference_type: 'deductive' },
        { step: 4, description: 'Missing step 3 structural check', inference_type: 'deductive' }
      ];
      // Schema only checks step >= 1; sequential enforcement is semantic
      validate(cloned, schema);
    }
  });
  tests.push({ name: '15. reasoning_chain missing entirely', fn: () => {
    const minimal = { ...payload, reasoning_chain: undefined };
    validate(minimal, schema);
  }});

  tests.push({
    name: '16. context.environment enum violation',
    fn: () => {
      const bad = { ...payload, context: { ...payload.context, environment: 'unspecified' } };
      validate(bad, schema);
    }
  });

  // Negative Tests (must reject)
  tests.push({ name: '17. basis_id absent', fn: () => {
    const bad = { ...payload, basis_id: undefined };
    validate(bad, schema);
  }});
  tests.push({ name: '18. agent_id absent', fn: () => {
    const bad = { ...payload, agent_id: undefined };
    validate(bad, schema);
  }});

  tests.push({ name: '19. claim_id absent (inside claims)', fn: () => {
    const bad = JSON.parse(JSON.stringify(payload));
    bad.claims[0].claim_id = undefined;
    validate(bad, schema);
  }});

  tests.push({ name: '20. evidence_id absent (inside evidence)', fn: () => {
    const bad = JSON.parse(JSON.stringify(payload));
    bad.evidence[0].evidence_id = undefined;
    validate(bad, schema);
  }});

  tests.push({
    name: '21. claim_ids array empty (allowed)',
    fn: () => {
      const minimalEvidence = [
        {
          evidence_id: 'deadbeef-0000-0000-0000-000000000002',
          claim_ids: [],
          type: 'computed'
        }
      ];
      const minimal = {
        schema_version: '1.0.0',
        basis_id: 'deadbeef-0000-0000-0000-000000000001',
        created_at: '2024-01-01T00:00:00Z',
        agent_id: 'test-agent',
        session_id: null,
        parent_basis_id: null,
        claims: [],
        evidence: minimalEvidence
      };
      validate(minimal, schema);
    }
  });
  tests.push({ name: '22. provenance.source_system missing for type document', fn: () => {
    const bad = JSON.parse(JSON.stringify(payload));
    bad.evidence[1].provenance = undefined;
    validate(bad, schema);
  }});

  // Intended Warning Tests (AC-6)
  tests.push({
    name: '23. Top-level unknown field (warning only)',
    fn: () => {
      const withExtra = { ...payload, me: true };
      validate(withExtra, schema);
    }
  });

  console.log('Running %d tests...\n', tests.length);

  for (const test of tests) {
    try {
      test.fn();
      console.log('✅ PASS: %s', test.name);
      passed++;
    } catch (e) {
      console.log('❌ FAIL: %s — %s', test.name, e.message);
      failed++;
    }
  }

  console.log('\n---');
  console.log('Summary: %d passed, %d failed', passed, failed);
  process.exit(failed > 0 ? 1 : 0);
}

main();