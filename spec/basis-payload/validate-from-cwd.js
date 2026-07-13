#!/usr/bin/env node

// Validate example canonical against schema with explicit cwd
const Ajv = require('ajv');
const fs = require('fs').promises;

async function run() {
  try {
    // Use absolute paths based on the current working directory
    const schemaPath = '/workspace/spec/basis-payload/basis-payload.schema.json';
    const examplePath = '/workspace/spec/basis-payload/example.canonical.json';

    const schemaContent = await fs.readFile(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    const exampleContent = await fs.readFile(examplePath, 'utf-8');
    const example = JSON.parse(exampleContent);

    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);

    const valid = validate(example);
    if (valid) {
      console.log('✅ Canonical example validation PASSED');
      console.log('Schema version:', example.schema_version);
      console.log('Basis ID:', example.basis_id);
      console.log('Claims:', example.claims.length);
      console.log('Evidence:', example.evidence?.length || 0);
      process.exit(0);
    } else {
      console.error('❌ Canonical example validation FAILED:');
      validate.errors.forEach(err => {
        const path = err.instancePath?.replace(/^\//, '').replace(/\//g, '.') || '<root>';
        console.error(`  • ${path}: ${err.message}`);
      });
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test error:', error.message);
    process.exit(1);
  }
}

run();