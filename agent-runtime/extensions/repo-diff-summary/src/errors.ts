// Structured errors — PRD FR-5

export type DiffSummaryErrorCode =
  | "UNRESOLVABLE_REF"
  | "PR_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "NO_LINKED_PR_OR_BRANCH"
  | "DIFF_UNAVAILABLE"
  | "REPO_PERMISSION_DENIED";

export interface DiffSummaryError {
  code: DiffSummaryErrorCode;
  message: string;
  hint: string;
}

const ERROR_HINTS: Record<DiffSummaryErrorCode, string> = {
  UNRESOLVABLE_REF:
    "Could not determine a PR or branch from the supplied inputs. Provide exactly one of taskId, prNumber (with projectId), or branch.",
  PR_NOT_FOUND:
    "The supplied prNumber was not found in the resolved repository. Verify the PR number and projectId are correct.",
  TASK_NOT_FOUND:
    "No task exists with the supplied taskId. Verify the task ID is correct and the task has been created.",
  NO_LINKED_PR_OR_BRANCH:
    "Task exists but has no linked PR and no feature branch. Ensure the task has a PR, branch, or execution history.",
  DIFF_UNAVAILABLE:
    "The repository API returned an error or the diff is empty/inaccessible. The repository may be private or the diff endpoint temporarily unavailable.",
  REPO_PERMISSION_DENIED:
    "The MCP service or supplied token lacks read access to the repository. Check GITHUB_TOKEN / git provider permissions.",
};

/**
 * Factory for structured errors (FR-5). All errors carry code, message, hint.
 * This class shapes the error so callers can inspect err.code, err.message,
 * err.hint without risking unhandled exceptions leaking as 500s.
 */
export class DiffSummaryErrorClass extends Error {
  readonly code: DiffSummaryErrorCode;
  readonly hint: string;

  constructor(code: DiffSummaryErrorCode, message: string) {
    super(message);
    this.code = code;
    this.hint = ERROR_HINTS[code];
    this.name = "DiffSummaryError";
  }

  /** Convert to the wire response shape. */
  toJSON(): DiffSummaryError {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
    };
  }

  static unresolvableRef(msg?: string): DiffSummaryErrorClass {
    return new DiffSummaryErrorClass(
      "UNRESOLVABLE_REF",
      msg ?? "Cannot determine a PR or branch from the supplied inputs.",
    );
  }

  static taskNotFound(taskId: string): DiffSummaryErrorClass {
    return new DiffSummaryErrorClass(
      "TASK_NOT_FOUND",
      `Task not found: ${taskId}`,
    );
  }

  static noLinkedPRorBranch(taskId: string): DiffSummaryErrorClass {
    return new DiffSummaryErrorClass(
      "NO_LINKED_PR_OR_BRANCH",
      `Task ${taskId} has no linked PR and no associated branch from which to resolve a diff.`,
    );
  }

  static prNotFound(prNumber: number, repoFullName: string): DiffSummaryErrorClass {
    return new DiffSummaryErrorClass(
      "PR_NOT_FOUND",
      `PR #${prNumber} not found in ${repoFullName}.`,
    );
  }

  static diffUnavailable(msg: string): DiffSummaryErrorClass {
    return new DiffSummaryErrorClass("DIFF_UNAVAILABLE", msg);
  }

  static repoPermissionDenied(repoFullName: string): DiffSummaryErrorClass {
    return new DiffSummaryErrorClass(
      "REPO_PERMISSION_DENIED",
      `Permission denied reading repository ${repoFullName}.`,
    );
  }
}
