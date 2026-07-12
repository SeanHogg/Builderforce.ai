/**
 * Structured error envelope for the repos.pull_request_diff_summary tool.
 *
 * Every failure mode maps to one of these codes (FR-4). The tool never throws
 * an unhandled exception to the caller: `execute` catches DiffSummaryError and
 * returns the MCP standard error envelope (an isError text content block plus a
 * machine-readable `details.error`).
 */
export type DiffSummaryErrorCode =
  | "TASK_NOT_LINKED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "UPSTREAM_ERROR"
  | "CONFIG_ERROR";

/** HTTP-equivalent status for each error code (used by AC-6: TASK_NOT_LINKED === 422). */
export const ERROR_STATUS: Record<DiffSummaryErrorCode, number> = {
  TASK_NOT_LINKED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  UPSTREAM_ERROR: 502,
  CONFIG_ERROR: 422,
};

export class DiffSummaryError extends Error {
  readonly code: DiffSummaryErrorCode;
  readonly status: number;

  constructor(code: DiffSummaryErrorCode, message: string) {
    super(message);
    this.name = "DiffSummaryError";
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

export type DiffSummaryErrorEnvelope = {
  error: {
    code: DiffSummaryErrorCode;
    status: number;
    message: string;
  };
};

/** Build the machine-readable error envelope (used in tool `details`). */
export function toErrorEnvelope(err: unknown): DiffSummaryErrorEnvelope {
  if (err instanceof DiffSummaryError) {
    return { error: { code: err.code, status: err.status, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    error: {
      code: "UPSTREAM_ERROR",
      status: ERROR_STATUS.UPSTREAM_ERROR,
      message,
    },
  };
}
