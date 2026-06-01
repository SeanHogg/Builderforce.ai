/**
 * PRD-coordinate audit — PURE logic (no IO).
 *
 * An audit record places an agent action at a PRD coordinate:
 * (agent action × PRD section) across swimlanes/agents. This builder
 * normalizes free-form input into a spec_audit_records insert payload.
 */

export interface BuildAuditInput {
  specId:       string;
  tenantId:     number;
  segmentId?:   string | null;
  specVersion?: number | null;
  sectionId?:   string | null;
  agentRole?:   string | null;
  action:       string;
  swimlane?:    string | null;
  taskId?:      number | null;
  detail?:      unknown;
}

/** Insert payload for the spec_audit_records table (detail serialized to text). */
export interface SpecAuditRecordInsert {
  tenantId:    number;
  segmentId:   string | null;
  specId:      string;
  specVersion: number | null;
  sectionId:   string | null;
  agentRole:   string | null;
  action:      string;
  swimlane:    string | null;
  taskId:      number | null;
  detail:      string | null;
}

function norm(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** Serialize detail to text; strings pass through, objects are JSON-stringified. */
function normDetail(detail: unknown): string | null {
  if (detail == null) return null;
  if (typeof detail === 'string') {
    const t = detail.trim();
    return t.length === 0 ? null : t;
  }
  return JSON.stringify(detail);
}

/**
 * Build a normalized spec_audit_records insert payload. `action` is required
 * and must be a non-empty string; everything else is normalized to null when
 * blank/absent. The `detail` field is serialized to text.
 */
export function buildSpecAuditRecord(input: BuildAuditInput): SpecAuditRecordInsert {
  const action = norm(input.action);
  if (!action) {
    throw new Error('audit action is required');
  }

  return {
    tenantId:    input.tenantId,
    segmentId:   input.segmentId ?? null,
    specId:      input.specId,
    specVersion:
      typeof input.specVersion === 'number' && Number.isFinite(input.specVersion)
        ? input.specVersion
        : null,
    sectionId:   norm(input.sectionId),
    agentRole:   norm(input.agentRole),
    action,
    swimlane:    norm(input.swimlane),
    taskId:
      typeof input.taskId === 'number' && Number.isFinite(input.taskId)
        ? input.taskId
        : null,
    detail:      normDetail(input.detail),
  };
}
