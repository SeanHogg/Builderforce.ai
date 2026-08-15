/**
 * TURNING A BOARD INTO AN APP.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * The canvas and the delivery side of the platform had no join between them.
 * `creation_sessions` carried no project, and `POST /api/realizations` accepted
 * an idea, a challenge id or a project id — never a session. So a person who had
 * just designed something on a board had no action that turned it into a
 * project, and everything the platform already does for a project (a kanban
 * board, tickets, the agent workforce, a manager, an address, monitoring,
 * releases with rollback) was unreachable from the surface where every idea
 * actually starts.
 *
 * ── WHY THIS IS SMALL ────────────────────────────────────────────────────────
 * THE PROJECT IS THE APP. There is no app entity to create, no provisioning to
 * run and no second console to open: `project_sites` is already 1:1 with
 * `projects`, so a project already *has* an address, a backend, a datastore and
 * end users. Converting writes a foreign key and claims a name. Everything
 * downstream is configuration on a row that now exists.
 *
 * ── THE ONE THING THAT WOULD SILENTLY RUIN IT ────────────────────────────────
 * `projects.is_ide_storage` (migration 0224) marks a projects row that exists
 * purely as the storage behind an `ide_project` — and such a row is HIDDEN from
 * the board and the PMO list. An app project created that way would get the
 * hosting and none of the agents, which is precisely the leverage conversion
 * exists to deliver. It is set explicitly to FALSE here, with a test, rather
 * than left to a default somebody could change.
 *
 * ── WHY THE ADDRESS IS CLAIMED HERE AND NOT AT PUBLISH ───────────────────────
 * It used to be derived from the project name during `publishStaticSite`, so a
 * creator found out what their app was called by shipping it. Claiming at
 * conversion writes a `project_sites` row with no assets: the label is reserved
 * against the global unique index from the moment the app exists, and the first
 * publish fills it in. A visitor before that first publish gets a 404 from an
 * address nobody has advertised yet, which is the honest answer.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  creationSessions,
  projectSites,
  projects,
} from '../../infrastructure/database/schema';
import { buildProjectKey } from '../project/projectKey';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  HOSTING_APEX,
  SITES_PREFIX,
  checkSubdomainAvailability,
  invalidateSite,
  newVersionToken,
  type SubdomainAvailability,
} from '../ide/siteHosting';

/**
 * The `modality` value an app project carries.
 *
 * A COLUMN VALUE, not a table and not a boolean: `modality` already
 * discriminates how a project is worked on ('designer' by default), and "this
 * one is a sellable app" is one more value of that same dimension. A separate
 * `is_app` flag would be a second fact about the same thing, free to disagree.
 */
export const APP_MODALITY = 'app';

export interface ConvertToAppInput {
  tenantId: number;
  userId: string;
  sessionId: string;
  /** Requested address label. Falls back to the board's title. */
  label?: string | null;
}

export interface ConvertedApp {
  projectId: number;
  projectKey: string;
  name: string;
  sessionId: string;
  subdomain: string;
  host: string;
  /** True when this call created the project; false when it already existed. */
  created: boolean;
}

export type ConvertResult =
  | { ok: true; app: ConvertedApp }
  | { ok: false; status: 400 | 404 | 409; error: string; availability?: SubdomainAvailability };

