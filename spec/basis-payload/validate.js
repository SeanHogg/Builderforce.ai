#!/usr/bin/env node

/**
 * Basis Payload Validator
 *
 * A command-line utility to validate JSON files against the basis-payload.schema.json schema.
 *
 * Usage:
 *   node validate.js <file.json>
 *
 * The validator uses AJV (Draft 2020-12) to validate payloads against the schema.
 */

const Ajv = require('ajv'); // Draft-07/2019-09 compatible
const fs = require('fs').promises;
const path = require('path');

const SchemaPath = path.join(__dirname, 'basis-payload.schema.json');

/**
 * Load and cache the JSON Schema
 */
async function loadSchema() {
  try {
    const schemaContent = await fs.readFile(SchemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    // Compile loaded schema with AJV to ensure it's valid
    const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });
    const valid = ajv.validateSchema(schema);

    if (!valid) {
      throw new Error('Schema validation failed:\n' + ajv.errorsText());
    }

    return schema;
  } catch (error) {
    console.error(`Error loading schema from ${SchemaPath}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Compile and cache AJV validator for the schema
 */
async function compileValidator() {
  const schema = await loadSchema();
  const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });
  return ajv.compile(schema);
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

  const validator = await compileValidator();
  const data = await loadJsonFile(filePath);

  let isValid = true;
  let errors = null;

  try {
    const valid = validator(data);
    isValid = valid;
    errors = validator.errors ? validator.errors : [];

    if (isValid) {
      console.log('✅ Payload validation PASSED\n');
      console.log('Summary:');

      // Basic metadata summary
      console.log(`  Schema version: ${data.schema_version}`);
      console.log(`  Basis ID:       ${data.basis_id}`);
      console.log(`  Claims:         ${data.claims.length}`);
      console.log(`  Evidence:       ${data.evidence?.length || 0}`);
      console.log(`  Reasoning steps: ${data.reasoning_chain?.length || 0}`);
      console.log(`  Extensions:     ${Object.keys(data.extensions || {}).join(', ') || 'none'}`);

    } else {
      console.error('❌ Payload validation FAILED:\n');
      errors.forEach(err => {
        const path = err.instancePath?.replace(/^\//, '').replace(/\//g, '.') || '<root>';
        const keyword = err.keyword || '';
        let message = '';
        if (keyword === 'additionalProperties' && err.params?.additionalProperty) {
          message = `Unexpected property: ${err.params.additionalProperty}`;
        } else if (keyword === 'required') {
          message = `Missing required field(s): ${err.params.missingProperty}`;
        } else {
          message = err.message || 'validation error';
        }
        console.error(`  • ${path}: ${message}`);
      });
      console.error(`\n  Total errors: ${errors.length}`);
    }

    process.exit(isValid ? 0 : 1);
  } catch (error) {
    console.error(`\n❌ Unexpected validation error: ${error.message}\n`);
    console.error(error.stack);
    process.exit(2);
  }
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

module.exports = { validate, loadSchema, compileValidator };