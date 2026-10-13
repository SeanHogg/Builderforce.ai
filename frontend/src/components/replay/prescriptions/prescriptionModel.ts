/**
 * Pure reads over `ReplayPrescriptionDto` (PRD 33 §5.1) shared by every surface
 * that shows a fix: which fixes a surface is about (`matchesPrescription`), the
 * goal's order (`rankForGoal`), what the impact line may say (`impactView` — no
 * point estimate on low confidence), who makes the fix (`makerOf`) and the
 * status history (`prescriptionHistory`). No React, no I/O.
 */

import type {
  ReplayPrescriptionArea,
  ReplayPrescriptionDto,
  ReplayPrescriptionStatus,
} from '@builderforce/interaction-contract';
import type { InsightGoal } from '@/components/insights/insightGoals';

/** What a surface narrows the site's fixes to. Every given field must match. */
export interface PrescriptionMatch {
  /** A prefix of `subjectKey` (e.g. `<funnelId>:<ord>:` for a funnel step, `proof:<id>`). */
  subject?: string;
  /** The page the fix is about (`pagePath`). */
  route?: string;
  ruleId?: string;
  /** The element the finding names. */
  selector?: string;
}

export function matchesPrescription(p: ReplayPrescriptionDto, match: PrescriptionMatch): boolean {
  if (match.subject != null && !p.subjectKey.startsWith(match.subject)) return false;
  if (match.route != null && p.pagePath !== match.route) return false;
  if (match.ruleId != null && p.ruleId !== match.ruleId) return false;
  if (match.selector != null && p.finding.selector !== match.selector) return false;
  return true;
}

const OPEN_STATUSES: ReadonlySet<ReplayPrescriptionStatus> = new Set(['proposed', 'applied', 'measuring']);

/** Still something to do or to wait for (the others are decided). */
export const isOpenPrescription = (p: Pick<ReplayPrescriptionDto, 'status'>): boolean => OPEN_STATUSES.has(p.status);

/**
 * The areas each goal is moved by, most direct first — DATA. Do next lists the
 * goal's areas first and keeps the API's rank (impact ÷ effort) within each.
 */
export const GOAL_AREAS: Readonly<Record<InsightGoal, readonly ReplayPrescriptionArea[]>> = {
  activation: ['ux', 'funnel', 'content', 'performance', 'accessibility'],
  revenue: ['sales', 'funnel', 'site'],
  signups: ['funnel', 'site', 'content', 'seo', 'ux'],
  retention: ['ux', 'performance', 'content', 'accessibility'],
};

export function rankForGoal(items: readonly ReplayPrescriptionDto[], goal: InsightGoal): ReplayPrescriptionDto[] {
  const areas = GOAL_AREAS[goal];
  const weight = (p: ReplayPrescriptionDto) => {
    const index = areas.indexOf(p.area);
    return index < 0 ? areas.length : index === 0 ? 0 : 1;
  };
  return [...items].sort((a, b) => weight(a) - weight(b) || a.rank - b.rank);
}

export type ImpactView =
  | { kind: 'estimate'; estimate: number; low: number | null; high: number | null }
  | { kind: 'range'; low: number; high: number }
  | { kind: 'none' };

/** D13 / §5.1.2: low confidence (or no estimate) never shows a point estimate. */
export function impactView(impact: ReplayPrescriptionDto['impact']): ImpactView {
  if (impact.confidence !== 'low' && impact.estimate != null) {
    return { kind: 'estimate', estimate: impact.estimate, low: impact.low, high: impact.high };
  }
  if (impact.low != null && impact.high != null) return { kind: 'range', low: impact.low, high: impact.high };
  return { kind: 'none' };
}

/** Who makes the fix: the first action the card offers now, else the one taken. Keys under `replay.prescription.maker`. */
export function makerOf(p: Pick<ReplayPrescriptionDto, 'next' | 'actionKind'>): string | null {
  const offered = p.next.find((action) => action !== 'dismiss');
  if (offered) return offered;
  return p.actionKind ? p.actionKind.replace('_', '-') : null;
}

export interface PrescriptionHistoryEntry {
  /** Under `insights.fix.history`. */
  key: 'created' | 'applied' | 'measured' | 'dismissed';
  /** ISO; null when the DTO does not say when (an action already superseded by its measurement). */
  at: string | null;
  values: Record<string, string>;
}

/** The status story the DTO can tell: found, acted on, measured or dismissed — oldest first. */
export function prescriptionHistory(p: ReplayPrescriptionDto): PrescriptionHistoryEntry[] {
  const out: PrescriptionHistoryEntry[] = [{ key: 'created', at: p.createdAt, values: {} }];
  if (p.status === 'dismissed') {
    out.push({ key: 'dismissed', at: p.updatedAt, values: { reason: p.dismissReason ?? '' } });
    return out;
  }
  if (p.actionKind) out.push({ key: 'applied', at: p.measured ? null : p.updatedAt, values: { action: p.actionKind.replace('_', '-') } });
  if (p.measured) out.push({ key: 'measured', at: p.measured.measuredAt, values: { verdict: p.measured.verdict, release: p.measured.releaseKey ?? '' } });
  return out;
}

/** The drafted change, when the AI wrote one in the `{ kind, target, description }` shape. */
export interface DraftedChange {
  kind: string;
  target: string | null;
  description: string;
}

export function draftedChange(change: unknown): DraftedChange | null {
  if (!change || typeof change !== 'object') return null;
  const raw = change as Record<string, unknown>;
  if (typeof raw.description !== 'string' || !raw.description.trim()) return null;
  return {
    kind: typeof raw.kind === 'string' ? raw.kind : '',
    target: typeof raw.target === 'string' && raw.target ? raw.target : null,
    description: raw.description,
  };
}

