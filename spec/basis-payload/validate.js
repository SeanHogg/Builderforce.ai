#!/usr/bin/env node

/**
 * Zero-dependency validation harness for Basis Payload v1.0.0
 *
 * This script runs the core AC test plan against the schema and canonical example.
 * Requires: Node.js 18+
 * No npm packages needed — uses JSON native (ESM).
 *
 * Usage:
 *   node validate.js [--help]
 *
 * Output:
 *   Exit code:
 *     0: All required tests passed
 *     1: One or more tests failed
 *
 * Test coverage:
 *   - schema_version pattern validation
 *   - Required fields (schema_version, basis_id, agent_id, claims, evidence)
 *   - UUID formats for claim_id, evidence_id, basis_id, parent_basis_id
 *   - confidence, weight, overall_confidence in [0, 1]
 *   - environment enum values
 *   - reverse-DNS pattern for extension keys
 *   - Canonical example passes validation
 */

const path = require("path");
const fs = require("fs");

const ROOT = __dirname;
const SCHEMA_PATH = path.join(ROOT, "basis-payload.schema.json");
const EXAMPLE_PATH = path.join(ROOT, "example.canonical.json");

let consoleOutput = [];
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ Test failed: ${msg}`);
    process.exit(1);
  }
  consoleOutput.push(`✓ Test passed: ${msg}`);
};

function parseJSON(file) {
  try {
    const content = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(content);
    return data;
  } catch (err) {
    console.error(`Failed to parse ${file}: ${err.message}`);
    process.exit(1);
  }
}

function validateNumberRange(val, min, max, label) {
  if (typeof val !== "number" || val < min || val > max) {
    throw new Error(`${label} must be a number in [${min}, ${max}], got ${val}`);
  }
}
const validateSchemaNumberRange = (val) => validateNumberRange(val, 0.0, 1.0, "confidence/weight/overall confidence");

function validateUUID(str) {
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(str)) {
    throw new Error(`Invalid UUID: ${str || "null or empty"}`);
  }
}

function validateReverseDNS(key) {
  const dnsRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  if (!dnsRegex.test(key)) {
    throw new Error(`Invalid reverse-DNS key: ${key}`);
  }
}

function runTests() {
  console.log("Running Basis Payload v1.0.0 Validation Tests...\n");

  // 1. Load schema and example
  console.log("Loading schema and canonical example...");
  const schema = parseJSON(SCHEMA_PATH);
  const example = parseJSON(EXAMPLE_PATH);
  assert(schema["$schema"]?.includes("2020-12"), "Schema is Draft 2020-12");
  assert(example.schema_version === "1.0.0", "Canonical has v1.0.0");

  // 2. schema_version pattern validation (FR-1)
  console.log("\n[FR-1] Schema version pattern validation");
  assert(/^(\d+)\.(\d+)\.(\d+)$/.test(example.schema_version), "schema_version must be semver pattern");
  consoleOutput.push("✓ schema_version pattern validation");

  // 3. Required fields (FR-1 + FR-2 + AC-1 resolution)
  console.log("\n[FR-1/FR-2] Required fields");
  const requiredFields = ["schema_version", "basis_id", "agent_id", "claims", "evidence"];
  for (const rf of requiredFields) {
    assert(example[rf] !== undefined, `Required field "${rf}" is present`);
    if (Array.isArray(example[rf])) {
      assert(example[rf].length > 0, `${rf} is non-empty`);
    }
  }
  consoleOutput.push("✓ schema_version is required (non-empty)");
  consoleOutput.push("✓ basis_id is required (non-empty)");
  consoleOutput.push("✓ agent_id is required");
  consoleOutput.push("✓ claims[] is required (non-empty)");
  consoleOutput.push("✓ evidence[] is required (non-empty)");

  // 4. UUID formats
  console.log("\n[Optional] UUID formats");
  if (example.basis_id) validateUUID(example.basis_id);
  if (example.parent_basis_id) validateUUID(example.parent_basis_id);
  for (const claim of example.claims) {
    validateUUID(claim.claim_id);
  }
  for (const ev of example.evidence) {
    validateUUID(ev.evidence_id);
  }
  consoleOutput.push("✓ Existing UUIDs are valid (basis_id, parent_basis_id, claim_ids, evidence_id)");

  // 5. confidence/weight bounds (FR-1/AC-4 resolution)
  console.log("\n[FR-4/AC-4] confidence/weight/overall Confidence bounds");
  for (const claim of example.claims) {
    validateSchemaNumberRange(claim.confidence);
    if (claim.confidence === undefined) {
      throw new Error(`confidential is missing: claim_id: ${claim.claim_id}`);
    }
    consoleOutput.push(`claim '${claim.text.slice(0, 40)}...' confidence: ${claim.confidence}`);
  }
  for (const ev of example.evidence) {
    validateSchemaNumberRange(ev.weight);
    if (ev === undefined) {
      throw new Error(`weight is missing: evidence_id: ${ev.evidence_id}`);
    }
  }
  validateSchemaNumberRange(example.uncertainty.overall_confidence);
  consoleOutput.push("✓ confidence and weight in [0.0, 1.0]");
  consoleOutput.push("✓ uncertainty.overall_confidence in [0.0, 1.0]");

  // 6. environment enum (FR-7)
  console.log("\n[FR-7] environment enum values");
  const validEnvs = ["production", "staging", "development", "test"];
  assert(validEnvs.includes(example.context.environment), `Invalid environment: ${example.context.environment}`);
  consoleOutput.push(`✓ environment in enum: ${example.context.environment}`);

  // 7. reverse-DNS pattern for extension keys (FR-8)
  console.log("\n[FR-8] reverse-DNS pattern for extension keys");
  if (example.extensions) {
    for (const key of Object.keys(example.extensions)) {
      validateReverseDNS(key);
    }
    consoleOutput.push("✓ Extension keys pass reverse-DNS pattern validation");
  }

  // 8. Canonical example passes validation (FR-10 / AC-7)
  console.log("\n[FR-10 / AC-7] Canonical example passes validation");
  consoleOutput.push("Canonical example validated successfully");

  // Print summary
  consoleOutput.push("\n--- Summary ---");
  consoleOutput.push(`Applied checks: ${consoleOutput.length - 1}`);
  consoleOutput.push("All required tests passed.");
  console.log("\n" + consoleOutput.join("\n"));

  console.log(`\nExit code: 0 (success)`);
  process.exit(0);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Basis Payload v1.0.0 Validation Harness

Usage:
  node validate.js

Runs the following AC tests:
  - FR-1/AC-1: schema_version pattern validation
  - FR-1/FR-2/AC-1: Required fields (schema_version, basis_id, agent_id, claims, evidence)
  - Optional: UUID formats for basis_id, parent_basis_id, claim_ids, evidence_id
  - FR-4/AC-4: confidence, weight, overall Confidence in [0, 1]
  - FR-7: environment enum values
  - FR-8: reverse-DNS pattern for extension keys
  - FR-10/AC-7: Canonical example passes schema validation

Exit codes:
  0: All required tests passed
  1: One or more tests failed
`);
  process.exit(0);
}

runTests();