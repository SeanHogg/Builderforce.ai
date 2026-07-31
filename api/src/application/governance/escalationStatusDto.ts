/**
 * EscalationStatus DTO — PRD deliverable "Escalation Status DTO"
 * Represents the current state of an escalation for API consumers and the SLA clock / timeline views.
 */

import type { SlaClockDto } from './escalationSlaClock';
import type { EscalationTimelineDto } from './escalationTimeline';

export type EscalationStatusValue =
  | 'triggered'
  | 'active'
  | 'escalated'
  | 'resolving'
  | 'resolved'
  | 'closed'
  | 'breached';

export type EscalationPriority = 'low' | 'medium' | 'high' | 'critical';

export type EscalationStatusDto = {
  id: string;
  tenantId: string;
  initiativeId: string | null;
  teamScope: string;
  chainId: string | null;
  chainName: string | null;
  title: string;
  description: string | null;

  status: EscalationStatusValue;
  priority: EscalationPriority;
  currentSequence: number;
  currentLevelName: string | null;
  currentLevelEffectiveLevel: number | null;
  currentOwnerKind: string | null;
  currentOwnerId: string | null;

  triggeredAt: string;
  currentLevelEnteredAt: string | null;
  slaDeadline: string | null;
  resolvedAt: string | null;
  closedAt: string | null;

  isBreached: boolean;
  breachCount: number;

  clock: SlaClockDto | null;
  timeline: EscalationTimelineDto | null;

  createdByUserId: string | null;
  relatedTaskId: number | null;
  relatedProjectId: string | null;

  reminder24hSentAt: string | null;
  reminder4hSentAt: string | null;
};

export type EscalationResolutionDto = {
  escalationId: string;
  outcome: string;
  stepsTaken: string[] | null;
  recommendedOptions: string[] | null;
  slaBreached: boolean;
  resolvedByUserId: string | null;
  resolvedAt: string;
};

export type EscalationLogEntryDto = {
  id: string;
  escalationId: string;
  action: string;
  sequenceIndex: number;
  performedByUserId: string | null;
  message: string | null;
  payload: unknown | null;
  createdAt: string;
};

export type EscalationChainDto = {
  id: string;
  tenantId: string;
  initiativeId: string | null;
  teamScope: string;
  name: string;
  description: string | null;
  defaultSlaDays: number;
  isActive: boolean;
  levels: EscalationChainLevelDto[];
  createdAt: string;
  updatedAt: string;
};

export type EscalationChainLevelDto = {
  id: string;
  chainId: string;
  sequenceIndex: number;
  effectiveLevel: number;
  levelName: string;
  ownerKind: string;
  ownerId: string | null;
  ownerDisplayName: string | null;
  slaDays: number | null;
  autoEscalate: boolean;
  isTerminal: boolean;
  iconKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export function normalizePriority(v: unknown): EscalationPriority {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s;
  return 'medium';
}

export function normalizeStatus(v: unknown): EscalationStatusValue {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  const valid: EscalationStatusValue[] = ['triggered', 'active', 'escalated', 'resolving', 'resolved', 'closed', 'breached'];
  if ((valid as string[]).includes(s)) return s as EscalationStatusValue;
  return 'active';
}
