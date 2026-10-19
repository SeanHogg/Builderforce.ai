/**
 * Local audit findings (G08).
 *
 * A finding created while the platform is denied is a local entity, not a
 * failed HTTP post. This module writes it through the injected store: one
 * transaction puts the record and appends its create event. An empty title
 * is refused before that transaction, so the refusal writes nothing.
 *
 * No network client is imported. Do not add a fetch import here.
 *
 * G10: an audit finding is not one of the five gated kinds, but it hangs off
 * an `audit-run` that may be unbound, so its destination is resolved
 * explicitly too. A finding created offline is explicitly unbound and is
 * refused at sync exactly like the run it belongs to.
 */

import type { AuditFindingValue, EntityDestination, LocalRecord } from './records.js';
import { resolveCreateDestination } from './creationDestination.js';
import { newLocalRecord, type LocalFirstStore, type LocalFirstTransaction } from './store.js';

export const AUDIT_FINDING_TITLE_REQUIRED = 'audit_finding_title_required';

export interface CreateLocalAuditFindingInput {
  title: string;
  auditRunId: string;
  fingerprint?: string;
  severity?: string;
  evidence?: unknown;
  remediationTicketId?: string;
  id?: string;
  deviceId: string;
  destination?: EntityDestination;
  occurredAt?: string;
  dependsOn?: readonly string[];
}

function requireText(value: string | undefined, code: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function entityId(id: string | undefined): string {
  if (id === undefined) return crypto.randomUUID();
  if (!id.trim()) throw new Error('client_entity_id_must_be_stable_uuid');
  return id;
}

/**
 * Persist one audit finding as a local `audit-finding` record and a create
 * journal event. Throws `audit_finding_title_required` when `input.title` is
 * empty or whitespace, and does not open a transaction in that case.
 */
export async function createLocalAuditFinding(
  store: LocalFirstStore,
  input: CreateLocalAuditFindingInput,
): Promise<LocalRecord<AuditFindingValue>> {
  const title = requireText(input.title, AUDIT_FINDING_TITLE_REQUIRED);
  const deviceId = requireText(input.deviceId, 'device_id_required');
  const auditRunId = requireText(input.auditRunId, 'audit_run_id_required');
  const id = entityId(input.id);
  const severity = input.severity?.trim() || 'medium';
  const fingerprint = input.fingerprint?.trim() || `title:${title}`;
  const payload: AuditFindingValue = {
    auditRunId,
    fingerprint,
    severity,
    summary: title,
    evidence: input.evidence ?? { title },
    ...(input.remediationTicketId?.trim()
      ? { remediationTicketId: input.remediationTicketId.trim() }
      : {}),
  };

  return store.transact(async (tx: LocalFirstTransaction) => {
    const record = newLocalRecord<AuditFindingValue>({
      id,
      entityType: 'audit-finding',
      payload,
      deviceId,
      destination: resolveCreateDestination(input.destination),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
    await tx.put(record);
    await tx.append({
      eventId: `audit-finding:${record.id}:v${record.version}`,
      clientEntityId: record.id,
      entityType: 'audit-finding',
      operation: 'create',
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      dependsOn: [...(input.dependsOn ?? [])],
      destination: record.destination,
      payload: record.payload,
    });
    return record;
  });
}
