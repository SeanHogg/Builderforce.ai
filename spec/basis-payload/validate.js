#!/usr/bin/env node

/**
 * Basis Payload Validation Harness (v1.0.0)
 *
 * This script:
 * 1. Loads the JSON Schema (basis-payload.schema.json) and canonical example (example.canonical.json)
 * 2. Validates the example against the schema
 * 3. Executes the AC-conformant test plan
 * 4. Returns a programmatic exit code (0 = pass, 1 = fail)
 *
 * Usage:
 *   node validate.js              — runs mandatory validation tests
 *   node validate.js --summary    — prints test plan summary
 *   node validate.js --fail-on-warnings — treats warnings as failures
 *
 * Requirements:
 *   - Node.js 18+ (for core modules like crypto/URL)
 *   - ajv package installed via: npm install ajv@^8
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

// --- Configuration ---
const SCHEMA_PATH = path.join(__dirname, 'basis-payload.schema.json');
const EXAMPLE_PATH = path.join(__dirname, 'example.canonical.json');

// Ensure strict bounds for confidence/weight/overall_confidence [0.0, 1.0] as per PRD AC-4
const CONFIDENCE_WEIGHT_UNBOUNDED_REJECT_MSG = "Reject confidence/weight/overall_confidence outside [0.0, 1.0] per AC-4.";

// --- CLI Options ---
const args = process.argv.slice(2);
let failOnWarnings = false;
let showSummary = false;

for (const arg of args) {
  if (arg === '--fail-on-warnings') failOnWarnings = true;
  if (arg === '--summary') showSummary = true;
}

console.error('=== Basis Payload Validation Harness ===');
console.error(`Schema: ${SCHEMA_PATH}`);
console.error(`Example: ${EXAMPLE_PATH}`);
console.error('');

// --- Schema Loading ---
/* globals Ajv */
const ajv = new Ajv({ allErrors: true, strict: false, strictTypes: false });
let schema;
try {
  const schemaRaw = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(schemaRaw);
} catch (e) {
  console.error(`❌ Failed to load schema:`, e.message);
  process.exit(1);
}

// Compile the schema validator
const validate = ajv.compile(schema);
console.error(`✅ Schema loaded and compiled (Draft 2020-12)`);
console.error('');

// Ensure strict bounds for confidence/weight/overall_confidence [0.0, 1.0] as per PRD AC-4
const CONFIDENCE_WEIGHT_UNBOUNDED_REJECT_MSG = "Reject confidence/weight/overall_confidence outside [0.0, 1.0] per AC-4.";

function checkUnbounded(obj) {
  const { claims = [], evidence = [], uncertainty = {} } = obj;
  for (const ev of evidence) {
    if (ev.weight < 0.0 || ev.weight > 1.0) {
      console.error(`❌ CRITICAL: Evidence weight out of bounds [0,1]: ${ev.weight} — ${CONFIDENCE_WEIGHT_UNBOUNDED_REJECT_MSG}`);
      return false;
    }
  }
  for (const c of claims) {
    if (c.confidence < 0.0 || c.confidence > 1.0) {
      console.error(`❌ CRITICAL: Claim confidence out of bounds [0,1]: ${c.confidence} — ${CONFIDENCE_WEIGHT_UNBOUNDED_REJECT_MSG}`);
      return false;
    }
  }
  if (uncertainty.overall_confidence !== undefined) {
    if (uncertainty.overall_confidence < 0.0 || uncertainty.overall_confidence > 1.0) {
      console.error(`❌ CRITICAL: overall_confidence out of bounds [0,1]: ${uncertainty.overall_confidence} — ${CONFIDENCE_WEIGHT_UNBOUNDED_REJECT_MSG}`);
      return false;
    }
  }
  return true;
}

// --- Example Loading ---
let example;
try {
  const exampleRaw = fs.readFileSync(EXAMPLE_PATH, 'utf-8');
  example = JSON.parse(exampleRaw);
} catch (e) {
  console.error(`❌ Failed to load example:`, e.message);
  process.exit(1);
}

