#!/usr/bin/env node

/**
 * Quick test to verify basis-payload schema validation works
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const SCHEMA_PATH = path.join(__dirname, 'spec/basis-payload/basis-payload.schema.json');
const EXAMPLE_PATH = path.join(__dirname, 'spec/basis-payload/example.canonical.json');

const ajv = new Ajv({ allErrors: true, strict: false });

try {
  const schemaRaw = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const schema = JSON.parse(schemaRaw);
  const validate = ajv.compile(schema);
  
  const exampleRaw = fs.readFileSync(EXAMPLE_PATH, 'utf-8');
  const example = JSON.parse(exampleRaw);
  
  const valid = validate(example);
  
  if (valid) {
    console.log('✅ Schema validation PASSED for example.canonical.json');
    console.log(`   Schema version: ${example.schema_version}`);
    console.log(`   Basis ID: ${example.basis_id}`);
    console.log(`   Claims: ${example.claims.length}`);
    console.log(`   Evidence: ${example.evidence.length}`);
    process.exit(0);
  } else {
    console.log('❌ Schema validation FAILED');
    console.log('   Errors:');
    validate.errors.forEach(err => {
      console.log(`   - Path: ${err.instancePath}, Message: ${err.message}, Value: ${JSON.stringify(err.instance)}`);
    });
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Error during validation:', e.message);
  process.exit(1);
}