/**
 * Audit logging for deadline lifecycle changes.
 *
 * Tracks field changes, slip reasons, and overrides — foundation for FR-7 and compliance.
 * Audit events are stored in-memory; in production they would be persisted to a dedicated
 * database table or an external audit pipeline.
 */

/**
 * Represents a log entry attached to a deadline.
 */
export interface DeadlineAuditEvent {
  /** Auto-assigned by the application layer. */
  id: number;

  /** Foreign key into `deadlines` table. */
  deadlineId: number;

  /** What changed: title, type, owner, due_date, priority, tags, description, dependent_ids, health_override, health_override_reason. */
  field: string;

  /** Old value before change. */
  oldValue: string | null;

  /** New value after change. */
  newValue: string | null;

  /** Who made the change. */
  actor: string;

  /** ISO timestamp of the change. */
  createdAt: Date;

  /** Slip taxonomy key (empty if not a date slip). */
  slipReason?:
    | 'Scope Change'
    | 'Dependency Block'
    | 'Resource Constraint'
    | 'External / Customer'
    | 'Technical Blocker'
    | 'Other'
    | null;
}

/**
 * In-memory store for audit events.
 *
 * In a real implementation, these events will be persisted to the `deadline_audit`
 * database table or written to an audit pipeline.
 */
export class AuditLogStore implements Iterable<DeadlineAuditEvent> {
  private readonly logs: DeadlineAuditEvent[] = [];

  /** Append a new audit event to the store. */
  add(event: Omit<DeadlineAuditEvent, 'id' | 'createdAt'>): void {
    const entry: DeadlineAuditEvent = {
      ...event,
      id: this.logs.length + 1,
      createdAt: new Date(),
    };
    this.logs.push(entry);
  }

  /** Export all audit events. */
  export(): DeadlineAuditEvent[] {
    return [...this.logs];
  }

  /** Export all events for a given deadline ID. */
  exportByDeadlineId(deadlineId: number): DeadlineAuditEvent[] {
    return this.logs.filter((e) => e.deadlineId === deadlineId);
  }

  /** Clear the in-memory store. Useful for testing. */
  clear(): void {
    this.logs.length = 0;
  }

  /** Native iterable (for for…of). */
  [Symbol.iterator](): Iterator<DeadlineAuditEvent> {
    const logs = this.logs;
    let index = -1;
    return {
      next(): IteratorResult<DeadlineAuditEvent> {
        index++;
        return index < logs.length
          ? { value: logs[index]!, done: false }
          : { value: undefined as unknown as DeadlineAuditEvent, done: true };
      },
    };
  }
}

/**
 * Type alias — the service layer imports this name.
 * Both `AuditLogStore` and `DeadlineAuditStore` refer to the same class.
 */
export type DeadlineAuditStore = AuditLogStore;
