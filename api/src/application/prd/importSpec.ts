/**
 * Import one GitHub / Linear / Jira issue as a Spec (not a Task).
 *
 * v1 is one-shot: fetch the ticket, upsert a spec keyed by
 * (tenantId, sourceProvider, sourceExternalId). No two-way sync, no auto-import.
 * Connection tokens stay in credentials — they are never written onto spec rows.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  boardConnections,
  externalTicketLinks,
  projects,
  specs,
  tasks,
} from '../../infrastructure/database/schema';
import { loadProjectInTenant } from '../project/loadProject';
import { integrationCredentialSecret } from '../credentials/integrationCredentialSecret';
import {
  createBoardProvider,
  PermanentBoardProviderError,
  type BoardProviderId,
  type NormalizedTicket,
} from '../boardsync/providers';
import { linkSpecToTask } from './taskPrd';

export const SPEC_IMPORT_PROVIDERS = ['github', 'jira', 'linear'] as const;
export type SpecImportProvider = (typeof SPEC_IMPORT_PROVIDERS)[number];

export class SpecImportError extends Error {
  readonly status: 400 | 404 | 502;
  constructor(message: string, status: 400 | 404 | 502) {
    super(message);
    this.name = 'SpecImportError';
    this.status = status;
  }
}

export type SpecImportResult = {
  spec: Record<string, unknown>;
  created: boolean;
  linkedTaskId: number | null;
};

/** Fields the HTTP + MCP surfaces may return — never credentials or token-shaped keys. */
const PUBLIC_SPEC_IMPORT_FIELDS = [
  'id', 'projectId', 'goal', 'status', 'kind', 'prd',
  'sourceProvider', 'sourceExternalId', 'sourceUrl',
  'createdAt', 'updatedAt',
] as const;

/** Project an import result to the public shape (tokens cannot leak even if extra columns appear). */
export function publicSpecImportResult(
  spec: Record<string, unknown>,
  extra: { created: boolean; linkedTaskId: number | null },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_SPEC_IMPORT_FIELDS) {
    if (spec[f] !== undefined) out[f] = spec[f];
  }
  out.created = extra.created;
  out.linkedTaskId = extra.linkedTaskId;
  return out;
}

function isSpecImportProvider(value: string): value is SpecImportProvider {
  return (SPEC_IMPORT_PROVIDERS as readonly string[]).includes(value);
}

export type BoardConnectionRow = {
  id: string;
  tenantId: number;
  projectId: number;
  provider: string;
  credentialId: string | null;
  externalBoardId: string | null;
  status: string;
};

export function pickBoardConnection(
  rows: BoardConnectionRow[],
  args: { provider?: string | null; connectionId?: string | null },
): BoardConnectionRow {
  const active = rows.filter((r) => r.status === 'active');
  if (args.connectionId) {
    const hit = active.find((r) => r.id === args.connectionId);
    if (!hit) throw new SpecImportError('Board connection not found', 404);
    if (!isSpecImportProvider(hit.provider)) {
      throw new SpecImportError(
        `Provider "${hit.provider}" is not supported for spec import (github, jira, linear)`,
        400,
      );
    }
    return hit;
  }
  const pool = args.provider
    ? active.filter((r) => r.provider === args.provider)
    : active.filter((r) => isSpecImportProvider(r.provider));
  if (pool.length === 0) {
    const label = args.provider ? `${args.provider} ` : '';
    throw new SpecImportError(`No ${label}board connection on this project`, 404);
  }
  if (!args.provider && pool.length > 1) {
    throw new SpecImportError(
      'Multiple board connections on this project — pass provider or connectionId',
      400,
    );
  }
  const chosen = pool[0]!;
  if (!isSpecImportProvider(chosen.provider)) {
    throw new SpecImportError(
      `Provider "${chosen.provider}" is not supported for spec import (github, jira, linear)`,
      400,
    );
  }
  return chosen;
}

export function specFieldsFromTicket(ticket: NormalizedTicket): {
  goal: string;
  prd: string | null;
  sourceProvider: SpecImportProvider;
  sourceExternalId: string;
  sourceUrl: string | null;
} {
  if (!isSpecImportProvider(ticket.source)) {
    throw new SpecImportError(
      `Provider "${ticket.source}" is not supported for spec import (github, jira, linear)`,
      400,
    );
  }
  const goal = (ticket.title ?? '').trim() || ticket.externalId;
  const prd = ticket.body?.trim() ? ticket.body : null;
  return {
    goal,
    prd,
    sourceProvider: ticket.source,
    sourceExternalId: ticket.externalId,
    sourceUrl: ticket.externalUrl ?? null,
  };
}

export type ImportSpecDeps = {
  loadProject: typeof loadProjectInTenant;
  loadCredentials: (env: Env, tenantId: number, credentialId: string) => Promise<Record<string, unknown>>;
  createProvider: typeof createBoardProvider;
  linkSpecToTask: typeof linkSpecToTask;
};

const defaultDeps: ImportSpecDeps = {
  loadProject: loadProjectInTenant,
  loadCredentials: (env, tenantId, credentialId) =>
    integrationCredentialSecret(env, tenantId, credentialId),
  createProvider: createBoardProvider,
  linkSpecToTask,
};

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /uq_specs_source|duplicate key|unique constraint|23505/i.test(msg);
}

