#!/usr/bin/env node

/**
 * Step Validation CLI
 *
 * Usage:
 *   validate-contracts --help
 *   validate-contracts --lint contracts.json
 *   validate-contracts --fixture test-payload.json --schema input-schema.json
 *   validate-contracts --diff old.json new.json
 */

'use strict';

import { program } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePayload, clearSchemaCache, SchemaCache } from './validator.js';
import type { FailedRule, ValidationResult } from './types.js';

let globalSchemaCache: SchemaCache | undefined;

/**
 * Lint a single contract file for syntactic correctness.
 */
function lintContract(filePath: string): { ok: boolean; errors: string[] } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const schema = JSON.parse(content);
    if (!globalSchemaCache) globalSchemaCache = new SchemaCache();
    globalSchemaCache.compile(schema);
    return { ok: true, errors: [] };
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      return { ok: false, errors: [err.message] };
    }
    return { ok: false, errors: [(err as Error).message] };
  }
}

/**
 * Run contracts against fixture payloads.
 */
function validateAgainstFixture(
  fixtureFile: string,
  schemaFile: string,
  contractType: 'input' | 'output',
  verbose = false,
): { exitCode: number; failures: ValidationResult[] } {
  try {
    const fixture = JSON.parse(readFileSync(fixtureFile, 'utf-8'));
    const schemaStr = readFileSync(schemaFile, 'utf-8');
    const schema = JSON.parse(schemaStr);

    if (!globalSchemaCache) globalSchemaCache = new SchemaCache();
    clearSchemaCache();

    const result = validatePayload(fixture, schema, contractType, 'cli');

    console.info(`[validate-contracts] contract_type=${contractType} payload_path=${fixtureFile}`);

    if (result.valid) {
      console.info('[validate-contracts] ✓ passed');
      return { exitCode: 0, failures: [] };
    }

    console.error('[validate-contracts] ✗ validation failed');
    if (verbose && result.errors) {
      for (const fail of result.errors) {
        console.error(`[validate-contracts]   rule: "${fail.rule}"  field: ${fail.fieldPath}  value: ${JSON.stringify(fail.value)}`);
      }
    }
    return { exitCode: 1, failures: [result] };
  } catch (err: unknown) {
    console.error(`[validate-contracts] ✗ failed to compute: ${(err as Error).message}`);
    return { exitCode: 2, failures: [] };
  }
}

/**
 * Diff two contracts and flag breaking changes.
 */
function diffContracts(oldFile: string, newFile: string): { exitCode: number; diffs: string[] } {
  const oldJson = JSON.parse(readFileSync(oldFile, 'utf-8'));
  const newJson = JSON.parse(readFileSync(newFile, 'utf-8'));

  const diffs: string[] = [];

  const compare = (objA: unknown, objB: unknown, path = 'root'): void => {
    const keysA = Object.keys(objA || {});
    const keysB = Object.keys(objB || {});

    for (const k of keysB) {
      const fullKey = path === 'root' ? k : `${path}.${k}`;
      if (!(k in (objA as object))) {
        diffs.push(`break: add required field "${fullKey}"`);
      } else {
        const valA = (objA as Record<string, unknown>)[k];
        const valB = (objB as Record<string, unknown>)[k];
        if (typeof valA === 'object' && typeof valB === 'object' && valA != null && valB != null) {
          compare(valA, valB, fullKey);
        } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
          diffs.push(`break: field changed "${fullKey}"`);
        }
      }
    }
  };

  compare(oldJson, newJson);

  if (diffs.length > 0) {
    console.error(`[validate-contracts] diffs detected:\n${diffs.map(d => `  ${d}`).join('\n')}`);
    return { exitCode: 1, diffs };
  }

  console.info('[validate-contracts] no breaking diffs');
  return { exitCode: 0, diffs };
}

program.name('validate-contracts').description('Lint, test, and diff JSON Schema contracts for step validation').version('1.0.0');

program
  .command('lint')
  .description('Lint a single contract file for syntax errors')
  .requiredOption('--file <path>', 'Path to contract JSON file')
  .action((opts: { file: string }) => {
    const result = lintContract(resolve(opts.file));
    if (result.ok) {
      console.info('[validate-contracts] contract file is valid JSON');
      process.exit(0);
    }
    console.error('[validate-contracts] contract file has errors');
    result.errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  });

program
  .command('validate')
  .description('Run contracts against fixture payloads')
  .requiredOption('--fixture <path>', 'Path to payload JSON file')
  .requiredOption('--schema <path>', 'Path to schema JSON file')
  .option('--contract-type <type>', 'Type of contract (input | output)', 'input')
  .option('--verbose', 'Print detailed errors', false)
  .action((opts) => {
    const contractType: 'input' | 'output' = opts.contractType === 'output' ? 'output' : 'input';
    const result = validateAgainstFixture(resolve(opts.fixture), resolve(opts.schema), contractType, opts.verbose);
    process.exit(result.exitCode);
  });

program
  .command('diff')
  .description('Flag breaking changes between two contract versions')
  .requiredOption('--old <path>', 'Baseline contract (old version)')
  .requiredOption('--new <path>', 'New contract (new version)')
  .action((opts) => {
    const result = diffContracts(resolve(opts.old), resolve(opts.new));
    process.exit(result.exitCode);
  });

program.parse();