/**
 * escalationReminderWorker — PRD deliverable "Escalation Reminder Worker"
 *
 * Scheduled process responsible for:
 *   (1) 24h and 4h reminders (AC.4) — sends when the SLA clock crosses those thresholds
 *   (2) Auto-escalation when SLA expires (AC.3) — escalates to next chain level
 *   (3) Updating sla_breached when deadline passes
 *
 * This module is database-adapter agnostic: callers pass in the two stores,
 * so it compiles against both the full Drizzle client (api worker) and a stub for
 * unit tests.
 *
 * Run signature mirrors the codebase's other sweeps (agentHostOnline, runRepoActivitySweep):
 *   runEscalationReminderWorker({ db, notifications })
 *
 * In Cloudflare cron, call this from src/index.ts's scheduled handler.
 */

import type { EscalationNotificationAdapter } from './escalationManager';

// Inline SLA helpers that don't require the full domain package
const ONE_HOUR_MS = 60 * 60 * 1000;
const REMINDER_24H_MS = 24 * ONE_HOUR_MS;
const REMINDER_4H_MS = 4 * ONE_HOUR_MS;
const WINDOW_MS = 20 * 60_000; // fire window ± window_ms around the threshold

type DbRow = Record<string, unknown> & { id: string | number };

// Interfaces the worker needs from whatever DB abstraction the caller wires
export type EscalationReminderDb = {
  /** Lists active escalations whose SLA deadline is within 24h or already overdue. */
  listOpenEscalations(limit?: number): Promise<DbRow[]>;
  /** Returns (escalationId, sequenceIndex, kind) triples already sent. */
  listSentReminders(escalationIds: (string | number)[]): Promise<
    Array<{ escalationId: string; sequenceIndex: number; kind: string }>
  >;
  /** Idempotent insert — ignore when the row already exists (onConflictDoNothing equivalent). */
  recordReminder(args: {
    escalationId: string;
    tenantId: number | string;
    sequenceIndex: number;
    kind: 'reminder_24h' | 'reminder_4h' | 'deadline_breach';
  }): Promise<boolean>; // true=inserted new
  /** Chain levels for an escalation's chain (used for auto-escalation lookup). */
  getNextLevel(input: {
    chainId: string | null;
    currentSequence: number;
  }): Promise<{ sequenceIndex: number; effectiveLevel: number; levelName: string; ownerKind?: string; ownerId?: string; ownerDisplayName?: string } | null>;
  /** Mark escalation as escalated + write audit log. */
  escalateEscalation(input: {
    escalationId: string;
    tenantId: number | string;
    nextLevel: {
      sequenceIndex: number;
      effectiveLevel: number;
      levelName: string;
      ownerKind?: string;
      ownerId?: string;
      ownerDisplayName?: string;
    };
    newDeadline: Date | null;
    actorKind: 'system' | 'cron';
    actorId: string;
  }): Promise<void>;
  /** Update slaBreached when a deadline passes without action at current level. */
  markBreached(input: {
    escalationId: string;
    tenantId: number | string;
  }): Promise<void>;
};

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type ReminderWorkerResult = {
  scanned: number;
  reminders_24h: number;
  reminders_4h: number;
  escalations: number;
  breached: number;
  errors: string[];
};

