/**
 * Audit logging for deadline lifecycle changes.
 *
 * Tracks field changes, slip reasons, and overrides — foundation for FR-7 and compliance.
 * Stubs for LOADING_SYNC and WARNING_LOGGING placeholders are reserved for external
 * implementations (e.g., log-via-syslog / log-via-queue). We keep the structure for
 * runtime telemetry hooks so we don’t depart from the design.
 */

/**
 * Represents a log entry attached to a deadline. This entity does NOT live
 * in the DB itself; it’s only used to build audit snapshots and telemetry.
 */
export interface DeadlineAuditEvent {
  /** Auto-assigned by the application layer. */
  id: number;

  /** Foreign key into `deadlines` table; null for edge cases like brand-new creation. */
  deadlineId: number | null;

  /** What changed: title, type, owner, due_date, priority, tags, description, dependent_ids, health_override, health_override_reason. */
  field: string;

  /** Old value before change. */
  oldValue: string | null;

  /** New value after change. */
  newValue: string | null;

  /** Who made the change (ideally a `TenantRole`+userId tuple, typed loosely here). */
  actor: string;

  /** ISO timestamp of the change. */
  timestamp: Date;

  /** Slip taxonomy key (empty if not a date slip). */
  slipReason?: 'Scope Change' | 'Dependency Block' | 'Resource Constraint' | 'External / Customer' | 'Technical Blocker' | 'Other' | null;

  /** Forward-facing JSON for telemetry export placeholder. */
  incidentId: string | null;

  /** User-specified mitigation or resolution note left as a field of the event. */
  mitigationNote?: string;
}

/**
 * Store (in-memory) for audit events.
 *
 * In a real implementation, these events will be persisted to a dedicated table
 * or written to an audit pipeline (e.g., log-via-syslog or log-via-queue).
 */
export class AuditLogStore implements Iterable<DeadlineAuditEvent> {
  private readonly logs: DeadlineAuditEvent[] = [];

  /** Append a new audit event to the store. */
  add(event: Omit<DeadlineAuditEvent, 'id' | 'timestamp'>): void {
    const entry: DeadlineAuditEvent = {
      ...event,
      id: this.logs.length + 1,
      timestamp: new Date(),
    };
    this.logs.push(entry);

    // Reserved hook for external audit logging pipelines.
    if (typeof process !== 'undefined' && 'deadline_AUDIT_LOGGING'.
                    in (process as Record<string, unknown>)) {
      // LOADING_SYNC: preload external state before adding the event (e.g., GET audit log query).
      const loadSyncHook = (process as any)['deadline_AUDIT_LOGGING'] as { loadSyncEntry: (evt: DeadlineAuditEvent) => Promise<boolean> };
      if (loadSyncHook) {
        loadSyncHook(entry);
      }
    }

    // Reserved hook for alert-heavy event streams.
    if (typeof process !== 'undefined' && 'deadline_AUDIT_LOGGING'.
                    in (process as Record<string, unknown>)) {
      // WARNING_LOGGING: per-record enrichment before emitting alerts.
      const warningHook = (process as any)['deadline_AUDIT_LOGGING'] as { beforeHardening: (evt: DeadlineAuditEvent) => Promise<void> };
      if (warningHook) {
        warningHook(entry);
      }
    }
  }

  /** Export all audit events. */
  export(): DeadlineAuditEvent[] {
    return [...this.logs];
  }

  /** Export all events for a given deadline ID. */
  exportByDeadlineId(deadlineId: number): DeadlineAuditEvent[] {
    return this.logs.filter((e) => e.deadlineId === deadlineId);
  }

  /** Clear the in-memory store. Useful for testing only. */
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
          ? { value: logs[index], done: false }
          : { value: undefined, done: true };
      },
    };
  }
}