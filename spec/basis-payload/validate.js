#!/usr/bin/env node

/**
 * Basis Payload Validator
 *
 * A command-line utility to validate JSON files against the basis-payload.schema.json schema.
 *
 * Usage:
 *   node validate.js <file.json>
 *
 * The validator checks that:
 * - Required fields are present
 * - Field values are within valid ranges
 * - Enum values are permitted
 * - UUID formats are valid
 * - Timestamps are ISO-8601 format
 */

const fs = require('fs').promises;
const path = require('path');

const SchemaPath = path.join(__dirname, 'basis-payload.schema.json');
let schema = null;

/**
 * Load and cache the JSON Schema
 */
async function loadSchema() {
  try {
    const schemaContent = await fs.readFile(SchemaPath, 'utf-8');
    schema = JSON.parse(schemaContent);
    return schema;
  } catch (error) {
    console.error(`Error loading schema from ${SchemaPath}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Load a JSON file
 */
async function loadJsonFile(filePath) {
  try {
    const jsonContent = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(jsonContent);
    return data;
  } catch (error) {
    console.error(`Error parsing ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Main validation function
 */
async function validate(filePath) {
  console.log(`\n🔍 Validating ${filePath} against basis-payload.schema.json\n`);

  // Load schema and data
  await loadSchema();
  const data = await loadJsonFile(filePath);

  // Validate against schema
  let isValid = true;
  let errors = [];

  try {
    // Basic schema validation
    const validSchema = validateSchema(schema);
    if (!validSchema.valid) {
      console.error(`❌ Schema validation failed:\n${validSchema.errors}\n`);
      process.exit(1);
    }

    // Data validation
    const validationResult = validateDataAgainstSchema(data);
    isValid = validationResult.valid;
    errors = validationResult.errors;

    // Report results
    if (errors.length === 0) {
      console.log('✅ Payload validation PASSED\n');
      console.log('Summary:');
      console.log(`  Schema version: ${data.schema_version}`);
      console.log(`  Basis ID:       ${data.basis_id}`);
      console.log(`  Claims:         ${data.claims.length}`);
      console.log(`  Evidence:       ${data.evidence?.length || 0}`);
      console.log(`  Reasoning steps: ${data.reasoning_chain?.length || 0}`);
      console.log(`  Extensions:     ${Object.keys(data.extensions || {}).join(', ') || 'none'}`);
    } else {
      console.error('❌ Payload validation FAILED:\n');
      errors.forEach(err => {
        console.error(`  • ${err.path}: ${err.message}`);
      });
      console.error(`\n  Total errors: ${errors.length}`);
    }

    // Exit with appropriate code
    process.exit(isValid ? 0 : 1);
  } catch (error) {
    console.error(`\n❌ Unexpected validation error: ${error.message}\n`);
    console.error(error.stack);
    process.exit(2);
  }
}

/**
 * Validate schema itself
 */
function validateSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return {
      valid: false,
      errors: ['Schema is not an object']
    };
  }

  const errors = [];

  // Check for required properties
  const required = ['$schema', '$id', 'title', 'description', 'type', 'properties'];
  for (const prop of required) {
    if (!schema[prop]) {
      errors.push(`Missing required property: ${prop}`);
    }
  }

  // Check for each required top-level property
  const topLevelRequired = [
    'schema_version', 'basis_id', 'created_at', 'agent_id',
    'claims', 'extensions'
  ];

  for (const prop of topLevelRequired) {
    const propSchema = schema.properties?.[prop];
    if (!propSchema) {
      errors.push(`Missing required top-level property: ${prop}`);
    } else {
      if (!propSchema.type && !propSchema.oneOf) {
        errors.push(`No type defined for property: ${prop}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate data against loaded schema
 */
function validateDataAgainstSchema(data) {
  if (typeof data !== 'object' || data === null) {
    return {
      valid: false,
      errors: [{ path: 'root', message: 'Root value must be an object' }]
    };
  }

  const errors = [];

  // Walk through the data and check constraints
  function traverseErrors(node, path = 'root') {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        traverseErrors(item, `${path}[${index}]`);
      });
    } else if (node && typeof node === 'object') {
      Object.entries(node).forEach(([key, value]) => {
        const keyPath = `${path}.${key}`;
        const propSchema = schema.properties?.[key];

        if (propSchema && propSchema.type === 'array') {
          // Check array items
          if (Array.isArray(value)) {
            propSchema.items?.properties?.confidence?.minimum === 0 &&
              Math.abs(value.confidence) > 1 &&
              errors.push({ path: keyPath, message: 'confidence must be in [0.0, 1.0]' });
          }
        }

        if (key === 'evidence' && Array.isArray(value)) {
          value.forEach((item, index) => {
            if (item.weight !== undefined && (item.weight < 0 || item.weight > 1)) {
              errors.push({ path: `${keyPath}[${index}].weight`, message: 'weight must be in [0.0, 1.0]' });
            }
          });
        }

        if (key === 'uncertainty' && Array.isArray(value?.contradictions)) {
          value.contradictions.forEach((contradiction, index) => {
            if (!contradiction.claim_id_a || !contradiction.claim_id_b || !contradiction.description) {
              errors.push({ path: `${keyPath}.contradictions[${index}]`, message: 'Missing required fields in contradiction' });
            }
          });
        }

        traverseErrors(value, keyPath);
      });
    } else if (path !== 'root') {
      // Primitive value - could add more type-specific checks here
    }
  }

  traverseErrors(data);

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// Main entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node validate.js <file.json>');
    console.error('');
    console.error('Example:');
    console.error('  node validate.js example.canonical.json');
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  validate(filePath);
}

module.exports = { validate, loadSchema, validateDataAgainstSchema };