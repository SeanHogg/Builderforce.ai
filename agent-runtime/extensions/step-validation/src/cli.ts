/** Step Validation CLI

Accept contracts and fixtures offline for linting, testing, and diffing. Exits non-zero when
contracts are violated, and prints rule-level diagnostics (field_path, constraint, actual_value).
Lint mode validates syntax of contract definitions. Test mode validates fixtures against contracts.
Diff mode flags breaking contract changes.
*/

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { validatePayload, generateValidationError, resetRunLocks, type Schema } from "./validator.js";
import * as readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AJV = new Ajv({ allErrors: true, strict: false });

/** CLI Return codes (per PRD AC-6). */
enum ExitCode {
  OK = 0,
  SYNTAX_ERROR = 1,
  CONTRACT_VIOLATION = 2,
  BREAKING_CHANGE = 3,
}

/** CLI modes. */
type RunMode = "lint" | "test" | "diff";
type FailureMode = "halt" | "warn-and-continue";

/** Lint the syntax of contract definitions. */
async function lintContracts(contractsPath: string): Promise<{ ok: boolean; errors: Array<{ path: string; message: string }> }> {
  const result: Array<{ path: string; message: string }> = [];

  if (!existsSync(contractsPath)) {
    return { ok: true, errors: [] };
  }

  const contents = existyCheck(JSON.parse(readFileSync(contractsPath, "utf-8"));

  if (contents.type !== "object" || !contents.$schema && !contents.contracts && !Array.isArray(contents.steps)) {
    result.push({ path: contractsPath, message: "Missing root contract object ($schema|contracts|steps)" });
  }

  // validate each step's contracts for type correctness and required fields
  if (Array.isArray(contents.steps)) {
    for (const step of contents.steps) {
      if (step.step_id && !existsy(step)) {
        result.push({ path: contractsPath, message: `missing step_id or invalid step: ${step.step_id}` });
      }
      const rule: Schema | undefined = step.input_contract ?? step.output_contract;
      if (rule) {
        const v = AJV.compile(rule);
        const testPayload: Record<string, unknown> = {};
        try {
          v(testPayload);
        } catch (e) {
          result.push({ path: contractsPath, message: `${step.step_id}: invalid schema: ${e instanceof Error ? e.message : "syntax error"}` });
        }
      }
    }
  }

  return { ok: result.length === 0, errors: result };
}

/** Run test mode — validate fixtures against contracts. */
async function runTestMode(
  contractsPath: string,
  fixturesPath: string,
  mode: "input" | "output",
  on_failure: FailureMode,
  sink: (event: unknown) => Promise<void>,
): Promise<{ ok: boolean; failures: Array<{ step_id: string; rule: { field_path: string; constraint: string; actual_value: unknown } }> }> {
  resetRunLocks();

  if (!existsSync(contractsPath) || !existsSync(fixturesPath)) {
    throw new Error(`Missing files: contracts=${existsSync(contractsPath)}, fixtures=${existsSync(fixturesPath)}`);
  }

  const contracts = JSON.parse(readFileSync(contractsPath, "utf-8"));
  const fixtures = JSON.parse(readFileSync(fixturesPath, "utf-8"));

  if (mode !== "input" && mode !== "output") {
    throw new Error(`Invalid mode: ${mode}`);
  }

  const failures: Array<{ step_id: string; rule: { field_path: string; constraint: string; actual_value: unknown } }> = [];

  // Map fixture by step_id to the input/output that we should validate
  if (Array.isArray(fixtures)) {
    for (const item of fixtures) {
      const step_id = item.step_id ?? item.name ?? item.id;
      const contract = contracts.steps?.find((s: any) => (s.step_id || s.name || s.id) === step_id);
      if (!contract) continue;
      const key = mode;
      const payload: unknown = contract[key] ?? item;
      if (!payload) continue;
      const result = await validatePayload(payload, contract[`${mode}_contract` as "input_contract" | "output_contract"]);
      if (!result.ok) {
        const failedRules = result.errors ?? [];
        failures.push({ step_id, rule: failedRules[0] ?? { field_path: "<contract_missing>", constraint: "contract not supplied", actual_value: payload } });
        if (result.errors?.length && on_failure === "halt") process.exit(ExitCode.CONTRACT_VIOLATION);
      }
    }
  } else if (fixtures.contracts) {
    for (const step of fixtures.contracts.steps ?? []) {
      const step_id = step.step_id ?? step.name ?? step.id;
      const contract = contracts.steps?.find((s: any) => (s.step_id || s.name || s.id) === step_id);
      if (!contract) continue;
      const payload: unknown = contract[mode] ?? step[mode];
      if (!payload) continue;
      const result = await validatePayload(payload, contract[`${mode}_contract` as "input_contract" | "output_contract"]);
      if (!result.ok) {
        const failedRules = result.errors ?? [];
        failures.push({ step_id, rule: failedRules[0] ?? { field_path: "<contract_missing>", constraint: "contract not supplied", actual_value: payload } });
        if (result.errors?.length && on_failure === "halt") process.exit(ExitCode.CONTRACT_VIOLATION);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

/** Diff mode — flag breaking changes between contract versions. */
async function runDiffMode(
  currentPath: string,
  previousPath: string,
  sink: (event: unknown) => Promise<void>,
): Promise<{ ok: boolean; breaking: Array<{ step_id: string; change: string }> }> {
  if (!existsSync(currentPath) || !existsSync(previousPath)) {
    throw new Error(`Missing files: current=${existsSync(currentPath)}, previous=${existsSync(previousPath)}`);
  }

  const current = JSON.parse(readFileSync(currentPath, "utf-8"));
  const previous = JSON.parse(readFileSync(previousPath, "utf-8"));

  const breaking: Array<{ step_id: string; change: string }> = [];

  const steps_cur = current.steps ?? [];
  const steps_prev = previous.steps ?? [];

  for (const cur of steps_cur) {
    const cur_id = cur.step_id ?? cur.name ?? cur.id;
    const prev = steps_prev.find((s: any) => (s.step_id || s.name || s.id) === cur_id);
    if (!prev) continue;

    // check for required fields added
    if (cur.input_contract && !prev.input_contract && !cur.output_contract && !prev.output_contract) {
      breaking.push({ step_id: cur_id, change: "added input_contract" });
    }
    if (cur.output_contract && (cur.output_contract !== prev.output_contract)) {
      breaking.push({ step_id: cur_id, change: "output_contract changed" });
    }
  }

  return { ok: breaking.length === 0, breaking };
}

/** Main CLI entry point. */
async function main(args: string[]): Promise<void> {
  let mode: RunMode = "test";
  let contractsPath = "contracts.json";
  let fixturesPath = "fixtures.json";
  let failOnContractViolation = true;

  let i = 0;
  while (i < args.length) {
    const arg = args[i++];
    switch (arg) {
      case "--mode":
        mode = args[i++] as RunMode;
        break;
      case "--contracts":
        contractsPath = args[i++];
        break;
      case "--fixtures":
        fixturesPath = args[i++];
        break;
      case "--fail-hard":
        failOnContractViolation = true;
        break;
      case "--allow-warn":
        failOnContractViolation = false;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(ExitCode.SYNTAX_ERROR);
    }
  }

  const crib = () => console.error(`Usage: validate-contracts --mode lint|test|diff [--contracts <path>] [--fixtures <path>] [--fail-hard|--allow-warn]`);
  crib();

  let on_failure: FailureMode = failOnContractViolation ? "halt" : "warn-and-continue";

  const sink = async (event: unknown): Promise<void> => undefined;

  try {
    if (mode === "lint") {
      const { ok, errors } = await lintContracts(contractsPath);
      if (!ok) {
        console.error("Lint errors:");
        for (const e of errors) console.error(`  ${e.path}: ${e.message}`);
        process.exit(ExitCode.SYNTAX_ERROR);
      }
      console.log("✓ Lint OK");
    } else if (mode === "test") {
      const { ok, failures } = await runTestMode(contractsPath, fixturesPath, "input", on_failure, sink);
      if (!ok) {
        console.error("Contract violations:");
        for (const f of failures) console.error(`  ${f.step_id}: ${f.rule.field_path} — ${f.rule.constraint}`);
        process.exit(ExitCode.CONTRACT_VIOLATION);
      }
      console.log("✓ Test OK");
    } else if (mode === "diff") {
      const { ok, breaking } = await runDiffMode(contractsPath, fixturesPath, sink);
      if (!ok) {
        console.error("Breaking changes:");
        for (const b of breaking) console.error(`  ${b.step_id}: ${b.change}`);
        process.exit(ExitCode.BREAKING_CHANGE);
      }
      console.log("✓ No breaking changes");
    }
    process.exit(ExitCode.OK);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(ExitCode.SYNTAX_ERROR);
  }
}

interface Contract {
  type: "array" | "object";
  contracts?: { steps?: any };
  steps?: any[];
}

function existyCheck(v: unknown): Contract {
  return v as Contract;
}

function existsy(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Allow this module to be used in-built (Node CLI)
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}