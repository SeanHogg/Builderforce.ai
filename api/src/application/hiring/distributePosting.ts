/**
 * FO-B4 — `jobPosting.distribute`: publish a requisition to connected job boards.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────────
 * The canvas `jobPosting` declared `distribution` as rows "written by the distribute
 * action against a connected job board", and `connectors/defaults/hiring.ts` shipped
 * six boards that could each create a posting. Nothing joined the two: there was no
 * caller of `create_posting` for a real requisition, no place to keep the board's
 * answer, and so no way to tell a recruiter where a role was live — or to stop the next
 * press from posting it twice.
 *
 * ── ONE CODE PATH FOR EVERY BOARD ────────────────────────────────────────────────
 * Nothing here names a vendor. A board is distributable when its manifest is in the
 * `hiring` category and declares a `create_posting` action whose `response` mapping
 * names where the board's posting id comes back ({@link distributableAction}). Every
 * call goes through `executeConnectorAction` — credentialled per tenant, SSRF-guarded,
 * audited — and every answer is read by `mapConnectorResponse`. Adding a board is a
 * manifest entry, which is the whole argument of `hiring.ts`.
 *
 * ── THE RULE: NO ID, NO CONFIRMED ROW ────────────────────────────────────────────
 * A row is `posted` only when the board's response carried its id for the posting.
 * A 2xx with no id is a `failed` row with that reason, because a recruiter told "it's
 * live on Indeed" will send candidates there, and an unconfirmed publication cannot be
 * found, updated or closed later. A refusal inside a 2xx body (the manifest's `error`
 * selector) is a failure for the same reason.
 *
 * ── AND IT DOES NOT POST TWICE ───────────────────────────────────────────────────
 * A board that already confirmed this posting is SKIPPED, not re-called: every board
 * here but the feed treats a second create as a second posting. Retrying a `failed`
 * board is the normal path and simply tries again.
 */

import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connectorConnections } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { ConnectorAction, ConnectorManifest } from '../connectors/connectorManifest';
import { listPublishedConnectors } from '../connectors/connectorRegistry';
import { firstOf, mapConnectorResponse, responseHeaderNames } from '../connectors/connectorResponseMapping';
import { loadConnection } from '../connectors/connectorRuntime';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { AtsError } from './atsError';
import { BOARD_JOB_UNIQUE_INDEX, PUBLISH_POSTING_ACTION } from './postingActionKeys';
import { postingInputFor } from './postingInput';
import {
  DEFAULT_DISTRIBUTE_DEPS,
  connectionBackedInput,
  derivedUrl,
  missingConnectionParams,
  pinnedPublicUrl,
  requirePosting,
  type DistributeDeps,
} from './postingDistributionSupport';
import {
  readPostingDistributions,
  recordPostingDistribution,
  type PostingDistributionView,
} from './postingDistributionStore';

export { PUBLISH_POSTING_ACTION };

/** Boards per press. A requisition goes to a handful of boards; more than this is a
 *  syndication job, and the feed connector is the tool for it. */
export const MAX_BOARDS_PER_DISTRIBUTION = 10;

/**
 * The publishing action a manifest offers, or null when it is not a distributable board.
 *
 * All three conditions are data on the manifest. The `externalId` selector is the one
 * that matters: a board whose answer cannot be read for an id could only ever produce
 * `failed` rows, and offering it as a target would be offering a button that cannot
 * succeed.
 */
export function distributableAction(manifest: ConnectorManifest): ConnectorAction | null {
  if (manifest.category !== 'hiring') return null;
  const action = manifest.actions.find((candidate) => candidate.key === PUBLISH_POSTING_ACTION);
  return action?.response?.externalId?.length ? action : null;
}

/** A board this workspace can distribute to: a distributable manifest with an enabled
 *  connection. */
export interface DistributionBoard {
  connectorKey: string;
  name: string;
  icon: string;
  /** The connection a publish runs under — the oldest enabled one, the same default
   *  `defaultConnectionFor` picks for every other connector call. */
  connectionId: string;
  connectionName: string;
}

/** The facts a card holds that the posting row has no column for. All optional; an
 *  absent one is simply not sent, never defaulted to something plausible. */
export interface DistributionListing {
  location?: string | null;
  employmentType?: string | null;
  seniority?: string | null;
  remote?: boolean | null;
  applyUrl?: string | null;
}

export interface DistributePostingInput {
  tenantId: number;
  postingId: string;
  connectorKeys: readonly string[];
  listing?: DistributionListing;
}

/** What happened on one board, this press. */
export interface DistributionOutcome {
  connectorKey: string;
  /** `posted` and `failed` wrote a row; `already-posted` and `unavailable` did not. */
  outcome: 'posted' | 'failed' | 'already-posted' | 'unavailable';
  externalId: string | null;
  url: string | null;
  error: string | null;
}

