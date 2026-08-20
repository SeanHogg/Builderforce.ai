/**
 * Resolving a guided setup against the LIVE workspace.
 *
 * `domain/guidedSetup` decides whether a step is satisfied; this decides what is
 * true. The split is what lets the rules be tested against a literal and the
 * facts be fetched once: three reads (connections, projects, run targets) feed
 * every step of every template, so a wizard costs a fixed number of queries
 * rather than one per step.
 *
 * ── SOURCED OPTIONS ARE THE INTERESTING PART ────────────────────────────────
 * A step may resolve its pick-list by CALLING the integration it is about
 * ("which Mailchimp audience?"). That is an outbound request per open of the
 * wizard, so it is cached, bounded, and skipped entirely when the connector is
 * not connected yet — asking a customer's Mailchimp account for its audiences
 * before they have supplied a Mailchimp key is a guaranteed failed call whose
 * error would read as a broken template.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { agentHosts, projects, workflowDefinitions } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { connectedConnectorKeys as connectedKeys } from '../connectors/connectorTools';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import {
  resolveGuidedPlan,
  type GuidedPlan,
} from '../../domain/guidedSetup/guidedPlan';
import type {
  ChoiceOption,
  ChoiceStep,
  GuidedAnswers,
  GuidedResourceKind,
  GuidedSetupState,
  GuidedStep,
} from '../../domain/guidedSetup/guidedStep';
import type { TemplateManifest } from '../../domain/template/templateManifest';

/** Most options one sourced pick-list may offer. A customer with 4,000 audiences
 *  gets the first page and a search box, not a 4,000-row `<select>`. */
const MAX_SOURCED_OPTIONS = 100;

/**
 * Connector keys with at least one ENABLED connection in this workspace.
 *
 * Delegates to the canonical, read-through-cached reader in `connectorTools.ts`
 * rather than counting rows itself. There used to be two functions of this name —
 * one cached and invalidated by every connector write, one an uncached scan — and
 * the templates gallery used the uncached one. That is the duplication the DRY
 * rule forbids, and it had a visible cost: the "2 of 3 connected" number on a
 * template card, which is the number that decides whether somebody starts, was a
 * per-request scan of a table the platform already keeps a warm, correctly
 * invalidated answer for.
 *
 * `env` is optional only because two callers still resolve it lazily; pass it,
 * and the read is cached AND invalidated the moment somebody connects something.
 */
export async function connectedConnectorKeys(db: Db, tenantId: number, env?: Env): Promise<Set<string>> {
  return new Set(await connectedKeys(db, tenantId, env));
}

/**
 * The pick-lists for every platform resource a step can ask for.
 *
 * Fetched together and only for the kinds the template actually uses: a template
 * that never asks for an agent must not pay for the agent query.
 */
async function loadResources(
  db: Db,
  tenantId: number,
  kinds: ReadonlySet<GuidedResourceKind>,
): Promise<Partial<Record<GuidedResourceKind, ChoiceOption[]>>> {
  const out: Partial<Record<GuidedResourceKind, ChoiceOption[]>> = {};

  const jobs: Promise<void>[] = [];

  if (kinds.has('project')) {
    jobs.push((async () => {
      const rows = await db
        .select({ id: projects.id, name: projects.name, key: projects.key })
        .from(projects)
        .where(eq(projects.tenantId, tenantId))
        .orderBy(desc(projects.updatedAt))
        .limit(200);
      out.project = rows.map((r) => ({ value: String(r.id), label: r.name, help: r.key }));
    })());
  }

  if (kinds.has('agent')) {
    jobs.push((async () => {
      // Both run targets, in one list, because the question a person is being
      // asked is "who runs this?" — not "self-hosted or cloud?". The value is
      // prefixed so the installer can tell them apart without a second field.
      const [hosts, cloud] = await Promise.all([
        db
          .select({ id: agentHosts.id, name: agentHosts.name })
          .from(agentHosts)
          .where(eq(agentHosts.tenantId, tenantId))
          .orderBy(desc(agentHosts.lastSeenAt))
          .limit(100),
        db.execute(sql`
          SELECT id, name FROM ide_agents
          WHERE tenant_id = ${tenantId} AND status = 'active' AND runtime_support IN ('cloud', 'both')
          ORDER BY created_at DESC LIMIT 100
        `),
      ]);
      out.agent = [
        ...(cloud.rows as Array<{ id: string; name: string }>).map((r) => ({
          value: `cloud:${r.id}`,
          label: r.name,
          help: 'Runs on Builderforce',
        })),
        ...hosts.map((h) => ({ value: `host:${h.id}`, label: h.name, help: 'Runs on your own machine' })),
      ];
    })());
  }

  if (kinds.has('workflow')) {
    jobs.push((async () => {
      const rows = await db
        .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.tenantId, tenantId))
        .orderBy(desc(workflowDefinitions.updatedAt))
        .limit(200);
      out.workflow = rows.map((r) => ({ value: r.id, label: r.name }));
    })());
  }

  await Promise.all(jobs);
  return out;
}