export async function runEscalationReminderWorker(args: {
  db: EscalationReminderDb;
  notifications: EscalationNotificationAdapter;
  now?: Date;
  limit?: number;
}): Promise<ReminderWorkerResult> {
  const now = args.now ?? new Date();
  const db = args.db;
  const notify = args.notifications;
  const result: ReminderWorkerResult = {
    scanned: 0,
    reminders_24h: 0,
    reminders_4h: 0,
    escalations: 0,
    breached: 0,
    errors: [],
  };

  let open: DbRow[];
  try {
    open = await db.listOpenEscalations(args.limit ?? 300);
  } catch (e) {
    result.errors.push(`listOpenEscalations: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  result.scanned = open.length;
  if (open.length === 0) return result;

  const escalationIds = open.map((r) => r.id);
  let sentTriples: Array<{ escalationId: string; sequenceIndex: number; kind: string }> = [];
  try {
    sentTriples = await db.listSentReminders(escalationIds);
  } catch (e) {
    result.errors.push(`listSentReminders: ${e instanceof Error ? e.message : String(e)}`);
    // do not abort — just skip dedup so we might double-send, but we still try to recover
  }

  const sentSet = new Set(
    sentTriples.map((t) => `${t.escalationId}::${t.sequenceIndex}::${t.kind}`),
  );

  for (const row of open) {
    try {
      const id = String(row.id);
      const tenantId = (row.tenantId ?? row.tenant_id ?? 0) as number | string;
      const chainId = (row.chainId ?? row.chain_id ?? null) as string | null;
      const sequenceIndex = Number(row.currentSequence ?? row.current_sequence ?? 0);
      const levelName = (row.currentLevelName ?? row.current_level_name ?? '') as string;
      const slaDeadline = toDate(row.slaDeadline ?? row.sla_deadline);
      const initiativeId = (row.initiativeId ?? row.initiative_id ?? '') as string;
      const title = (row.title ?? 'Escalation') as string;
      const ownerKind = (row.currentOwnerKind ?? row.current_owner_kind ?? 'role') as string;
      const ownerId = (row.currentOwnerId ?? row.current_owner_id ?? '') as string;
      const status = String(row.status ?? 'open');
      const alreadyBreached = Boolean(row.slaBreached ?? row.sla_breached);

      if (!slaDeadline) continue;

      const untilDeadMs = slaDeadline.getTime() - now.getTime();

      // ----- 24h reminder (AC.4)
      // Fire when we are within [0, 24h+window) of deadline AND 24h reminder has not been sent yet
      if (untilDeadMs <= REMINDER_24H_MS + WINDOW_MS && untilDeadMs > REMINDER_4H_MS) {
        const tripleKey = `${id}::${sequenceIndex}::reminder_24h`;
        if (!sentSet.has(tripleKey)) {
          try {
            const inserted = await db.recordReminder({
              escalationId: id,
              tenantId,
              sequenceIndex,
              kind: 'reminder_24h',
            });
            if (inserted) {
              sentSet.add(tripleKey);
              await notify.notify({
                escalationId: id,
                level: sequenceIndex,
                assigneeRole: ownerKind,
                assigneeId: ownerId || undefined,
                kind: 'reminder_24h',
                initiativeId: initiativeId || '',
                title,
                deadline: slaDeadline,
              });
              result.reminders_24h += 1;
            }
          } catch (e) {
            result.errors.push(
              `24h reminder ${id}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }

      // ----- 4h reminder (AC.4)
      if (untilDeadMs <= REMINDER_4H_MS + WINDOW_MS && untilDeadMs > 0) {
        const tripleKey = `${id}::${sequenceIndex}::reminder_4h`;
        if (!sentSet.has(tripleKey)) {
          try {
            const inserted = await db.recordReminder({
              escalationId: id,
              tenantId,
              sequenceIndex,
              kind: 'reminder_4h',
            });
            if (inserted) {
              sentSet.add(tripleKey);
              await notify.notify({
                escalationId: id,
                level: sequenceIndex,
                assigneeRole: ownerKind,
                assigneeId: ownerId || undefined,
                kind: 'reminder_4h',
                initiativeId: initiativeId || '',
                title,
                deadline: slaDeadline,
              });
              result.reminders_4h += 1;
            }
          } catch (e) {
            result.errors.push(
              `4h reminder ${id}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }

      // ----- Auto-escalation / breach (AC.3 + FR.5)
      if (untilDeadMs <= 0) {
        if (status === 'open' || status === 'escalated') {
          // Try to escalate first — if there is a next level
          let nextLevel: {
            sequenceIndex: number;
            effectiveLevel: number;
            levelName: string;
            ownerKind?: string;
            ownerId?: string;
            ownerDisplayName?: string;
          } | null = null;

          if (chainId) {
            try {
              nextLevel = await db.getNextLevel({ chainId, currentSequence: sequenceIndex });
            } catch (e) {
              result.errors.push(
                `getNextLevel ${id}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }

          if (nextLevel) {
            try {
              // 3 business days forward (business-day skip is computed on the caller side,
              // here we use a 3-day approximation that will be corrected by the service if wired)
              const newDeadline = addApproximateBusinessDays(now, 3);
              await db.escalateEscalation({
                escalationId: id,
                tenantId,
                nextLevel,
                newDeadline,
                actorKind: 'cron',
                actorId: 'reminder-worker',
              });
              await notify.notify({
                escalationId: id,
                level: nextLevel.sequenceIndex,
                assigneeRole: nextLevel.ownerKind ?? 'role',
                assigneeId: nextLevel.ownerId,
                kind: 'escalated',
                initiativeId: initiativeId || '',
                title,
                deadline: newDeadline ?? undefined,
              });
              result.escalations += 1;
            } catch (e) {
              result.errors.push(
                `escalate ${id}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          } else {
            // No next level → terminal; mark breached so FR.5 audit reflects it
            if (!alreadyBreached) {
              try {
                await db.markBreached({ escalationId: id, tenantId });
                result.breached += 1;
              } catch (e) {
                result.errors.push(
                  `breach ${id}: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          }
        }
      }
    } catch (e) {
      result.errors.push(`row ${String((row as DbRow).id ?? '?')}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

// Lightweight business-day approximator used only inside the cron — it is deliberately
// more conservative than addBusinessDays in escalationSlaClock.ts so that a
// duplicate auto-escalation concurrent with the API path still leaves enough headroom.
function addApproximateBusinessDays(start: Date, businessDays: number): Date {
  let d = new Date(start.getTime());
  let added = 0;
  while (added < businessDays) {
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  d.setUTCHours(17, 0, 0, 0);
  return d;
}
