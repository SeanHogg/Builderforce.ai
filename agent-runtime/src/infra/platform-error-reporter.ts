/**
 * platform-error-reporter — the OPT-IN path from a self-hosted runtime's caught
 * errors to the platform's central error store.
 *
 * ## Why it is opt-in
 *
 * A self-hosted runtime's logs belong to whoever hosts it. The contract is and
 * stays: errors go to the local logger (`logError` -> the console formatter and
 * `~/.builderforce/logs`), and NOTHING leaves the machine unless the operator says
 * so. That contract is what a self-hosted product is for, and this module does not
 * change it.
 *
 * What it changes is the consequence. Before it existed there was no path at all:
 * an agent crash was visible in the platform only as whatever the execution status
 * happened to record, so "why did this customer's on-prem agent fail" could only
 * be answered by asking them to send a log file. An operator who WANTS that answer
 * had no way to give it.
 *
 * So: set `BUILDERFORCE_ERROR_REPORTING=1` (env, or `~/.builderforce/.env`) and the
 * same errors that already go to the local log are ALSO filed against the linked
 * workspace's project, in the same Quality feed as every other error the platform
 * knows about. Unset, the function is a local log line and one boolean read.
 *
 * ## Contract
 *
 * - The local log ALWAYS happens, first, whatever the reporting setting says.
 * - The remote report is fire-and-forget and can never fail a run.
 * - No credential of its own: the agent host's API key and id, exactly as
 *   `run-context-client.ts` and `project-facts-sync.ts` read them.
 *
 * Two entry points, because a crash handler has already printed its own richly
 * formatted line and must not print a second: `logAndReportRuntimeError` for
 * ordinary caught errors, `sendRuntimeErrorReport` for callers that own the log.
 */
import { logDebug, logError } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { isOfflineMode, isTruthyFlag, readRuntimeEnvVar, readSharedEnvVar } from "./env-file.js";

/** How long a crash report may hold the process before it is abandoned. */
const REPORT_TIMEOUT_MS = 8_000;

export interface RuntimeErrorReport {
  /** The seam it happened at, e.g. `gateway/relay/attachUpstream`. */
  operation: string;
  /** The workspace the run belongs to; how the linked project is discovered. */
  workspaceDir?: string | undefined;
  /** 'error' unless the caller is reporting something it recovered from. */
  level?: "fatal" | "error" | "warning" | undefined;
  /** Structured detail. Keep it small: it is stored verbatim on the event. */
  context?: Record<string, unknown> | undefined;
}

/** The workspace's Builderforce link, or null when it has none / cannot be read. */
async function loadWorkspaceContext(workspaceDir: string) {
  try {
    const { loadProjectContext } = await import("../builderforce/project-context-store.js");
    return await loadProjectContext(workspaceDir);
  } catch (err) {
    logDebug(`[error-report] could not read project context: ${String(err)}`);
    return null;
  }
}

/**
 * Is remote reporting switched on for this machine?
 *
 * False in offline/air-gapped mode whatever the switch says. Exported so a caller
 * that batches (a crash handler draining a queue) can skip the work entirely
 * rather than build a report the reporter will discard.
 */
export function isPlatformErrorReportingEnabled(): boolean {
  // An air-gapped runtime makes ZERO outbound control-plane calls, and an opt-in
  // switch left on from before the machine was isolated must not be the exception.
  if (isOfflineMode()) {
    return false;
  }
  return isTruthyFlag(readRuntimeEnvVar("BUILDERFORCE_ERROR_REPORTING"));
}

/**
 * Log a caught error locally, and — when the operator opted in and this host is
 * linked — file it against the workspace's project in the platform's error store.
 *
 * Never throws.
 */
export async function logAndReportRuntimeError(
  error: unknown,
  report: RuntimeErrorReport,
): Promise<void> {
  // The local log is the contract and comes first: a machine with reporting off,
  // no link, or no network still has the full record on disk.
  const message = error instanceof Error ? error.message : String(error);
  logError(`[${report.operation}] ${message}`);
  await sendRuntimeErrorReport(error, report);
}

/**
 * The remote half on its own, for a caller that has ALREADY logged locally.
 *
 * No-ops when reporting is off, when this host is not linked, or when the
 * workspace has no host id. Never throws.
 */
export async function sendRuntimeErrorReport(
  error: unknown,
  report: RuntimeErrorReport,
): Promise<void> {
  if (!isPlatformErrorReportingEnabled()) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  if (!apiKey) {
    return;
  }

  // Loaded lazily so that "reporting is off" really does cost nothing: this module
  // is pulled in by the crash handler every entry point installs, and the YAML
  // parser behind the project context has no business loading on that path.
  const ctx = report.workspaceDir ? await loadWorkspaceContext(report.workspaceDir) : null;
  const agentHostId = ctx?.builderforce?.instanceId;
  // Without a host id the api cannot resolve the caller: its door reads the key
  // together with `X-AgentHost-Id`. Nothing to send it to, so stop here.
  if (!agentHostId) {
    return;
  }

  const projectIdRaw = ctx?.builderforce?.projectId ? Number(ctx.builderforce.projectId) : NaN;
  const projectId = Number.isFinite(projectIdRaw) && projectIdRaw > 0 ? projectIdRaw : null;
  const base = normalizeBaseUrl(
    readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai",
  );

  try {
    const res = await fetch(`${base}/api/quality-ingest/client-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-AgentHost-Id": String(agentHostId),
      },
      body: JSON.stringify({
        source: "agent-runtime",
        projectId,
        events: [
          {
            type: error instanceof Error ? error.name : "AgentRuntimeError",
            message,
            stack,
            level: report.level ?? "error",
            operation: report.operation,
            timestamp: new Date().toISOString(),
            context: report.context ?? {},
          },
        ],
      }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    if (!res.ok) {
      logDebug(`[error-report] returned HTTP ${res.status}`);
    }
  } catch (err) {
    // Terminal by design: reporting a reporting failure would recurse.
    logDebug(`[error-report] failed: ${String(err)}`);
  }
}
