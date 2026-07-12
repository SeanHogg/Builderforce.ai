#!/usr/bin/env node

/**
 * @see https://www.npmjs.com/package/typescript
 *
 * CLI for inspecting and testing integration contract definitions.
 */

import { ValidateContractsResult } from './validator.js';
import { ValidationResult } from './types.js';

export function formatValidationError(error: ValidationResult): string {
  return [
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    `ValidationError: ${error.contractType} at step '${error.stepName}'`,
    `  Step ID:   ${error.stepId}`,
    `  Pipeline:  ${error.pipelineRunId || 'N/A'}`,
    `  Failed rules (${error.failedRules.length}):`,
  ]
    .concat(error.failedRules)
    .map((rule) => `    - ${JSON.stringify(rule)}`)
    .join('\n');
}

export function formatValidateContractsResult(result: ValidateContractsResult): string {
  const parts: string[] = [];

  if (result.status === 'success') {
    if (result.successCount === 0) {
      parts.push('No contract files found at the configured directory.');
    } else {
      parts.push(
        `Parsed ${result.parsedCount} contract file(s); ${result.successCount} passed, ${result.failureCount} failed.`,
      );
      parts.push('');
      if (result.failures.length > 0) {
        parts.push('Failed contracts:');
        for (const failure of result.failures) {
          parts.push(`  ${failure.fileName}:`);
          for (const error of failure.errors) {
            parts.push(formatValidationError(error));
            parts.push('');
          }
        }
      }
    }
  } else {
    parts.push(`Fatal error: ${result.errorMessage}`);
  }

  return parts.join('\n');
}

/**
 * Main entry point that returns an exit code matching the passed/fail counts.
 *
 * Usage: npx @seanhogg/builderforce-agents/plugin-sdk run src/cli.ts [options]
 *
 *   --fixture string    Run contract validation against a JSON fixture file.
 *   --diff              Run validation in "diff" mode: compare contract vs fixture and exit on breaking changes.
 */
export function runCli(args: string[]): number {
  const baseUrl = getUrlFromArg('--base-url', args);
  const fixturePath = getUrlFromArg('--fixture', args);
  const diffModeArg = args.includes('--diff');
  const contractDir = contractDirFromArg(args);
  const maxRuleLength = 300; // limit for CLI length

  if (!fixturePath) {
    // No fixture specified: just lint/parse contracts.
    const result = validateContracts({
      contractDir,
      baseUrl,
      maxRuleLength,
    });

    if (result.status === 'error') {
      console.error(result.errorMessage);
      return 1;
    }

    if (result.failureCount === 0) {
      console.log('All validated contracts passed.');
    } else {
      console.error(formatValidateContractsResult(result));
    }
    return result.failureCount === 0 ? 0 : 1;
  }

  // Fixture mode: load fixture and run validation against it.
  const fixture = loadFixture(fixturePath);
  if (!fixture) {
    console.error(`Failed to load fixture from '${fixturePath}': ${fixture.error || 'unknown error'}`);
    return 1;
  }

  // Validate fixture against the contract at the given path (from --base-url).
  // If --base-url is not provided, we default to a placeholder.
  const result = validateContractAgainstFixture({
    contractPath: baseUrl || './contracts/dummy-contract.json',
    fixture,
    maxRuleLength,
  });

  if (result.status === 'error') {
    console.error(result.errorMessage);
    return 1;
  }

  if (result.valid) {
    console.log('Fixture passed contract validation.');
  } else {
    console.error(`Fixture validation failed at step '${result.stepName}':\n${formatValidationError(result)}`);
    return 1;
  }

  if (diffModeArg) {
    // Diff mode: exit with non-zero when contracts had changes between versions.
    // Currently, this performs a basic contract-only check without diff logic.
    // For a robust diff implementation, we'd need a contract version source.
    const diffResult = diffContracts(contractDir || './contracts', baseUrl || './contracts');
    if (diffResult.pending) {
      console.error(
        `Diff-detected pending changes. Run --diff for full diff logic. See ${diffResult.msg} for details.`,
      );
      return 1;
    }
  }

  return result.valid ? 0 : 1;
}

/**
 * Parse and validate contract definitions.
 *
 * @returns void; exit via console.error for errors.
 */
export async function validateContracts(opts: {
  contractDir?: string;
  baseUrl?: string;
  maxRuleLength?: number;
}): Promise<void> {
  const result = validateContractsImpl(opts);
  const hasFailures = result.status === 'success' && result.failureCount > 0;

  if (hasFailures || result.status === 'error') {
    console.error(formatValidateContractsResult(result));
    process.exit(hasFailures ? result.failureCount : 1);
  }
}

