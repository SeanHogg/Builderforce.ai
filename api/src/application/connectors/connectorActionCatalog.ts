/**
 * The action catalog — every connector action a tenant can call, with the
 * parameters each one takes.
 *
 * ── WHY A SEPARATE PROJECTION FROM THE GALLERY SUMMARY ──────────────────────
 * `summarizeCatalog` answers "what can I connect?" and carries an `actionCount`
 * — enough for a card, useless for a form. Anything that has to BUILD a call
 * needs the actions themselves and their parameters: the workflow builder's
 * connector node, which renders a picker and an input template, and any future
 * surface that offers "run an action".
 *
 * The alternative — fetching each manifest as the user clicks — is an N+1 over
 * the network for a list the server already holds in memory, and it makes the
 * action picker wait on a round trip per selection.
 *
 * ── WHY IT IS CACHED, AND KEYED ON THE TENANT ───────────────────────────────
 * Built-in manifests are code and never change between deploys; a tenant's own
 * connectors change only when someone edits one. So the whole projection is
 * slow-changing, read on every builder open, and costs a `connectors` query plus
 * a manifest walk to rebuild — exactly the shape the read-through cache exists
 * for. It is keyed per tenant because tenant-authored connectors are in it, and
 * invalidated by the same `invalidateConnectorCatalog` call every connector write
 * already makes, so a newly published connector shows up in the builder
 * immediately rather than after a TTL.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { authFieldsFor, type ConnectorManifest } from './connectorManifest';
import { listConnectorsForTenant } from './connectorRegistry';

/** One parameter of one action, as a form needs it. */
export interface CatalogParam {
  name: string;
  /** `path` | `query` | `header` | `body`. */
  in: string;
  type: string;
  description: string;
  required: boolean;
  enum?: string[];
}

export interface CatalogAction {
  key: string;
  label: string;
  description: string;
  /** True when the action CHANGES something — sends a message, charges a card. */
  mutates: boolean;
  params: CatalogParam[];
  /** A ready-to-edit input object with every required parameter present. */
  inputTemplate: Record<string, string>;
}

export interface CatalogConnector {
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  origin: 'builtin' | 'tenant';
  docsUrl?: string;
  /** Credential fields this connector needs, so a picker can say what to set up. */
  authFields: Array<{ key: string; label: string; required: boolean; secret: boolean }>;
  actions: CatalogAction[];
}

/** Actions in a stable order: the ones that only READ first, then the ones that
 *  change something — so the destructive options are never the default pick. */
function toActions(manifest: ConnectorManifest): CatalogAction[] {
  return manifest.actions
    .map((action) => {
      const required = new Set(action.required ?? []);
      const params: CatalogParam[] = Object.entries(action.params ?? {}).map(([name, param]) => ({
        name,
        in: param.in,
        type: param.type,
        description: param.description ?? '',
        required: required.has(name),
        ...(Array.isArray(param.enum) ? { enum: param.enum as string[] } : {}),
      }));

      // Pre-seeding the REQUIRED parameters is the difference between a node a
      // person can fill in and one they have to read the docs to start. The
      // values are empty strings, not fake data — a template that looked filled
      // in would get saved unedited.
      const inputTemplate: Record<string, string> = {};
      for (const param of params) if (param.required) inputTemplate[param.name] = '';

      return {
        key: action.key,
        label: action.label,
        description: action.description ?? '',
        mutates: action.mutates === true,
        params,
        inputTemplate,
      };
    })
    .sort((a, b) => (a.mutates === b.mutates ? a.label.localeCompare(b.label) : a.mutates ? 1 : -1));
}

const cacheKey = (tenantId: number): string => `connector-action-catalog:${tenantId}`;

/**
 * Every connector this tenant can call, with its actions and parameters.
 *
 * DRAFT connectors are excluded: the runtime refuses to call one from an agent or
 * a workflow, so offering it in a picker would build a node that fails at run
 * time for a reason the builder could have known.
 */
export async function connectorActionCatalog(
  db: Db,
  env: Env,
  tenantId: number,
): Promise<CatalogConnector[]> {
  return getOrSetCached<CatalogConnector[]>(
    env,
    cacheKey(tenantId),
    async () => {
      const entries = await listConnectorsForTenant(db, tenantId, env);
      return entries
        .filter((e) => e.status === 'published')
        .map((e) => ({
          key: e.manifest.key,
          name: e.manifest.name,
          description: e.manifest.description ?? '',
          category: e.manifest.category,
          icon: e.manifest.icon ?? '🔌',
          origin: e.origin,
          ...(e.manifest.docsUrl ? { docsUrl: e.manifest.docsUrl } : {}),
          authFields: authFieldsFor(e.manifest).map((f) => ({
            key: f.key,
            label: f.label,
            required: f.required === true,
            secret: f.secret === true,
          })),
          actions: toActions(e.manifest),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    { kvTtlSeconds: 600, l1TtlMs: 120_000 },
  );
}
