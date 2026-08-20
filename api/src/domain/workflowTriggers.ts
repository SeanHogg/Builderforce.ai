/**
 * Trigger extraction — lowers the `trigger` nodes of a workflow definition into
 * the activatable trigger specs the runtime acts on. Two families of activation:
 *   • transport triggers  — schedule / webhook / rss / inbound-email: fired by the
 *     scheduler sweep (schedule/rss) or an addressed inbound request (webhook/
 *     inbound-email token).
 *   • event triggers      — every entry in {@link EVENT_TRIGGER_TYPES}: fired
 *     SYNCHRONOUSLY by a domain event inside the app (see
 *     application/workflow/eventTriggers.ts fireEventTriggers). No cron, no
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
 * Event-driven trigger types — fired by an internal domain event rather than by a
 * cron sweep or an inbound request.
 *
 * Three families, all dispatched by the SAME `fireEventTriggers` seam:
 *   • Reliability — a monitor breaching, an incident opening / resolving /
 *     changing status. Emitted by MonitoringService / IncidentService.
 *   • Delivery    — a board event (task created / moved / completed, comment
 *     added). Emitted by the task application service.
 *   • Correspondence — an email arriving in a CONNECTED mailbox. Emitted by the
 *     Gmail / Microsoft Graph push handler (application/mailbox/mailboxWatch.ts).
 *   • Growth      — a form submission, a page view, a signup, a purchase, an
 *     email open / click, and a generic integration event. Emitted by the
 *     collection, site, commerce, campaign and webhook services that own them.
 *
 * The Delivery/Growth half rendered in the builder's palette for a long time
 * while being excluded from {@link ACTIVATABLE_TRIGGER_TYPES}, so choosing "task
 * moved → run this workflow" created no `workflow_triggers` row and nothing ever
 * fired it. Adding a type here is the whole activation step; the emitting service
 * then calls `fireEventTriggers` with the matching context.
 */
export const EVENT_TRIGGER_TYPES = [
  // Reliability
  'monitor-breach',
  'incident-created',
  'incident-resolved',
  'incident-status-change',
  // Delivery
  'board-event',
  // Correspondence — an email arriving in a mailbox the tenant CONNECTED. See
  // the note below the array for why this is not the same thing as inbound-email.
  'mailbox-received',
  // Quality — the Agentic Tester events. See the note below the array.
  'qa-finding',
  'qa-exploration-complete',
  // Growth
  'form-submit',
  'page-view',
  'signup',
  'purchase',
  'email-open',
  'email-click',
  'integration',
] as const;
export type EventTriggerType = (typeof EVENT_TRIGGER_TYPES)[number];

/**
 * CORRESPONDENCE — why `mailbox-received` is not `inbound-email`.
 *
 * `inbound-email` is a TRANSPORT trigger: the workflow is handed a private address
 * we own (`wf+<token>@inbound.builderforce.ai`) and fires when something is sent
 * to it. It can only ever see mail addressed deliberately at a robot.
 *
 * `mailbox-received` is the other half, and it is the one people ask for: mail
 * arriving in the mailbox they already read. It cannot be a transport trigger,
 * because nothing addresses it — the cause is a Gmail or Microsoft Graph push
 * against a mailbox the tenant connected, which is a domain event exactly like a
 * task moving. `application/mailbox/mailboxWatch.ts` owns that subscription and
 * calls `fireEventTriggers`; the payload is deliberately the same four fields
 * `inbound-email` delivers, so a workflow written against one reads the other.
 *
 * PROVIDER-NEUTRAL BY NAME. It is `mailbox-received` and not `gmail-received`
 * because the mailbox port is provider-neutral by construction — one adapter
 * interface over Gmail and Graph. A trigger named after one vendor would have
 * forced a second one the day the other provider was wired up, and the two would
 * have drifted the way every pair of vendor-shaped triggers does.
 */

/**
 * QUALITY EVENTS — why the Agentic Tester belongs in this list.
 *
 * A tester that can only be started by a person, or by its own private cron, is
 * a tool bolted onto the side of delivery. One whose results can START a workflow
 * is part of the loop: "a critical finding on the checkout route opens a ticket
 * and pages the on-call", "a failed nightly run posts the verdict to the team".
 * The tester already had a schedule of its own (`qa_schedules`) and no way to be
 * a cause of anything else.
 *
 * `qa-finding` fires once per genuinely NEW finding — a re-post of the same
 * fingerprint is deduped and is not new information, so it must not re-fire.
 * `qa-exploration-complete` fires once per run so a workflow can react to the
 * VERDICT rather than to each individual error in it.
 *
 * NOTE: comments inside the arrays above must avoid apostrophes —
 * `check-trigger-palette-parity.mjs` parses those arrays as text with a
 * single-quote regex, and a contraction reads as a phantom trigger type.
 */

/**
 * The config keys a trigger row may filter on, and therefore the keys an emitting
 * service may supply as event context. Same key on both sides by construction —
 * the builder writes `config.<key>`, `fireEventTriggers` matches it against
 * `match.<key>`, and a blank/absent filter means "any".
 *
 * This is a LIST rather than a chain of hand-written comparisons because the
 * previous five-branch version is exactly what made adding a sixth trigger family
 * a code change in the matcher instead of a data change here. Keys must stay in
 * agreement with the builder palette's field keys (`nodeKinds.ts`).
 */
export const TRIGGER_FILTER_KEYS = [
  // Reliability
  'severity', 'affectedSystem', 'incidentSource', 'monitorType', 'status',
  // Delivery
  'boardEvent',
  // Correspondence. `mailboxAccount` narrows to one connected mailbox (matched
  // against its address OR its connection id); `mailboxSender` narrows to who
  // sent it. Both are exact matches, which is what the shared matcher does — a
  // workflow that wants "anything from this domain" leaves them blank and
  // branches inside itself.
  'mailboxAccount', 'mailboxSender',
  // Quality. `findingSeverity` is deliberately its own key rather than reusing
  // `severity`: the incident taxonomy is sev1..sev4 and the QA one is
  // low/medium/high/critical, so one key would silently never match.
  'findingSeverity', 'findingType', 'explorationOutcome',
  // Growth
  'formId', 'pagePath', 'sku', 'campaign', 'integrationEvent',
  // NOTE: the palette's `source` field is a free-text LABEL on every trigger node,
  // not a filter. Treating it as one would silently stop every existing trigger
  // whose author typed a label into it, because no emitter supplies that context.
] as const;
export type TriggerFilterKey = (typeof TRIGGER_FILTER_KEYS)[number];

/**
 * The event context an emitter supplies, keyed by the filter it satisfies.
 *
 * A value may be a LIST of aliases when the thing being matched has more than one
 * honest identifier — a published form is addressable by its slug or its id, an
 * order line by its SKU or its catalog-item id — and the author may reasonably
 * have typed either into the builder. The filter passes when it equals ANY alias.
 */
export type TriggerMatchContext = Partial<Record<TriggerFilterKey, string | readonly (string | null | undefined)[] | null | undefined>>;

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
