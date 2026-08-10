/**
 * The `connector` workflow node — every connector action, as a workflow step.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The connector catalog already held ~170 actions across Twilio, SendGrid,
 * Slack, Stripe, Zendesk and every tenant-authored connector, and agents and
 * webhook handlers could call all of them. The workflow builder could not call
 * ANY of them. It had `gmail` — one hardcoded node kind wrapping one vendor —
 * and nothing else, so "send an SMS when this happens" was not expressible in a
 * workflow no matter how complete the catalog got.
 *
 * This node closes that by being deliberately GENERIC: it takes a connector key
 * and an action key as CONFIG rather than as code. The consequence is the point —
 * a connector added to the catalog, or authored by a tenant in the connector
 * builder, becomes a usable workflow step the moment it is published, with no
 * change here, in the executor, or in the palette. A per-vendor node kind (the
 * `gmail` shape) would have required a code change, a deploy and a palette entry
 * per vendor, which is why there was exactly one of them.
 *
 * ── ONE RUNTIME, NOT A SECOND ONE ───────────────────────────────────────────
 * Execution delegates to {@link executeConnectorAction}, the same function an
 * agent's tool call and a webhook handler's connector step use. That is what
 * makes the SSRF guard, credential decryption, redirect handling, timeouts,
 * response-size caps, secret redaction and the call audit log apply here too —
 * none of it is re-implemented, so none of it can be forgotten. A workflow node
 * that assembled its own HTTP request would be a second, unguarded egress path
 * carrying tenant credentials.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { executeConnectorAction, ConnectorCallError } from '../connectors/connectorRuntime';

/** What a `connector` node stores in its `config`. */
export interface ConnectorNodeConfig {
  /** Catalog key — `twilio`, `sendgrid`, or a tenant's own connector. */
  connector?: unknown;
  /** Action key on that connector. `actionKey` is accepted as an alias. */
  action?: unknown;
  actionKey?: unknown;
  /**
   * Action input. Either a JSON object, or a JSON string (which is what a
   * textarea in the builder produces). Every string value is templated.
   */
  input?: unknown;
  /** Pin one connection; omitted uses the tenant's default for this connector. */
  connectionId?: unknown;
}

export type ConnectorNodeOutcome =
  | { ok: true; output: string }
  | { ok: false; error: string };

/**
 * Substitute the upstream payload into a string value.
 *
 * `{{input}}` is the whole upstream output, matching every other node kind's
 * templating. `{{input.path.to.field}}` reaches into it when it is JSON, which
 * is what a connector action actually needs — `To: "{{input.from}}"` on an SMS
 * reply is the common case, and without field access the only way to get it
 * would be a `transform` node per field.
 */
export function renderConnectorTemplate(template: string, inputText: string): string {
  if (!template.includes('{{')) return template;

  let parsed: unknown;
  let parsedOnce = false;
  const payload = (): unknown => {
    if (!parsedOnce) {
      parsedOnce = true;
      try {
        parsed = JSON.parse(inputText);
      } catch {
        parsed = undefined;
      }
    }
    return parsed;
  };

  return template.replace(/\{\{\s*input(?:\.([a-zA-Z0-9_.[\]]+))?\s*\}\}/g, (_match, path?: string) => {
    if (!path) return inputText;
    const value = path
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), payload());
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/** Template every string in the input tree, leaving other types alone. */
export function renderConnectorInput(value: unknown, inputText: string): unknown {
  if (typeof value === 'string') return renderConnectorTemplate(value, inputText);
  if (Array.isArray(value)) return value.map((v) => renderConnectorInput(v, inputText));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderConnectorInput(v, inputText);
    return out;
  }
  return value;
}

/**
 * Read the node's `input` config, which is an object when set programmatically
 * and a JSON string when typed into the builder's textarea. A malformed string
 * is an ERROR rather than an empty object: silently sending no parameters would
 * make a mistyped brace look like a connector that ignores its inputs.
 */
export type ParsedConnectorInput =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; error: string };

export function parseConnectorInput(raw: unknown): ParsedConnectorInput {
  if (raw === undefined || raw === null || raw === '') return { ok: true, input: {} };
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return { ok: true, input: {} };
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'Input must be a JSON object' };
      }
      return { ok: true, input: parsed as Record<string, unknown> };
    } catch (e) {
      return { ok: false, error: `Input is not valid JSON (${e instanceof Error ? e.message : 'parse error'})` };
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, input: raw as Record<string, unknown> };
  return { ok: false, error: 'Input must be a JSON object' };
}

/**
 * Run one `connector` node.
 *
 * Returns a structured outcome rather than throwing so the executor records the
 * connector's own error text on the task — "Twilio rejected: 'To' is not a valid
 * phone number" is actionable, and a generic "node failed" is not.
 */
export async function executeConnectorNode(
  ctx: { db: Db; env: Env; tenantId: number },
  config: ConnectorNodeConfig,
  inputText: string,
): Promise<ConnectorNodeOutcome> {
  const connectorKey = typeof config.connector === 'string' ? config.connector.trim() : '';
  // `action` is what every surface calls it; `actionKey` is what the runtime
  // calls it, and a definition written against either should work.
  const actionKey = typeof config.action === 'string'
    ? config.action.trim()
    : typeof config.actionKey === 'string' ? config.actionKey.trim() : '';

  if (!connectorKey) return { ok: false, error: 'Choose an integration for this node' };
  if (!actionKey) return { ok: false, error: `Choose an action on "${connectorKey}" for this node` };

  const parsed = parseConnectorInput(config.input);
  if (!parsed.ok) return parsed;

  try {
    const result = await executeConnectorAction({
      db: ctx.db,
      env: ctx.env,
      tenantId: ctx.tenantId,
      connectorKey,
      actionKey,
      input: renderConnectorInput(parsed.input, inputText) as Record<string, unknown>,
      connectionId: typeof config.connectionId === 'string' && config.connectionId ? config.connectionId : null,
      // A workflow runs unattended on the tenant's behalf — the same actor kind
      // an agent's call carries, so the call log reads consistently.
      actorKind: 'agent',
    });

    if (!result.ok) {
      return { ok: false, error: result.error ?? `${connectorKey}.${actionKey} returned ${result.status}` };
    }
    // The downstream node reads this as `{{input.…}}`, so the action's own result
    // shape is preserved rather than wrapped in an envelope nobody asked for.
    return { ok: true, output: typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? {}) };
  } catch (e) {
    if (e instanceof ConnectorCallError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Connector call failed' };
  }
}