async function findMatchingTaskId(
  db: Db,
  args: { tenantId: number; connectionId: string; provider: string; externalId: string },
): Promise<number | null> {
  const [link] = await db
    .select({ taskId: externalTicketLinks.taskId })
    .from(externalTicketLinks)
    .where(and(
      eq(externalTicketLinks.tenantId, args.tenantId),
      eq(externalTicketLinks.connectionId, args.connectionId),
      eq(externalTicketLinks.provider, args.provider),
      eq(externalTicketLinks.externalId, args.externalId),
    ))
    .limit(1);
  return typeof link?.taskId === 'number' ? link.taskId : null;
}

export async function importSpecFromBoard(
  db: Db,
  env: Env,
  args: {
    tenantId: number;
    projectId: number;
    externalId: string;
    provider?: string | null;
    connectionId?: string | null;
    taskId?: number | null;
  },
  deps: ImportSpecDeps = defaultDeps,
): Promise<SpecImportResult> {
  const project = await deps.loadProject(db, args.tenantId, args.projectId);
  if (!project) throw new SpecImportError('Project not found', 404);

  const connections = await db
    .select({
      id: boardConnections.id,
      tenantId: boardConnections.tenantId,
      projectId: boardConnections.projectId,
      provider: boardConnections.provider,
      credentialId: boardConnections.credentialId,
      externalBoardId: boardConnections.externalBoardId,
      status: boardConnections.status,
    })
    .from(boardConnections)
    .where(and(
      eq(boardConnections.tenantId, args.tenantId),
      eq(boardConnections.projectId, args.projectId),
    ));

  const connection = pickBoardConnection(connections, {
    provider: args.provider,
    connectionId: args.connectionId,
  });

  if (!connection.credentialId) {
    throw new SpecImportError('Board connection has no credential', 400);
  }

  const credentials = await deps.loadCredentials(env, args.tenantId, connection.credentialId);
  const provider = deps.createProvider({
    id: connection.provider as BoardProviderId,
    tenantId: args.tenantId,
    projectId: args.projectId,
    credentials,
    baseUrl: typeof credentials.baseUrl === 'string' ? credentials.baseUrl : undefined,
    externalBoardId: connection.externalBoardId,
  });

  if (typeof provider.fetchTicket !== 'function') {
    throw new SpecImportError(
      `Provider "${connection.provider}" does not support fetching a single ticket`,
      400,
    );
  }

  let ticket: NormalizedTicket;
  try {
    ticket = await provider.fetchTicket(args.externalId.trim());
  } catch (err) {
    if (err instanceof PermanentBoardProviderError && err.reason === 'not_found') {
      throw new SpecImportError(err.message, 404);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new SpecImportError(`Failed to fetch ticket: ${msg}`, 502);
  }

  const fields = specFieldsFromTicket(ticket);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(specs)
    .where(and(
      eq(specs.tenantId, args.tenantId),
      eq(specs.sourceProvider, fields.sourceProvider),
      eq(specs.sourceExternalId, fields.sourceExternalId),
    ))
    .limit(1);

  let spec: Record<string, unknown>;
  let created: boolean;

  if (existing) {
    const [updated] = await db
      .update(specs)
      .set({
        goal: fields.goal,
        prd: fields.prd,
        sourceUrl: fields.sourceUrl,
        updatedAt: now,
      })
      .where(and(eq(specs.id, existing.id), eq(specs.tenantId, args.tenantId)))
      .returning();
    spec = (updated ?? existing) as Record<string, unknown>;
    created = false;
  } else {
    try {
      const [inserted] = await db
        .insert(specs)
        .values({
          tenantId: args.tenantId,
          projectId: args.projectId,
          goal: fields.goal,
          status: 'draft',
          kind: 'feature',
          prd: fields.prd,
          sourceProvider: fields.sourceProvider,
          sourceExternalId: fields.sourceExternalId,
          sourceUrl: fields.sourceUrl,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      spec = inserted as Record<string, unknown>;
      created = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [raced] = await db
        .select()
        .from(specs)
        .where(and(
          eq(specs.tenantId, args.tenantId),
          eq(specs.sourceProvider, fields.sourceProvider),
          eq(specs.sourceExternalId, fields.sourceExternalId),
        ))
        .limit(1);
      if (!raced) throw err;
      const [updated] = await db
        .update(specs)
        .set({
          goal: fields.goal,
          prd: fields.prd,
          sourceUrl: fields.sourceUrl,
          updatedAt: now,
        })
        .where(and(eq(specs.id, raced.id), eq(specs.tenantId, args.tenantId)))
        .returning();
      spec = (updated ?? raced) as Record<string, unknown>;
      created = false;
    }
  }

  // Optional task_specs link: explicit taskId, else a board-synced task for this ticket.
  // Never create tasks.
  let linkedTaskId: number | null = null;
  const candidateTaskId = args.taskId
    ?? await findMatchingTaskId(db, {
      tenantId: args.tenantId,
      connectionId: connection.id,
      provider: fields.sourceProvider,
      externalId: fields.sourceExternalId,
    });
  if (candidateTaskId != null) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, candidateTaskId), eq(projects.tenantId, args.tenantId)));
    if (task) {
      await deps.linkSpecToTask(db, {
        taskId: task.id,
        specId: String(spec.id),
        tenantId: args.tenantId,
        isPrimary: true,
      });
      linkedTaskId = task.id;
    }
  }

  return { spec, created, linkedTaskId };
}
