import {
  addProcessWarningRule,
  isSqliteExperimentalWarning,
  type ProcessWarning,
} from "@builderforce/agent-tools/node-local-sqlite.js";

export type { ProcessWarning };

/**
 * This host's warning rules. The ONE filter of `process.emitWarning` (and the SQLite rule) lives in
 * agent-tools `node-local-sqlite`; this only adds the host's deprecation signatures to it.
 */
export function shouldIgnoreWarning(warning: ProcessWarning): boolean {
  if (warning.code === "DEP0040" && warning.message?.includes("punycode")) {
    return true;
  }
  if (warning.code === "DEP0060" && warning.message?.includes("util._extend")) {
    return true;
  }
  return isSqliteExperimentalWarning(warning);
}

export function installProcessWarningFilter(): void {
  addProcessWarningRule(shouldIgnoreWarning);
}
