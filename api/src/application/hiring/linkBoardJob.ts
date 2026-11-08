/**
 * Link a BuilderForce posting to a job that ALREADY exists on a connected board.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────
 * Some boards cannot be published to through their public API (Workable has no
 * create-job endpoint), and any board's jobs may have been created there first. Without
 * a way to say "this posting IS that board job", those boards could never carry a
 * distribution row — so applicant import (which starts from a confirmed row) never ran
 * for them. Linking writes that row, nothing else: no posting is created and no
 * visibility changes, because the posting already exists.
 *
 * ── ONE CODE PATH, DATA-DRIVEN ───────────────────────────────────────────────────
 * A board is linkable when its `list_postings` action declares a `boardJobs` mapping.
 * The call goes through `executeConnectorAction`; each item is read by selectors; the
 * public link is the board's own `url` or the action's `response.urlTemplate`.
 *
 * ── RULES ────────────────────────────────────────────────────────────────────────
 * A job may be linked only if the board really lists it (a typed id is not trusted), a
 * posting holds one confirmed publication per board, and one board job belongs to one
 * posting — linking it to a second would split its applicants between two requisitions.
 */

import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connectorConnections } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { ConnectorAction, ConnectorBoardJobMapping } from '../connectors/connectorManifest';
import { listPublishedConnectors, resolveConnector } from '../connectors/connectorRegistry';
import { firstOf } from '../connectors/connectorResponseMapping';
import { AtsError } from './atsError';
import {
  DEFAULT_DISTRIBUTE_DEPS,
  derivedUrl,
  isUniqueViolation,
  publicUrl,
  requirePosting,
  type DistributeDeps,
} from './postingDistributionSupport';
import {
  findPostingLinkedToBoardJob,
  readPostedDistributions,
  readPostingDistributions,
  recordPostingDistribution,
  type PostingDistributionView,
} from './postingDistributionStore';

/** The board action that lists its jobs — one key across the category. */
export const LIST_BOARD_JOBS_ACTION = 'list_postings';
/** Jobs read per call. A board with more has a filtering problem the picker cannot solve. */
export const MAX_BOARD_JOBS = 100;

export interface BoardJob {
  externalId: string;
  title: string;
  state: string | null;
  url: string | null;
}

interface LinkTarget {
  action: ConnectorAction & { boardJobs: ConnectorBoardJobMapping };
  connectionId: string;
}

async function resolveTarget(db: Db, env: Env, tenantId: number, connectorKey: string): Promise<LinkTarget> {
  const resolved = await resolveConnector(db, tenantId, connectorKey, env);
  const action = resolved?.manifest.category === 'hiring'
    ? resolved.manifest.actions.find((candidate) => candidate.key === LIST_BOARD_JOBS_ACTION)
    : undefined;
  if (!resolved || !action?.boardJobs) throw new AtsError('That job board cannot list its jobs, so a job cannot be linked from it', 400);
  const [connection] = await db
    .select({ id: connectorConnections.id })
    .from(connectorConnections)
    .where(scopedToTenant(
      connectorConnections, tenantId,
      eq(connectorConnections.connectorKey, connectorKey),
      eq(connectorConnections.enabled, true),
    ))
    .orderBy(asc(connectorConnections.createdAt))
    .limit(1);
  if (!connection) throw new AtsError('This job board is not connected to the workspace. Connect it under Integrations first.', 409);
  return { action: action as LinkTarget['action'], connectionId: connection.id };
}

/** Read the board's jobs through its declared mapping. Throws `AtsError` on a board failure. */
async function fetchBoardJobs(
  db: Db, env: Env, deps: DistributeDeps, tenantId: number, connectorKey: string, target: LinkTarget,
): Promise<BoardJob[]> {
  const input: Record<string, unknown> = target.action.params.limit ? { limit: MAX_BOARD_JOBS } : {};
  let result;
  try {
    result = await deps.execute({
      db, env, tenantId, connectorKey, actionKey: target.action.key, input,
      connectionId: target.connectionId, actorKind: 'user',
    });
  } catch (error) {
    throw new AtsError(error instanceof Error ? error.message.slice(0, 300) : 'The job board could not be reached.', 502);
  }
  if (!result.ok) throw new AtsError((result.error ?? `The job board answered ${result.status}.`).slice(0, 300), 502);
  if (!Array.isArray(result.data)) throw new AtsError('The job board returned its jobs in an unexpected shape.', 502);

  const mapping = target.action.boardJobs;
  const jobs: BoardJob[] = [];
  for (const item of result.data.slice(0, MAX_BOARD_JOBS)) {
    const view = { data: item };
    const externalId = firstOf(view, mapping.externalId);
    const title = firstOf(view, mapping.title);
    if (!externalId || !title) continue;
    jobs.push({
      externalId: externalId.slice(0, 255),
      title: title.slice(0, 200),
      state: firstOf(view, mapping.state),
      url: publicUrl(firstOf(view, mapping.url)),
    });
  }
  return jobs;
}