export interface DistributePostingResult {
  outcomes: DistributionOutcome[];
  /** The posting's whole publication list after this press — what the card redraws
   *  from, so it never patches itself from a partial answer. */
  distributions: PostingDistributionView[];
}


/**
 * Every board this workspace can publish to, oldest connection per board.
 *
 * The catalog read is the cached one every connector surface uses; the connection
 * read is one statement over the tenant's enabled connections.
 */
export async function listDistributionBoards(db: Db, env: Env, tenantId: number): Promise<DistributionBoard[]> {
  return (await resolveBoards(db, env, tenantId)).map(({ board }) => board);
}

/** The boards, each with the action it publishes through — read once per press. */
async function resolveBoards(
  db: Db,
  env: Env,
  tenantId: number,
): Promise<Array<{ board: DistributionBoard; action: ConnectorAction; manifest: ConnectorManifest }>> {
  const catalog = await listPublishedConnectors(db, tenantId, env);
  const boards = catalog.flatMap((entry) => {
    const action = distributableAction(entry.manifest);
    return action ? [{ manifest: entry.manifest, action }] : [];
  });
  if (!boards.length) return [];

  const connections = await db
    .select({ id: connectorConnections.id, connectorKey: connectorConnections.connectorKey, name: connectorConnections.name })
    .from(connectorConnections)
    .where(scopedToTenant(connectorConnections, tenantId, eq(connectorConnections.enabled, true)))
    .orderBy(asc(connectorConnections.createdAt));

  const firstConnection = new Map<string, { id: string; name: string }>();
  for (const connection of connections) {
    if (!firstConnection.has(connection.connectorKey)) firstConnection.set(connection.connectorKey, connection);
  }

  return boards.flatMap(({ manifest, action }) => {
    const connection = firstConnection.get(manifest.key);
    return connection ? [{
      action,
      manifest,
      board: {
        connectorKey: manifest.key,
        name: manifest.name,
        icon: manifest.icon,
        connectionId: connection.id,
        connectionName: connection.name,
      },
    }] : [];
  });
}

/** The read the card draws from: what went out, and where it could go next. */
export async function readPostingDistribution(
  db: Db,
  env: Env,
  tenantId: number,
  postingId: string,
): Promise<{ distributions: PostingDistributionView[]; boards: DistributionBoard[] }> {
  await requirePosting(db, tenantId, postingId);
  const [byPosting, boards] = await Promise.all([
    readPostingDistributions(db, tenantId, postingId, env),
    listDistributionBoards(db, env, tenantId),
  ]);
  return { distributions: byPosting.get(postingId) ?? [], boards };
}

const clip = (message: string): string => message.slice(0, 600);

/**
 * Publish one posting to the chosen boards and record what each one answered.
 *
 * Sequential rather than parallel, deliberately: a handful of boards, each a single
 * call, and running them one at a time keeps the audit log in the order the recruiter
 * would read it and means one board's timeout never races another's write.
 */
export async function distributePosting(
  db: Db,
  env: Env,
  input: DistributePostingInput,
  deps: DistributeDeps = DEFAULT_DISTRIBUTE_DEPS,
): Promise<DistributePostingResult> {
  const keys = [...new Set(input.connectorKeys.map((key) => key.trim()).filter(Boolean))];
  if (!keys.length) throw new AtsError('Choose at least one job board to distribute to', 400);
  if (keys.length > MAX_BOARDS_PER_DISTRIBUTION) {
    throw new AtsError(`Distribute to at most ${MAX_BOARDS_PER_DISTRIBUTION} boards at a time`, 400);
  }

  const posting = await requirePosting(db, input.tenantId, input.postingId);
  // Only an OPEN requisition goes out. Advertising a filled or closed role sends
  // candidates to apply for a job that does not exist.
  if (posting.status !== 'open') {
    throw new AtsError(`This posting is ${posting.status}; only an open posting can be distributed`, 409);
  }

  const [boards, existing] = await Promise.all([
    resolveBoards(db, env, input.tenantId),
    readPostingDistributions(db, input.tenantId, input.postingId, env),
  ]);
  const boardByKey = new Map(boards.map((entry) => [entry.board.connectorKey, entry]));
  const confirmed = new Map(
    (existing.get(input.postingId) ?? [])
      .filter((row) => row.status === 'posted')
      .map((row) => [row.connectorKey, row]),
  );
  const body = postingInputFor(posting, input.listing);

  const outcomes: DistributionOutcome[] = [];
  for (const connectorKey of keys) {
    const already = confirmed.get(connectorKey);
    if (already) {
      outcomes.push({ connectorKey, outcome: 'already-posted', externalId: already.externalId, url: already.url, error: null });
      continue;
    }
    const target = boardByKey.get(connectorKey);
    if (!target) {
      // No row: nothing was attempted, so there is nothing to record — and a `failed`
      // row for a board the workspace never connected would read as a publish that
      // went wrong rather than one that was never possible.
      outcomes.push({
        connectorKey, outcome: 'unavailable', externalId: null, url: null,
        error: 'This job board is not connected to the workspace, or cannot confirm a posting. Connect it under Integrations first.',
      });
      continue;
    }

    const verdict = await publishToBoard(db, env, deps, {
      tenantId: input.tenantId, connectorKey, connectionId: target.board.connectionId, action: target.action, manifest: target.manifest, body,
    });
    const write = {
      tenantId: input.tenantId,
      postingId: input.postingId,
      connectorKey,
      connectionId: target.board.connectionId,
    };
    try {
      await recordPostingDistribution(db, {
        ...write,
        status: verdict.externalId ? 'posted' : 'failed',
        externalId: verdict.externalId,
        url: verdict.url,
        lastError: verdict.error,
      });
    } catch (error) {
      if (!isUniqueViolation(error, BOARD_JOB_UNIQUE_INDEX) || !verdict.externalId) throw error;
      // The board answered with an id another posting already holds (1328: one board job
      // belongs to one posting). Not recorded as a publication of THIS posting.
      verdict.externalId = null;
      verdict.error = 'The job board answered with a posting id that is already linked to another posting here, so this is not recorded as published.';
      await recordPostingDistribution(db, { ...write, status: 'failed', externalId: null, url: null, lastError: verdict.error });
    }
    outcomes.push({
      connectorKey,
      outcome: verdict.externalId ? 'posted' : 'failed',
      externalId: verdict.externalId,
      url: verdict.externalId ? verdict.url : null,
      error: verdict.externalId ? null : verdict.error,
    });
  }

  const after = await readPostingDistributions(db, input.tenantId, input.postingId, env);
  return { outcomes, distributions: after.get(input.postingId) ?? [] };
}

