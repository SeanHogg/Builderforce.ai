/**
 * MOVED - the in-run verify gate now lives in `@builderforce/run-guards`
 * (packages/run-guards/src/inRunVerify.ts), the single home for every
 * deterministic run gate (PRD 45 §4.4). This file is a re-export shim so the
 * existing agent-run consumers keep compiling; new code should import from
 * `@builderforce/run-guards` directly. Do not add logic here.
 */
export {
  DURABLE_IN_RUN_VERIFY_NOTE,
  IN_RUN_VERIFY_SCRIPT_NAMES,
  inRunVerifyOutcome,
  packageVerifyCommands,
  planInRunVerify,
  SANDBOX_IN_RUN_VERIFY_NOTE,
  type InRunVerifyCommandResult,
  type InRunVerifyOutcome,
  type InRunVerifyPlan,
  type InRunVerifySurface,
  type PackageScriptRunner,
} from "@builderforce/run-guards";
