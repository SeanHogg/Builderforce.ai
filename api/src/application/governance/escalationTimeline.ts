/**
 * escalationTimeline — PRD deliverable "Escalation Timeline (by Level)"
 *
 * Produces a timeline view of an escalation's progression through its chain levels,
 * enriched with icons from escalationIcons and SLA clock states.
 */

import { buildSlaClockDto, computeSlaDeadline, type SlaClockDto } from './escalationSlaClock';
import { iconForLevel, type EscalationIconKey } from './escalationIcons';

export type TimelineItemStatus = 'completed' | 'active' | 'pending' | 'breached' | 'skipped';

export type EscalationTimelineItem = {
  sequenceIndex: number;
  effectiveLevel: number;
  levelName: string;
  ownerKind: string;
  ownerId: string | null;
  ownerDisplayName: string | null;
  iconKey: EscalationIconKey;
  iconEmoji: string;
  slaDays: number;
  status: TimelineItemStatus;
  enteredAt: string | null;
  exitedAt: string | null;
  deadline: string | null;
  clock: SlaClockDto | null;
  breachCount: number;
  remindersSent: Array<{ kind: string; sentAt: string }>;
  autoEscalate: boolean;
  isTerminal: boolean;
};

export type EscalationTimelineDto = {
  escalationId: string;
  chainId: string | null;
  chainName: string | null;
  currentSequence: number;
  totalLevels: number;
  progressPercent: number;
  items: EscalationTimelineItem[];
};

type LevelRow = {
  sequenceIndex: number;
  effectiveLevel: number;
  levelName: string;
  ownerKind: string;
  ownerId: string | null;
  ownerDisplayName: string | null;
  slaDays: number | null;
  autoEscalate: boolean;
  isTerminal: boolean;
  iconKey?: string;
};

type LogRow = {
  action: string;
  sequenceIndex: number;
  createdAt: Date;
  message?: string | null;
};

type ReminderRow = {
  sequenceIndex: number;
  kind: string;
  sentAt: Date;
};

export function buildTimeline(args: {
  escalationId: string;
  chainId: string | null;
  chainName: string | null;
  chainDefaultSlaDays: number;
  currentSequence: number;
  status: string;
  triggeredAt: Date;
  logs: LogRow[];
  levels: LevelRow[];
  reminders: ReminderRow[];
  now?: Date;
  alreadyResolved?: boolean;
}): EscalationTimelineDto {
  const now = args.now ?? new Date();
  const totalLevels = args.levels.length;
  const sorted = [...args.levels].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  // Map when each level was entered/exited from logs
  const enteredAtMap = new Map<number, Date>();
  const exitedAtMap = new Map<number, Date>();
  for (const log of args.logs) {
    if (log.action === 'escalation_triggered' || log.action === 'escalated' || log.action === 'level_changed') {
      if (!enteredAtMap.has(log.sequenceIndex)) {
        enteredAtMap.set(log.sequenceIndex, log.createdAt);
      } else {
        // re-entry means prior exit
        const prev = enteredAtMap.get(log.sequenceIndex);
        if (prev) exitedAtMap.set(log.sequenceIndex, log.createdAt);
        enteredAtMap.set(log.sequenceIndex, log.createdAt);
      }
    }
    // previous level exit when escalation moves forward
    if (log.action === 'escalated' && log.sequenceIndex > 0) {
      exitedAtMap.set(log.sequenceIndex - 1, log.createdAt);
    }
  }
  // first trigger always enters sequence 0
  if (!enteredAtMap.has(0) && args.logs.length > 0) {
    enteredAtMap.set(0, args.triggeredAt);
  }

  // Group reminders by sequence
  const remindersBySeq = new Map<number, ReminderRow[]>();
  for (const r of args.reminders) {
    const list = remindersBySeq.get(r.sequenceIndex) ?? [];
    list.push(r);
    remindersBySeq.set(r.sequenceIndex, list);
  }

  const items: EscalationTimelineItem[] = sorted.map((lvl) => {
    const idx = lvl.sequenceIndex;
    const slaDays = lvl.slaDays ?? args.chainDefaultSlaDays ?? 3;
    const entered = enteredAtMap.get(idx) ?? null;
    const exited = exitedAtMap.get(idx) ?? null;
    const iconInfo = iconForLevel(lvl.levelName, lvl.iconKey ?? null);

    let status: TimelineItemStatus;
    if (idx < args.currentSequence) status = 'completed';
    else if (idx === args.currentSequence) {
      if (args.status === 'resolved' || args.status === 'closed') status = 'completed';
      else status = 'active';
    } else {
      status = 'pending';
    }

    // Compute deadline for the level from entered time
    let deadline: Date | null = null;
    let clock: SlaClockDto | null = null;
    if (entered) {
      deadline = computeSlaDeadline(entered, slaDays, true);
      if (idx === args.currentSequence && status === 'active') {
        const windowMs = deadline.getTime() - entered.getTime();
        clock = buildSlaClockDto({
          slaDeadline: deadline,
          now,
          originalWindowMs: windowMs,
          resolved: args.alreadyResolved ?? false,
        });
        if (clock.state === 'breached') status = 'breached';
      }
    }

    const reminders = (remindersBySeq.get(idx) ?? []).map((r) => ({
      kind: r.kind,
      sentAt: r.sentAt.toISOString(),
    }));

    return {
      sequenceIndex: idx,
      effectiveLevel: lvl.effectiveLevel,
      levelName: lvl.levelName,
      ownerKind: lvl.ownerKind,
      ownerId: lvl.ownerId ?? null,
      ownerDisplayName: lvl.ownerDisplayName ?? null,
      iconKey: iconInfo.key as EscalationIconKey,
      iconEmoji: iconInfo.emoji,
      slaDays,
      status,
      enteredAt: entered ? entered.toISOString() : null,
      exitedAt: exited ? exited.toISOString() : null,
      deadline: deadline ? deadline.toISOString() : null,
      clock,
      breachCount: 0,
      remindersSent: reminders,
      autoEscalate: lvl.autoEscalate,
      isTerminal: lvl.isTerminal,
    };
  });

  const progressPercent =
    totalLevels === 0 ? 0 : Math.round(((args.currentSequence + 1) / totalLevels) * 100);

  return {
    escalationId: args.escalationId,
    chainId: args.chainId,
    chainName: args.chainName,
    currentSequence: args.currentSequence,
    totalLevels,
    progressPercent,
    items,
  };
}