/** Allocate a free project key, walking a numeric suffix on collision. */
async function allocateProjectKey(db: Db, tenantId: number, name: string): Promise<string> {
  const base = buildProjectKey(tenantId, name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = attempt === 0 ? base : `${base.slice(0, 46)}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, key))
      .limit(1);
    if (!taken) return key;
  }
  // Bounded and deterministic rather than a loop that can spin. The key is
  // globally unique, so a random tail is preferable to failing the conversion.
  return `${base.slice(0, 42)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

/**
 * Convert a canvas session into an app project.
 *
 * IDEMPOTENT by design: a session that already carries a `project_id` returns
 * that project rather than creating a second one. Conversion is a button a
 * person can double-click, and the alternative is two projects racing for one
 * address.
 */
export async function convertSessionToApp(
  db: Db,
  env: Env,
  input: ConvertToAppInput,
): Promise<ConvertResult> {
  const [session] = await db
    .select({
      id: creationSessions.id,
      title: creationSessions.title,
      description: creationSessions.description,
      projectId: creationSessions.projectId,
    })
    .from(creationSessions)
    .where(and(
      eq(creationSessions.id, input.sessionId),
      eq(creationSessions.tenantId, input.tenantId),
    ))
    .limit(1);
  if (!session) return { ok: false, status: 404, error: 'Board not found.' };

  // Already converted — return what it became. Re-reading the site rather than
  // trusting the caller, so the address reported is the one actually held.
  if (session.projectId != null) {
    const [existing] = await db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        subdomain: projectSites.subdomain,
      })
      .from(projects)
      .leftJoin(projectSites, eq(projectSites.projectId, projects.id))
      .where(and(eq(projects.id, session.projectId), eq(projects.tenantId, input.tenantId)))
      .limit(1);
    if (existing) {
      const subdomain = existing.subdomain ?? '';
      return {
        ok: true,
        app: {
          projectId: existing.id,

          projectKey: existing.key,
          name: existing.name,
          sessionId: session.id,
          subdomain,
          host: subdomain ? `${subdomain}.${HOSTING_APEX}` : '',
          created: false,
        },
      };
    }
    // The project was deleted out from under the board (ON DELETE SET NULL has
    // not fired yet, or the row is gone). Fall through and convert again rather
    // than reporting a project the caller cannot open.
  }

  const name = (session.title || 'Untitled app').trim().slice(0, 120);

  // The address is decided BEFORE anything is written. A conversion that creates
  // a project and then discovers the name is taken leaves a half-made app the
  // creator has to clean up.
  const availability = await checkSubdomainAvailability(db, input.label?.trim() || name, null);
  if (!availability.label) {
    return {
      ok: false,
      status: 400,
      error: availability.reason === 'reserved'
        ? 'That address is reserved by the platform. Choose another.'
        : 'That address cannot be used. Use lowercase letters, numbers and hyphens.',
      availability,
    };
  }
  if (!availability.available) {
    return {
      ok: false,
      status: 409,
      error: `${availability.label} is already taken. Choose another address.`,
      availability,
    };
  }
  const subdomain = availability.label;

  const key = await allocateProjectKey(db, input.tenantId, name);

  const [project] = await db
    .insert(projects)
    .values({
      tenantId: input.tenantId,
      key,
      name,
      description: session.description?.slice(0, 2000) ?? null,
      modality: APP_MODALITY,
      origin: 'ide',
      // LOAD-BEARING. A storage-backing row is hidden from the board and the PMO
      // list, so an app created that way would carry the hosting and none of the
      // agents — the exact leverage this whole conversion exists for. Explicit
      // rather than defaulted, and asserted in `convertSessionToApp.test.ts`.
      isIdeStorage: false,
    })
    .returning({ id: projects.id, key: projects.key, name: projects.name });
  if (!project) return { ok: false, status: 400, error: 'Could not create the project.' };

  // The join. This is the whole structural change in the arc.
  await db
    .update(creationSessions)
    .set({ projectId: project.id, updatedAt: new Date(), updatedBy: input.userId })
    .where(and(
      eq(creationSessions.id, session.id),
      eq(creationSessions.tenantId, input.tenantId),
    ));

  // Reserve the address. Assets arrive on the first publish; until then the site
  // resolves and serves 404, which is correct for a name nobody has been given
  // yet. `onConflictDoNothing` on the subdomain rather than a second existence
  // check: two conversions racing for one name must lose in the database.
  const versionToken = newVersionToken();
  try {
    await db
      .insert(projectSites)
      .values({
        projectId: project.id,
        tenantId: input.tenantId,
        subdomain,
        mode: 'static',
        status: 'active',
        r2Prefix: `${SITES_PREFIX}${subdomain}/${versionToken}/`,
        versionToken,
        assetCount: 0,
        totalBytes: 0,
      })
      .onConflictDoNothing();
    await invalidateSite(env, subdomain);
  } catch (error) {
    // The project and the link are already correct and usable; only the address
    // reservation failed, and `publishStaticSite` will claim one on first
    // publish. Reported rather than swallowed, because a creator who chose a
    // name and silently got a different one has been lied to.
    reportCaughtError(error, {
      source: 'application/canvas/convertSessionToApp.ts',
      operation: `reserveAddress:${subdomain}`,
    });
  }

  return {
    ok: true,
    app: {
      projectId: project.id,
      projectKey: project.key,
      name: project.name,
      sessionId: session.id,
      subdomain,
      host: availability.host ?? `${subdomain}.builderforce.ai`,
      created: true,
    },
  };
}

/**
 * The app a board became, or null.
 *
 * Read by the canvas so the convert action can show its own state — a board that
 * is already an app offers "open the app", not "make this a project". The
 * component decides its own visibility from this rather than taking a
 * `canConvert` prop the caller would have to derive.
 */
export async function appForSession(
  db: Db,
  tenantId: number,
  sessionId: string,
): Promise<{ projectId: number; projectKey: string; name: string; subdomain: string | null } | null> {
  const [row] = await db
    .select({
      projectId: projects.id,
      projectKey: projects.key,
      name: projects.name,
      subdomain: projectSites.subdomain,
    })
    .from(creationSessions)
    .innerJoin(projects, eq(projects.id, creationSessions.projectId))
    .leftJoin(projectSites, eq(projectSites.projectId, projects.id))
    .where(and(
      eq(creationSessions.id, sessionId),
      eq(creationSessions.tenantId, tenantId),
      sql`${creationSessions.projectId} IS NOT NULL`,
    ))
    .limit(1);
  return row ?? null;
}