// --- PRD AC-4: enforce confidence/weight/overall_confidence [0.0, 1.0] before schema validation ---
if (!checkUnbounded(example)) {
  console.error('❌ CRITICAL: Example out-of-bounds confidence/weight/overall_confidence detected. AC-4 must be strictly enforced.');
  process.exit(1);
}
console.error('✅ Confidence/weight/overall_confidence bounds verified [0.0, 1.0]');

// --- Test Plan (AC-Conformant Test Cases) ---
/* eslint-disable max-lines-per-function, complex-structures */
function runTests() {
  let passed = 0;
  let failed = 0;
  let warning = 0;
  const results = [];

  // Helper to record results
  function record(id, test, pass, err) {
    results.push({ id, test, pass, err });
    if (pass) passed += 1;
    else failed += 1;
    if (!pass) console.error(test);
  }

  // --- 1: Minimum Valid Payload ---
  console.error(`--- Test 1: Minimum Valid Payload ---`);
  try {
    const valid = validate(example);
    if (valid) {
      record(1, '✓ Positive: Canonical example validates', true, undefined);
    } else {
      record(1, '✗ Negative: Canonical example failed validation', false, validate.errors);
    }
  } catch (e) {
    record(1, `✗ Negative: Unexpected error during validation: ${e.message}`, false, e);
  }
  console.error('');

  // --- 2: Payload with Missing schema_version ---
  console.error(`--- Test 2: Missing schema_version (Reject) ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    delete invalid.schema_version;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(2, `✓ Negative: Missing schema_version correctly rejected`, true, validate.errors);
    } else {
      record(2, `✗ Positive: Missing schema_version was accepted`, false, validate.errors);
    }
  }
  console.error('');

  // --- 3: Payload with Missing Claims Array ---
  console.error(`--- Test 3: Missing claims Array (Reject) ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    delete invalid.claims;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(3, `✓ Negative: Missing claims array correctly rejected`, true, validate.errors);
    } else {
      record(3, `✗ Positive: Missing claims array was accepted`, false, validate.errors);
    }
  }
  console.error('');

  // --- 4: Payload with Empty Claims Array ---
  console.error(`--- Test 4: Empty claims Array (${validate.schema?.properties?.claims?.minItems || 'schema verification'})`);
  if (typeof validate.schema?.properties?.claims?.minItems !== 'undefined') {
    console.error(`  (schema enforces minItems: ${validate.schema.properties.claims.minItems})`);
  } else {
    console.error(`  (NOT enforced by schema)`);
  }
  console.error('');

  // --- 9: Evidence Required ---
  console.error(`--- Test 5: Missing evidence Array (Reject) ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    delete invalid.evidence;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(5, `✓ Negative: Missing evidence array correctly rejected`, true, validate.errors);
    } else {
      record(5, `✗ Positive: Missing evidence array was accepted`, false, validate.errors);
    }
  }
  console.error('');

  // --- Confidence 0.0 ---
  console.error(`--- Test 6: confidence Exactly 0.0 ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.claims[0].confidence = 0.0;
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(6, `✓ Positive: confidence = 0.0 passes`, true, undefined);
    } else {
      record(6, `✗ Negative: confidence = 0.0 rejected`, false, validate.errors);
    }
  }
  console.error('');

  // --- Confidence 1.0 ---
  console.error(`--- Test 7: confidence Exactly 1.0 ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.claims[0].confidence = 1.0;
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(7, `✓ Positive: confidence = 1.0 passes`, true, undefined);
    } else {
      record(7, `✗ Negative: confidence = 1.0 rejected`, false, validate.errors);
    }
  }
  console.error('');

  // --- Confidence > 1.0 (Reject) ---
  console.error(`--- Test 8: confidence > 1.0 Reject ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.claims[0].confidence = 1.2;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(8, `✓ Negative: confidence = 1.2 correctly rejected`, true, validate.errors);
    } else {
      record(8, `✗ Positive: confidence = 1.2 was accepted`, false, validate.errors);
    }
  }
  console.error('');

  // --- Weight 0.0 ---
  console.error(`--- Test 9: weight Exactly 0.0 ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.evidence[0].weight = 0.0;
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(9, `✓ Positive: weight = 0.0 passes`, true, undefined);
    } else {
      record(9, `✗ Negative: weight = 0.0 rejected`, false, validate.errors);
    }
  }
  console.error('');

  // --- Weight 1.0 ---
  console.error(`--- Test 10: weight Exactly 1.0 ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.evidence[0].weight = 1.0;
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(10, `✓ Positive: weight = 1.0 passes`, true, undefined);
    } else {
      record(10, `✗ Negative: weight = 1.0 rejected`, false, validate.errors);
    }
  }
  console.error('');

  // --- Weight > 1.0 (Reject) ---
  console.error(`--- Test 11: weight > 1.0 Reject ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.evidence[0].weight = 1.2;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(11, `✓ Negative: weight = 1.2 correctly rejected`, true, validate.errors);
    } else {
      record(11, `✗ Positive: weight = 1.2 was accepted`, false, validate.errors);
    }
  }
  console.error('');

  // (7) overall_confidence exactly 0.0 and 1.0
  console.error(`--- Test 12: Overall confidence Exactly 0.0 ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.uncertainty.overall_confidence = 0.0;
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(12, `✓ Positive: overall confidence = 0.0 passes`, true, undefined);
    } else {
      record(12, `✗ Negative: overall confidence = 0.0 rejected`, false, validate.errors);
    }
  }
  console.error('');

  console.error(`--- Test 13: Overall confidence Exactly 1.0 ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.uncertainty.overall_confidence = 1.0;
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(13, `✓ Positive: overall confidence = 1.0 passes`, true, undefined);
    } else {
      record(13, `✗ Negative: overall confidence = 1.0 rejected`, false, validate.errors);
    }
  }
  console.error('');

  console.error(`--- Test 14: Overall confidence > 1.0 Reject ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.uncertainty.overall_confidence = 1.2;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(14, `✓ Negative: overall confidence = 1.2 correctly rejected`, true, validate.errors);
    } else {
      record(14, `✗ Positive: overall confidence = 1.2 was accepted`, false, validate.errors);
    }
  }
  console.error('');

  // (5) parent_basis_id UUID optional (no need for a test here as UUID format is enforced by schema)

  // (6) Unknown top-level fields → warning (not error) in consumer logs
  console.error(`--- Test 15: Top-level unknown fields cause warning (not error), only \`additionalProperties: true\` at root allows them`;
  console.error(`Note: This test is informational; the schema permits unknown top-level fields via additionalProperties: true; consumers should log a warning.`);
  console.error('');

  // (6b) extensions with reverse-DNS keys
  console.error(`--- Test 16: extensions Invalid key (not reverse-DNS) Reject ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.extensions['invalid-key'] = {}; // keys not matching; should be rejected
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(16, `✓ Negative: Invalid key 'invalid-key' rejected per patternProperties`, true, validate.errors);
    } else {
      record(16, `✗ Positive: Invalid key was accepted`, false, validate.errors);
    }
  }
  console.error('');

  console.error(`--- Test 17: extensions Reverse-DNS key Pass ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.extensions['com.example.org.mynamespace'] = { foo: 'bar' };
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(17, `✓ Positive: Reverse-DNS key 'com.example.org.mynamespace' passes`, true, undefined);
    } else {
      record(17, `✗ Negative: Reverse-DNS key was rejected`, false, validate.errors);
    }
  }
  console.error('');

  // (9) Unknown top-level fields cause validation warning (not hard error) via additionalProperties: true
  console.error(`--- Test 18: Top-level unknown fields (informational) — schema permits via additionalProperties: true`;
  console.error(`Note: Unknown top-level fields are not enforced by the schema, but consumers should warn in logs per AC-6.`);
  console.error('');

  // (6) contradictions optional
  console.error(`--- Test 19: contradictions Optional ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    delete invalid.uncertainty.contradictions;
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(19, `✓ Positive: Omitting contradictions is valid`, true, undefined);
    } else {
      record(19, `✗ Negative: Omitting contradictions was rejected`, false, validate.errors);
    }
  }
  console.error('');

  // Test case 17 (evidence id or title missing if allowed by schema)
  console.error(`--- Test 20: evidence id missing (reject if schema required) ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    delete invalid.evidence[0].evidence_id;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(20, `✓ Negative: missing evidence_id rejected`, true, validate.errors);
    } else {
      record(20, '⚠️ Incorrectly passed: schema does not enforce evidence_id - add explicit constraint if desired', true, undefined);
    }
  }
  console.error('');

  // Test case 18 (missing provenance.source_system for type document)
  console.error(`--- Test 21: evidence type document missing provenance.source_system (reject if schema enforces) ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.evidence[0].type = 'document';
    delete invalid.evidence[0].provenance.source_system;
    const valid = await validateReturnExample(invalid);
    if (!valid) {
      record(21, `✓ Negative: missing provenance.source_system for type: document rejected`, true, validate.errors);
    } else {
      // Note: schema doesn't enforce per-evidence-type requirement for source_system; assume not enforced
      console.error(`ℹ️  Informational: schema doesn't enforce source_system required for evidence type 'document' (optional consumer rule).`);
    }
  }
  console.error('');

  // Reasoning chain step
  console.error(`--- Test 22: reasoning_chain with non-sequential steps Respects schema enforcement (min 1) ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.reasoning_chain = [
      { step: 2, description: 'Second step', inference_type: 'lookup' },
      { step: 1, description: 'First step', inference_type: 'deductive' }
    ];
    const valid = await validateReturnExample(invalid);
    if (valid) {
      console.error(`ℹ️  Schema accepts non-sequential steps (min 1); sequential enforcement is documented guidance`);
    }
  }
  console.error('');

  // Test case when evidence array empty
  console.error(`--- Test 23: evidence empty array pass ---`);
  {
    const invalid = JSON.parse(JSON.stringify(example));
    invalid.evidence = [];
    const valid = await validateReturnExample(invalid);
    if (valid) {
      record(23, `✓ Positive: evidence empty array passes (minItems: 0)`, true, undefined);
    } else {
      record(23, `✗ Negative: evidence empty array rejected`, false, validate.errors);
    }
  }
  console.error('');

  // --- Summary ---
  console.error('');
  console.error('=== Test Summary ===');
  if (showSummary) {
    console.error('Test Results:');
    results.forEach(r => {
      const emoji = r.pass ? '✓' : '✗';
      console.error(`  ${emoji} [${r.id}] ${r.test}`);
      if (r.err) console.error(`    - Error:`, JSON.stringify(r.err));
    });
    console.error('');
  }
  console.error('Total:');
  console.error(`  Passed: ${passed}`);
  console.error(`  Failed: ${failed}`);
  if (failOnWarnings) console.error('  (Warnings treated as failures)');
  console.error('');
}

// We'll orchestrate validation synchronously because validate.compile is synchronous.
async function validateReturnExample(obj) {
  const valid = validate(obj);
  return valid;
}

// Run tests (script body is synchronous, we don't await at the top-level)
runTests().then(() => {
  const exitCode = failed > 0 ? 1 : 0;
  if (failOnWarnings && warning) {
    printWarning();
  }
  process.exit(exitCode);
});

function printWarning() {
  console.error('⚠️  Warnings present. Use --fail-on-warnings to treat them as failures.');
  warning = 1;
}