/** A connected board whose jobs can be listed and linked. */
export interface LinkableBoard { connectorKey: string; name: string; icon: string }

/** Connected hiring boards whose `list_postings` declares a `boardJobs` mapping. */
export async function listLinkableBoards(db: Db, env: Env, tenantId: number): Promise<LinkableBoard[]> {
  const catalog = await listPublishedConnectors(db, tenantId, env);
  const linkable = catalog.filter((entry) => entry.manifest.category === 'hiring'
    && entry.manifest.actions.some((action) => action.key === LIST_BOARD_JOBS_ACTION && action.boardJobs));
  if (!linkable.length) return [];
  const connected = new Set((await db
    .select({ connectorKey: connectorConnections.connectorKey })
    .from(connectorConnections)
    .where(scopedToTenant(connectorConnections, tenantId, eq(connectorConnections.enabled, true))))
    .map((row) => row.connectorKey));
  return linkable
    .filter((entry) => connected.has(entry.manifest.key))
    .map((entry) => ({ connectorKey: entry.manifest.key, name: entry.manifest.name, icon: entry.manifest.icon }));
}

/** The jobs a posting could be linked to on one board — the picker's list. */
export async function listBoardJobs(
  db: Db, env: Env, tenantId: number, postingId: string, connectorKey: string,
  deps: DistributeDeps = DEFAULT_DISTRIBUTE_DEPS,
): Promise<{ jobs: BoardJob[]; capped: boolean }> {
  await requirePosting(db, tenantId, postingId);
  const target = await resolveTarget(db, env, tenantId, connectorKey);
  const jobs = await fetchBoardJobs(db, env, deps, tenantId, connectorKey, target);
  return { jobs, capped: jobs.length >= MAX_BOARD_JOBS };
}

export interface LinkBoardJobInput {
  tenantId: number;
  postingId: string;
  connectorKey: string;
  /** The board's id for the job — from {@link listBoardJobs}. */
  externalId: string;
}

/** Record that the posting IS this board job; answers with the posting's publication list. */
export async function linkBoardJob(
  db: Db, env: Env, input: LinkBoardJobInput, deps: DistributeDeps = DEFAULT_DISTRIBUTE_DEPS,
): Promise<{ distributions: PostingDistributionView[] }> {
  const externalId = input.externalId.trim().slice(0, 255);
  if (!externalId) throw new AtsError('Choose the board job to link', 400);
  await requirePosting(db, input.tenantId, input.postingId);

  const mine = (await readPostedDistributions(db, input.tenantId, input.postingId))
    .find((row) => row.connectorKey === input.connectorKey);
  if (mine && mine.externalId !== externalId) {
    throw new AtsError('This posting is already published on that board. It holds one publication per board.', 409);
  }
  const owner = await findPostingLinkedToBoardJob(db, input.tenantId, input.connectorKey, externalId);
  if (owner && owner !== input.postingId) {
    throw new AtsError('That board job is already linked to another posting', 409);
  }

  const target = await resolveTarget(db, env, input.tenantId, input.connectorKey);
  const job = (await fetchBoardJobs(db, env, deps, input.tenantId, input.connectorKey, target))
    .find((candidate) => candidate.externalId === externalId);
  if (!job) throw new AtsError('The job board does not list that job', 404);

  const url = job.url ?? await derivedUrl(db, env, deps, {
    tenantId: input.tenantId, connectionId: target.connectionId, action: target.action,
  }, externalId);
  try {
    await recordPostingDistribution(db, {
      tenantId: input.tenantId,
      postingId: input.postingId,
      connectorKey: input.connectorKey,
      connectionId: target.connectionId,
      status: 'posted',
      externalId,
      url,
      lastError: null,
    });
  } catch (error) {
    // The two checks above are a courtesy; THIS is the arbiter (1328's unique index on a
    // confirmed board job). A concurrent link of the same job to another posting lands here.
    if (isUniqueViolation(error)) throw new AtsError('That board job is already linked to another posting', 409);
    throw error;
  }
  const after = await readPostingDistributions(db, input.tenantId, input.postingId, env);
  return { distributions: after.get(input.postingId) ?? [] };
}