/** Read a dot path out of a row, tolerating the shapes real APIs return. */
function readPath(row: unknown, path: string): string | null {
  let cursor: unknown = row;
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor == null) return null;
  if (typeof cursor === 'string' || typeof cursor === 'number' || typeof cursor === 'boolean') return String(cursor);
  return null;
}

/**
 * Resolve one `choice.source` by calling the integration.
 *
 * Returns an empty list rather than throwing: a template whose pick-list could
 * not be fetched is still a template a person can read, and the plan already has
 * a vocabulary for "you cannot continue yet". An exception here would take the
 * whole wizard down over one optional dropdown.
 */
async function resolveSourcedOptions(
  db: Db,
  env: Env,
  tenantId: number,
  step: ChoiceStep,
): Promise<ChoiceOption[]> {
  if (!step.source) return [];
  const { connector, action, valuePath, labelPath, input } = step.source;
  const cacheKey = `templates:options:${tenantId}:${connector}:${action}:${valuePath}`;
  return getOrSetCached(env, cacheKey, async () => {
    try {
      const result = await executeConnectorAction({
        db,
        env,
        tenantId,
        connectorKey: connector,
        actionKey: action,
        input: input ?? {},
        actorKind: 'user',
      });
      if (!result.ok) return [];
      const rows = Array.isArray(result.data)
        ? result.data
        : Array.isArray((result.data as { data?: unknown } | null)?.data)
          ? ((result.data as { data: unknown[] }).data)
          : [];
      const options: ChoiceOption[] = [];
      for (const row of rows.slice(0, MAX_SOURCED_OPTIONS)) {
        const value = readPath(row, valuePath);
        if (!value) continue;
        options.push({ value, label: (labelPath ? readPath(row, labelPath) : null) ?? value });
      }
      return options;
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/templates/templateSetup.ts',
        operation: `resolveSourcedOptions:${connector}/${action}`,
      });
      return [];
    }
    // Short TTL: a customer who just created the audience they are looking for
    // should not have to wait five minutes to see it.
  }, { kvTtlSeconds: 60, l1TtlMs: 30_000 });
}

/**
 * Everything a template's steps are judged against, for this workspace, now.
 *
 * `resolveSources` is a parameter because the two callers want different things:
 * the wizard needs the live pick-lists, and the install re-validation does not —
 * it is checking answers that were already picked, and calling six integrations
 * again on the way to writing rows would make install latency hostage to a
 * vendor's API.
 */
export async function loadSetupState(
  db: Db,
  env: Env,
  tenantId: number,
  steps: readonly GuidedStep[],
  options?: { resolveSources?: boolean },
): Promise<GuidedSetupState> {
  const resourceKinds = new Set(
    steps.filter((s): s is Extract<GuidedStep, { kind: 'resource' }> => s.kind === 'resource')
      .map((s) => s.resource),
  );

  const [connectedConnectors, resources] = await Promise.all([
    connectedConnectorKeys(db, tenantId, env),
    loadResources(db, tenantId, resourceKinds),
  ]);

  if (options?.resolveSources === false) {
    return { connectedConnectors, resources };
  }

  // Only sourced steps whose connector is actually connected — see the header.
  const sourced = steps.filter(
    (s): s is ChoiceStep => s.kind === 'choice' && !!s.source && connectedConnectors.has(s.source.connector),
  );
  const sourcedOptions: Record<string, readonly ChoiceOption[]> = {};
  await Promise.all(sourced.map(async (step) => {
    sourcedOptions[step.id] = await resolveSourcedOptions(db, env, tenantId, step);
  }));

  return { connectedConnectors, resources, sourcedOptions };
}

/** The wizard's view of a template: the manifest's steps, resolved for now. */
export interface TemplateSetupView {
  plan: GuidedPlan;
  state: GuidedSetupState;
}

/**
 * Resolve a template's guided setup for a workspace.
 *
 * The install endpoint calls the SAME function with `touched` covering every
 * step, which is the whole point: a wizard that validated on the client and an
 * install that trusted it is how a template lands half-configured.
 */
export async function resolveTemplateSetup(
  db: Db,
  env: Env,
  tenantId: number,
  manifest: TemplateManifest,
  answers: GuidedAnswers,
  options?: { touched?: ReadonlySet<string>; resolveSources?: boolean },
): Promise<TemplateSetupView> {
  const state = await loadSetupState(db, env, tenantId, manifest.steps, {
    resolveSources: options?.resolveSources ?? true,
  });
  return {
    plan: resolveGuidedPlan(manifest.steps, answers, state, options?.touched),
    state,
  };
}
