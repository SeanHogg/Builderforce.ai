/**
 * validate.js — Self-contained schema validation for the Agent/Board Basis Payload v1.0.0
 *
 * This script loads the JSON Schema (Draft 2020-12) and the canonical example,
 * then runs the test plan defined in the PRD's Test Evidence section.
 *
 * Requires: Node.js 18+ (no npm dependencies; uses built-in JSON + URL modules).
 *
 * Usage:
 *   node spec/basis-payload/validate.js
 *
 * Exit codes:
 *   0 — all tests pass
 *   1 — one or more tests failed
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Minimal JSON Schema Draft 2020-12 validator (standalone, no deps)
// ---------------------------------------------------------------------------

function resolveRef(schema, ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`Only local #/... refs are supported (got ${ref})`);
  const parts = ref.slice(2).split('/');
  let node = root;
  for (const p of parts) {
    if (node && typeof node === 'object' && p in node) node = node[p];
    else return undefined;
  }
  return node;
}

function validateSchema(instance, schemaDef, root) {
  const errors = [];
  const s = schemaDef || {};

  // $ref
  if (s.$ref) {
    const resolved = resolveRef(s.$ref, root);
    if (resolved) {
      return validateSchema(instance, resolved, root);
    }
    errors.push(`Unresolvable $ref: ${s.$ref}`);
    return errors;
  }

  // type
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const typeMap = {
      string: 'string',
      number: 'number',
      integer: 'integer',
      boolean: 'boolean',
      object: 'object',
      array: 'array',
      null: 'null',
    };
    const actual = typeof instance;
    const actualType = actual === 'number' && Number.isInteger(instance) ? 'integer' : actual;
    const isNull = instance === null;

    if (!types.some(t => (t === 'null' && isNull) || typeMap[t] === actualType)) {
      errors.push(`Expected type(s) ${JSON.stringify(types)}, got ${actualType}`);
    }
  }

  // enum
  if (s.enum && !s.enum.includes(instance)) {
    errors.push(`Value ${JSON.stringify(instance)} not in enum ${JSON.stringify(s.enum)}`);
  }

  // const
  if (s.const !== undefined && instance !== s.const) {
    errors.push(`Expected const ${JSON.stringify(s.const)}, got ${JSON.stringify(instance)}`);
  }

  // pattern
  if (s.pattern && typeof instance === 'string') {
    const re = new RegExp(s.pattern);
    if (!re.test(instance)) {
      errors.push(`String ${JSON.stringify(instance)} does not match pattern ${s.pattern}`);
    }
  }

  // format — light checks
  if (s.format && typeof instance === 'string') {
    if (s.format === 'date-time' && isNaN(Date.parse(instance))) {
      errors.push(`String ${JSON.stringify(instance)} is not a valid date-time`);
    }
    if (s.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instance)) {
      errors.push(`String ${JSON.stringify(instance)} is not a valid UUID`);
    }
  }

  // minimum / maximum
  if (typeof instance === 'number') {
    if (s.minimum !== undefined && instance < s.minimum) {
      errors.push(`Number ${instance} is less than minimum ${s.minimum}`);
    }
    if (s.maximum !== undefined && instance > s.maximum) {
      errors.push(`Number ${instance} is greater than maximum ${s.maximum}`);
    }
  }

  // minLength / maxLength
  if (typeof instance === 'string') {
    if (s.minLength !== undefined && instance.length < s.minLength) {
      errors.push(`String length ${instance.length} < minLength ${s.minLength}`);
    }
    if (s.maxLength !== undefined && instance.length > s.maxLength) {
      errors.push(`String length ${instance.length} > maxLength ${s.maxLength}`);
    }
  }

  // minItems / maxItems
  if (Array.isArray(instance)) {
    if (s.minItems !== undefined && instance.length < s.minItems) {
      errors.push(`Array length ${instance.length} < minItems ${s.minItems}`);
    }
    if (s.maxItems !== undefined && instance.length > s.maxItems) {
      errors.push(`Array length ${instance.length} > maxItems ${s.maxItems}`);
    }
  }

  // required
  if (s.required && Array.isArray(s.required) && typeof instance === 'object' && instance !== null && !Array.isArray(instance)) {
    for (const key of s.required) {
      if (!(key in instance)) {
        errors.push(`Missing required property: ${key}`);
      }
    }
  }

  // properties
  if (s.properties && typeof instance === 'object' && instance !== null && !Array.isArray(instance)) {
    for (const [key, propSchema] of Object.entries(s.properties)) {
      if (key in instance) {
        const subErrors = validateSchema(instance[key], propSchema, root);
        for (const e of subErrors) errors.push(`${key}.${e}`);
      }
    }
  }

  // patternProperties
  if (s.patternProperties && typeof instance === 'object' && instance !== null) {
    for (const [pattern, propSchema] of Object.entries(s.patternProperties)) {
      const re = new RegExp(pattern);
      for (const key of Object.keys(instance)) {
        if (re.test(key)) {
          const subErrors = validateSchema(instance[key], propSchema, root);
          for (const e of subErrors) errors.push(`${key}.${e}`);
        }
      }
    }
  }

  // items (array)
  if (s.items && Array.isArray(instance)) {
    for (let i = 0; i < instance.length; i++) {
      const subErrors = validateSchema(instance[i], s.items, root);
      for (const e of subErrors) errors.push(`[${i}].${e}`);
    }
  }

  // additionalProperties (only check when false)
  if (s.additionalProperties === false && s.properties && typeof instance === 'object' && instance !== null) {
    for (const key of Object.keys(instance)) {
      if (!(key in s.properties) && !(s.patternProperties && Object.keys(s.patternProperties).some(p => new RegExp(p).test(key)))) {
        errors.push(`Additional property not allowed: ${key}`);
      }
    }
  }

  // allOf
  if (s.allOf) {
    for (const sub of s.allOf) {
      for (const e of validateSchema(instance, sub, root)) errors.push(`allOf: ${e}`);
    }
  }

  // anyOf
  if (s.anyOf) {
    let anyPassed = false;
    for (const sub of s.anyOf) {
      if (validateSchema(instance, sub, root).length === 0) {
        anyPassed = true;
        break;
      }
    }
    if (!anyPassed) {
      errors.push(`Value does not match anyOf`);
    }
  }

  // oneOf
  if (s.oneOf) {
    let matchCount = 0;
    for (const sub of s.oneOf) {
      if (validateSchema(instance, sub, root).length === 0) matchCount++;
    }
    if (matchCount !== 1) {
      errors.push(`Value matches ${matchCount} oneOf schemas (expected exactly 1)`);
    }
  }

  return errors;
}

function validate(doc, schema) {
  return validateSchema(doc, schema, schema);
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ---------------------------------------------------------------------------
// Load artifacts
// ---------------------------------------------------------------------------

const schemaPath = resolve(__dirname, 'basis-payload.schema.json');
const examplePath = resolve(__dirname, 'example.canonical.json');

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
const example = JSON.parse(readFileSync(examplePath, 'utf-8'));

// ---------------------------------------------------------------------------
// Test suite (mirrors test plan from PRD)
// ---------------------------------------------------------------------------

console.log(`\nBasis Payload Schema Validation Test Suite — ${schema.title} ${schema.description}\n`);

// === Positive Tests ===

test('TP-1: Canonical example validates successfully', () => {
  const errs = validate(example, schema);
  assert(errs.length === 0, `Validation errors: ${JSON.stringify(errs)}`);
});

test('TP-2: Payload with empty claims array is valid', () => {
  const p = { ...example, claims: [] };
  const errs = validate(p, schema);
  assert(errs.length === 0, `Unexpected errors: ${JSON.stringify(errs)}`);
});

test('TP-4: confidence = 0.0 and 1.0 are valid', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.claims[0].confidence = 0.0;
  p.claims[1].confidence = 1.0;
  const errs = validate(p, schema);
  assert(errs.length === 0, `Unexpected errors: ${JSON.stringify(errs)}`);
});

test('TP-5: weight = 0.0 and 1.0 are valid', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.evidence[0].weight = 0.0;
  p.evidence[1].weight = 1.0;
  const errs = validate(p, schema);
  assert(errs.length === 0, `Unexpected errors: ${JSON.stringify(errs)}`);
});

test('TP-6: reasoning_chain missing is valid (optional)', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.reasoning_chain;
  const errs = validate(p, schema);
  assert(errs.length === 0, `Unexpected errors: ${JSON.stringify(errs)}`);
});

// === Negative / Reject Tests ===

test('TN-1: Missing schema_version is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.schema_version;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('schema_version')), `Expected error about missing schema_version`);
});

test('TN-2: Missing basis_id is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.basis_id;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('basis_id')), `Expected error about missing basis_id`);
});

test('TN-3: Missing agent_id is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.agent_id;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('agent_id')), `Expected error about missing agent_id`);
});

test('TN-4: Missing claims is rejected (AC-1)', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.claims;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('claims')), `Expected error about missing claims`);
});

test('TN-5: Missing evidence is rejected (AC-1)', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.evidence;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('evidence')), `Expected error about missing evidence`);
});

test('TN-6: confidence outside [0,1] is rejected (AC-4)', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.claims[0].confidence = 1.5;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('confidence') && e.includes('maximum')), `Expected maximum error for confidence`);
});

test('TN-7: weight outside [0,1] is rejected (AC-4)', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.evidence[0].weight = -0.1;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('weight') && e.includes('minimum')), `Expected minimum error for weight`);
});

test('TN-8: claim_id missing inside a claim is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.claims[0].claim_id;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('claim_id')), `Expected error about missing claim_id`);
});

test('TN-9: evidence_id missing inside evidence is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  delete p.evidence[0].evidence_id;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('evidence_id')), `Expected error about missing evidence_id`);
});

test('TN-10: schema_version with invalid semver is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.schema_version = 'not-semver';
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('pattern')), `Expected pattern error for invalid semver`);
});

test('TN-11: invalid confidence_method enum is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.claims[0].confidence_method = 'made-up-method';
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('enum')), `Expected enum error for confidence_method`);
});

test('TN-12: invalid status enum is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.claims[0].status = 'unknown-status';
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('enum')), `Expected enum error for status`);
});

test('TN-13: invalid environment enum is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.context.environment = 'unspecified';
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('enum')), `Expected enum error for environment`);
});

test('TN-14: invalid evidence type enum is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.evidence[0].type = 'pdf-file';
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('enum')), `Expected enum error for evidence type`);
});

// === Extensions Tests ===

test('TE-1: Reverse-DNS extension key is accepted', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.extensions = { 'com.example.custom': { foo: 'bar' } };
  const errs = validate(p, schema);
  assert(errs.length === 0, `Unexpected errors for valid extension: ${JSON.stringify(errs)}`);
});

test('TE-2: Invalid extension key (non-reverse-DNS) is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.extensions = { 'invalid-key': { foo: 'bar' } };
  const errs = validate(p, schema);
  // patternProperties on extensions should catch this
  assert(errs.some(e => e.includes('additional') || e.includes('pattern')), `Expected error for invalid extension key`);
});

test('TE-3: Unknown top-level field is allowed (AC-6: additionalProperties: true at root)', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.unrecognized = 'should-not-fail';
  const errs = validate(p, schema);
  assert(errs.length === 0, `Unexpected errors for unknown field: ${JSON.stringify(errs)}`);
});

// === Reasoning Chain Tests ===

test('TR-1: reasoning_chain with non-integer step is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.reasoning_chain[0].step = 1.5;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('type')), `Expected type error for non-integer step`);
});

test('TR-2: reasoning_chain with step < 1 is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.reasoning_chain[0].step = 0;
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('minimum')), `Expected minimum error for step < 1`);
});

test('TR-3: invalid inference_type is rejected', () => {
  const p = JSON.parse(JSON.stringify(example));
  p.reasoning_chain[0].inference_type = 'bayesian';
  const errs = validate(p, schema);
  assert(errs.some(e => e.includes('enum')), `Expected enum error for inference_type`);
});

// === Changelog & Version Consistency ===

test('TL-1: Schema $id contains version 1.0.0', () => {
  assert(schema.$id && schema.$id.includes('1.0.0'), `Schema $id does not include 1.0.0: ${schema.$id}`);
});

// ============================================================================
// Summary
// ============================================================================

const total = passed + failed;
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