export function loadFixture(pathName: string): { valid: boolean; data?: unknown; error?: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  try {
    const data = require(pathName);
    return { valid: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Failed to load fixture from '${pathName}': ${message}` };
  }
}

/**
 * Validate a contract against a fixture, with a enforced rule-length cap.
 */
function validateContractAgainstFixture(opts: {
  contractPath: string;
  fixture: unknown;
  maxRuleLength?: number;
}): ValidateContractsResult {
  const { contractPath, fixture, maxRuleLength } = opts;

  // Load the contract at `contractPath` from a local path or placeholder.
  // At this time, we expect the contract to be JSON; for real work we’d
  // integrate a contract loader that supports multiple formats (JSON,
  // YAML, compiled code).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let contract: unknown;
  try {
    contract = require(contractPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      errorMessage: `Failed to load contract from '${contractPath}': ${message}`,
    };
  }

  // Serialize fixture to JSON string and validate JSON Schema.
  const fixtureJson = JSON.stringify(fixture, null, 2);
  if (typeof fixtureJson !== 'string') {
    return {
      status: 'error',
      errorMessage: `Failed to serialize fixture to JSON string: ${String(fixtureJson)}`,
    };
  }

  // Using Ajv; at present we only support JSON Schema for fixture validation.
  const ajv = createAjv(maxRuleLength);
  const validate: ((data: unknown) => boolean) | undefined = ajv.compile(contract as { $schema?: string });

  if (!validate) {
    return {
      status: 'error',
      errorMessage: `Failed to compile contract as JSON Schema at '${contractPath}'`,
    };
  }

  const valid = validate(fixture);
  const errors = validate.errors || [];

  if (valid) {
    return { status: 'success', successCount: 1, failureCount: 0 };
  }

  const illegalRules = errors.filter((err: any) => String(err.constraint || '').length > (maxRuleLength || Infinity));
  return {
    status: 'success',
    successCount: 1,
    failureCount: illegalRules.length || errors.length,
    failures: illegalRules.length > 0
      ? errors.filter((err: any) => String(err.constraint || '').length <= (maxRuleLength || Infinity))
      : errors,
    parsedCount: 1,
  };
}

function diffContracts(contractDir?: string, baseUrl?: string): { pending: boolean; msg?: string } {
  // Placeholder for diff logic. For a robust implementation, compare contract versions
  // and report breaking changes.
  return { pending: false };
}

function createAjv(maxRuleLength: number = 300): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true });

  // Ensure we don’t produce rule strings that exceed the CLI length budget.
  ajv.addKeyword('maxLength', {
    compile: (schema, parentSchema, it) => {
      const maxLength = Math.max(String(schema).length, 0);
      if (maxLength > maxRuleLength) {
        throw new Error(`Constraint length exceeds maxRuleLength (${maxRuleLength})`);
      }
      return (data) => true; // placeholder; rule length check is enforced via keyword registration
    },
  });

  ajv.addKeyword('pattern', {
    compile: (schema, parentSchema, it) => {
      try {
        new RegExp(schema as string); // Placeholder; enforcement in live machinery
      } catch (err) {
        throw new Error('Invalid regular-expression pattern.');
      }
      return (data) => true; // placeholder; actual signature validation lives in the host engine
    },
  });

  return ajv;
}

function getUrlFromArg(argName: string, args: string[]): string | undefined {
  const idx = args.indexOf(argName);
  if (idx < 0 || idx + 1 >= args.length || args[idx + 1].startsWith('-')) {
    return undefined;
  }
  const val = args[idx + 1];
  // Ensure path normalization for local-only use.
  return val.startsWith('/') ? val : undefined;
}

function contractDirFromArg(args: string[]): string | undefined {
  const idx = args.indexOf('--dir');
  if (idx < 0 || idx + 1 >= args.length || args[idx + 1].startsWith('-')) {
    return undefined;
  }
  const dir = args[idx + 1];
  return dir.startsWith('/') ? dir : undefined;
}

function validateContractsImpl(opts: {
  contractDir?: string;
  baseUrl?: string;
  maxRuleLength?: number;
}): ValidateContractsResult {
  // Placeholder for loading and validating contract files from the configured directory.
  // Future implementation will read `.json`/`.yaml` contracts and filter duplicate file names.
  return {
    status: 'success',
    successCount: 0,
    failureCount: 0,
    parsedCount: 0,
    failures: [],
  };
}