/**
 * One board, one call, one verdict. A confirmed id is returned ONLY when the call
 * succeeded, the body reported no refusal, and the mapping found an id — the three
 * conditions in that order, each with its own sentence for the recruiter.
 */
async function publishToBoard(
  db: Db,
  env: Env,
  deps: DistributeDeps,
  args: { tenantId: number; connectorKey: string; connectionId: string; action: ConnectorAction; manifest: ConnectorManifest; body: Record<string, unknown> },
): Promise<{ externalId: string | null; url: string | null; error: string | null }> {
  const body = { ...args.body };
  const needsConnection = missingConnectionParams(args.action, body);
  if (needsConnection.length) {
    // Only decrypt when a param is declared as `{{auth.x}}` and the posting
    // body does not already carry it. Lever / Indeed never hit this.
    let auth: Record<string, string> = {};
    try {
      const connection = await (deps.loadConnection ?? loadConnection)(db, env, args.tenantId, args.connectionId);
      auth = connection.auth;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The job board could not be reached.';
      return { externalId: null, url: null, error: clip(message) };
    }
    Object.assign(body, connectionBackedInput(args.action, auth));
    const missing = missingConnectionParams(args.action, body);
    if (missing.length) {
      const detail = missing.map((name) => {
        const description = args.action.params[name]?.description;
        return description ? `${name} (${description})` : name;
      }).join(', ');
      return {
        externalId: null,
        url: null,
        error: clip(`This job board is missing ${detail} on its connection. Set it under Integrations before publishing.`),
      };
    }
  }

  let result;
  try {
    result = await deps.execute({
      db,
      env,
      tenantId: args.tenantId,
      connectorKey: args.connectorKey,
      actionKey: args.action.key,
      input: body,
      connectionId: args.connectionId,
      actorKind: 'user',
      captureHeaders: responseHeaderNames(args.action.response),
    });
  } catch (error) {
    // Misconfiguration — a missing credential, a required board field the card did not
    // supply, a blocked URL. Recorded as the failure it is, with the runtime's own
    // sentence, so the recruiter sees what to fix on THIS board while the others go out.
    const message = error instanceof Error ? error.message : 'The job board could not be reached.';
    return { externalId: null, url: null, error: clip(message) };
  }

  if (!result.ok) {
    return { externalId: null, url: null, error: clip(result.error ?? `The job board answered ${result.status}.`) };
  }
  const mapped = mapConnectorResponse(args.action.response, result);
  if (mapped.error) return { externalId: null, url: null, error: clip(`The job board refused the posting: ${mapped.error}`) };
  if (!mapped.externalId) {
    return {
      externalId: null, url: null,
      error: `The job board answered ${result.status} but its response carried no posting id, so this is not recorded as published. Check the board before retrying — if the posting is there, it was created without a reference this workspace can follow.`,
    };
  }
  const externalId = mapped.externalId.slice(0, 255);
  // A url the board reported wins; otherwise the manifest's template builds one.
  const postId = firstOf(result, args.action.response?.postId);
  const url = pinnedPublicUrl(mapped.url, args.manifest) ?? await derivedUrl(db, env, deps, args, externalId, postId);
  return { externalId, url, error: null };
}

