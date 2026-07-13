/**
 * Error-mapping resolver — decides which project an inbound event belongs to.
 *
 * A PROJECT collector ingests straight into its own project. A TENANT-level
 * collector ingests a mixed stream (many repos/services), so each event is routed
 * to a project by the first matching mapping rule (lowest `priority` wins), with
 * the collector's `defaultProjectId` as the fallback. No match + no default → null
 * (the event is dropped). Pure — no IO; unit-tested directly.
 */

import type { NormalizedErrorEvent } from './errorSpec';

export interface CollectorRef {
  id: string;
  tenantId: number;
  /** NULL = tenant-level collector (use mapping rules). */
  projectId: number | null;
  defaultProjectId: number | null;
}

export interface MappingRule {
  /** 'service' | 'release' | 'environment' | 'url' | 'tag:<key>'. */
  matchField: string;
  /** 'equals' | 'contains' | 'prefix'. */
  matchOp: string;
  matchValue: string;
  projectId: number;
  priority: number;
}

/** The event attribute a rule field points at (undefined when absent). */
function fieldValue(event: NormalizedErrorEvent, field: string): string | undefined {
  if (field.startsWith('tag:')) return event.tags?.[field.slice(4)];
  switch (field) {
    case 'service':     return event.tags?.service;
    case 'release':     return event.release ?? undefined;
    case 'environment': return event.environment ?? undefined;
    case 'url':         return event.url ?? undefined;
    default:            return event.tags?.[field];
  }
}

function ruleMatches(event: NormalizedErrorEvent, rule: MappingRule): boolean {
  const v = fieldValue(event, rule.matchField);
  if (v == null) return false;
  switch (rule.matchOp) {
    case 'contains': return v.includes(rule.matchValue);
    case 'prefix':   return v.startsWith(rule.matchValue);
    case 'equals':
    default:         return v === rule.matchValue;
  }
}

/**
 * Resolve the destination project for an event. `rules` MUST be pre-sorted by
 * ascending priority (the DB query orders by priority). Returns null when a
 * tenant-level collector can neither match a rule nor fall back to a default.
 */
export function resolveEventProjectId(
  event: NormalizedErrorEvent,
  collector: CollectorRef,
  rules: MappingRule[],
): number | null {
  if (collector.projectId != null) return collector.projectId;
  for (const rule of rules) {
    if (ruleMatches(event, rule)) return rule.projectId;
  }
  return collector.defaultProjectId;
}
