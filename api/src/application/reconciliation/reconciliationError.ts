/** A reconciliation failure with a machine code and structured details, persisted on the run's diagnostics. */
export class ReconciliationError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
