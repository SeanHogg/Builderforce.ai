import { IN_RUN_VERIFY_SCRIPT_NAMES, isReadOnlyShellCall } from "@builderforce/run-guards";
import type { VerifyHook } from "../hooks.js";
import { candidateToolNames } from "../tools/gateToolNames.js";

const SCRIPTS: ReadonlySet<string> = new Set(IN_RUN_VERIFY_SCRIPT_NAMES);

function scriptOf(value: unknown): "test" | "typecheck" | undefined {
  if (typeof value !== "string") return undefined;
  // Only an exact package-script invocation. Flags, chaining, redirection, and
  // changing directory can change which tests ran or what the exit code means.
  const match = /^(npm|pnpm|yarn)[ \t]+(?:(run)[ \t]+)?([a-z-]+)$/.exec(value.trim());
  if (!match) return undefined;
  const script = match[3];
  if (!script || !SCRIPTS.has(script) || (match[1] === "npm" && !match[2] && script !== "test")) return undefined;
  return script === "test" ? "test" : "typecheck";
}

function exitCodeOf(value: unknown): number | undefined {
  if (typeof value !== "object" || !value) return undefined;
  const exitCode = (value as { exitCode?: unknown }).exitCode;
  return typeof exitCode === "number" && Number.isInteger(exitCode) ? exitCode : undefined;
}

/** Only observes calls already sent through the run's tool and approval pipeline. */
export const nativeChecks: Pick<VerifyHook, "observe" | "recorded"> = {
  observe({ state }, call, result, meta, succeeded) {
    const family = candidateToolNames(call.name, call.args);
    if (!family.includes("run_command")) {
      if (succeeded && family.some((name) => name === "write_file" || name === "spawn_agent")) delete state.nativeChecks;
      return;
    }
    const check = scriptOf(call.args.command);
    const directory = call.args.cwd ?? call.args.workdir;
    const code = exitCodeOf(meta?.details) ?? exitCodeOf(result);
    if (check && code !== undefined && (succeeded || code !== 0) && directory === undefined && call.args.background !== true) {
      (state.nativeChecks ??= {})[check] = code;
    } else if ((succeeded || code !== undefined) && !isReadOnlyShellCall("run_command", call.args)) {
      delete state.nativeChecks;
    }
  },
  recorded({ state }) {
    const results = Object.values(state.nativeChecks ?? {});
    return results.length ? results.every((code) => code === 0) : undefined;
  },
};
