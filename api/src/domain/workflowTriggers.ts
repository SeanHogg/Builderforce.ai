/**
 * Trigger extraction — lowers the `trigger` nodes of a workflow definition into
 * the activatable trigger specs the runtime acts on. Two families of activation:
 *   • transport triggers  — schedule / webhook / rss / inbound-email: fired by the
 *     scheduler sweep (schedule/rss) or an addressed inbound request (webhook/
 *     inbound-email token).
 *   • event triggers      — monitor-breach / incident-created / incident-resolved /
 *     incident-status-change: fired SYNCHRONOUSLY by a domain event inside the app
 *     (see application/workflow/eventTriggers.ts fireEventTriggers). No cron, no
 *     token — they sit in the registry as enabled rows keyed by (tenant, type) and
 *     the emitting service matches + runs them when the event happens.
 * `manual` and the various data-collection labels that have no autonomous transport
 * are intentionally excluded: they only ever start a run via `POST .../run`.
 *
 * This is the single source of truth shared by `syncDefinitionTriggers` (which
 * persists `workflow_triggers` rows) and the tests — keeping the builder's
 * trigger vocabulary and the activation layer in agreement.
 */

import type { WorkflowDefinition } from './workflowGraph';

/**
 * Event-driven trigger types — fired by an internal domain event (a monitor
 * breaching, an incident opening/resolving/changing status) rather than by a
 * cron sweep or an inbound request. The Reliability subsystem emits these.
 */
export const EVENT_TRIGGER_TYPES = [
  'monitor-breach',
  'incident-created',
  'incident-resolved',
  'incident-status-change',
] as const;
export type EventTriggerType = (typeof EVENT_TRIGGER_TYPES)[number];

/** Trigger types that fire workflows autonomously (no user click). */
export const ACTIVATABLE_TRIGGER_TYPES = [
  'schedule', 'webhook', 'rss', 'inbound-email',
  ...EVENT_TRIGGER_TYPES,
] as const;
export type ActivatableTriggerType = (typeof ACTIVATABLE_TRIGGER_TYPES)[number];

/** True when this activatable type is fired by an internal domain event. */
export function isEventTriggerType(t: unknown): t is EventTriggerType {
  return typeof t === 'string' && (EVENT_TRIGGER_TYPES as readonly string[]).includes(t);
}

/** Trigger types addressed by an inbound request/message and so needing a token. */
const ADDRESSED_TYPES = new Set<ActivatableTriggerType>(['webhook', 'inbound-email']);

export interface TriggerSpec {
  nodeId: string;
  triggerType: ActivatableTriggerType;
  config: Record<string, unknown>;
}

export function isActivatableTriggerType(t: unknown): t is ActivatableTriggerType {
  return typeof t === 'string' && (ACTIVATABLE_TRIGGER_TYPES as readonly string[]).includes(t);
}

/** True when this trigger type is fired by an inbound request and needs a token. */
export function triggerNeedsToken(t: ActivatableTriggerType): boolean {
  return ADDRESSED_TYPES.has(t);
}

/** Extract the activatable trigger specs from a definition's trigger nodes. */
export function extractTriggers(def: WorkflowDefinition): TriggerSpec[] {
  const specs: TriggerSpec[] = [];
  for (const node of def.nodes) {
    if (node.kind !== 'trigger') continue;
    const config = node.config ?? {};
    const triggerType = config.triggerType;
    if (!isActivatableTriggerType(triggerType)) continue;
    specs.push({ nodeId: node.id, triggerType, config });
  }
  return specs;
}

/**
 * URL/address-safe random token for webhook + inbound-email addressing.
 * 32 hex chars (128 bits) from the Web Crypto API — available on the Workers
 * runtime and in tests.
 */
export function generateTriggerToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Read a string config value, trimmed; `undefined` when absent/blank. */
export function configString(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Read a positive integer config value; `undefined` when absent/invalid. */
export function configPositiveInt(config: Record<string, unknown>, key: string): number | undefined {
  const v = config[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}
