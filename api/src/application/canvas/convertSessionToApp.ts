/**
 * TURNING A BOARD INTO AN APP.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * The canvas and the delivery side of the platform had no join that meant
 * IDENTITY. `creation_session_project_links` recorded that a board REFERENCES a
 * project — context, many-to-many, copied when a board is branched — and nothing
 * recorded that a board BECAME one. So a person who had just designed something
 * on a board had no action that turned it into a project, and everything the
 * platform already does for a project (a kanban board, tickets, the agent
 * workforce, a manager, an address, monitoring, releases with rollback) was
 * unreachable from the surface where every idea actually starts.
 *
 * ── WHY A LINK ROLE AND NOT A COLUMN ON THE SESSION ──────────────────────────
 * The first draft added `creation_sessions.project_id`. That is wrong: a
 * session's project would then live in two places free to disagree, which is
 * exactly the per-feature copy of an existing shape 3NF forbids. The
 * relationship already had a home; what it lacked was a ROLE. So `link_kind`
 * carries `'app'`, unique on both sides by partial index — the database is the
 * arbiter rather than a check somebody remembered to write.
 *
 * ── WHY THIS IS SMALL ────────────────────────────────────────────────────────
 * THE PROJECT IS THE APP. There is no app entity to create, no provisioning to
 * run and no second console to open: `project_sites` is already 1:1 with
 * `projects`, so a project already *has* an address, a backend, a datastore and
 * end users. Converting writes one association row and claims a name.
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
 * publish fills it in.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  SESSION_PROJECT_LINK_APP,
  SESSION_PROJECT_LINK_REFERENCE,
  creationSessionProjectLinks,
  creationSessions,
  projectSites,
  projects,
} from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
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
 * WHICH SESSION↔PROJECT LINKS SURVIVE A COPY.
 *
 * Copy, branch and merge all clone a board's project links, and all three must
 * clone only the `reference` ones. An `app` link is an IDENTITY — copying it
 * would give a duplicated board a second claim on somebody's running app, and
 * the partial unique index would refuse the write, so the whole copy fails on a
 * batch nobody could explain.
 *
 * Exported as a predicate rather than restated at each call site: there are
 * three readers of this table's copy semantics, and the fourth one added without
 * the filter is the one that breaks branching a converted board.
 */
export const copyableLinkFilter = eq(
  creationSessionProjectLinks.linkKind,
  SESSION_PROJECT_LINK_REFERENCE,
);

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

/** The shape every reader of "what did this board become" gets back. */
export interface SessionAppLink {
  projectId: number;
  projectKey: string;
  name: string;
  subdomain: string | null;
}

/**
 * The cache key for one board's app link.
 *
 * Keyed by session alone rather than by tenant+session: the query is already
 * tenant-gated on the PROJECT, and a session id is a uuid, so one board has one
 * answer. `convertSessionToApp` is the ONLY writer of that answer, which is why
 * invalidation has exactly one call site.
 */
const sessionAppCacheKey = (sessionId: string) => `session-app:${sessionId}`;

/**
 * The app a board became, or null.
 *
 * Read by the canvas so the convert action can show its own state — a board that
 * is already an app offers "open the app", not "make this a project". The
 * component decides its own visibility from this rather than taking a
 * `canConvert` prop the caller would have to derive.
 *
 * ONE round-trip: the link, its project and that project's site. A board is
 * opened constantly, so the three-table join is deliberate rather than three
 * awaited selects.
 *
 * Uncached at this level ON PURPOSE — `cachedAppForSession` below is the cached
 * entry point. The session READ (`GET /:id`) already pays for a graph and folds
 * this into its `Promise.all`, so caching here would put a KV round-trip on a
 * path that is not waiting for it; the narrow `/:id/app` route is the one that
 * benefits, and it asks for the cached form explicitly.
 */
export async function appForSession(
  db: Db,
  tenantId: number,
  sessionId: string,
): Promise<SessionAppLink | null> {
  const [row] = await db
    .select({
      projectId: projects.id,
      projectKey: projects.key,
      name: projects.name,
      subdomain: projectSites.subdomain,
    })
    .from(creationSessionProjectLinks)
    .innerJoin(projects, eq(projects.id, creationSessionProjectLinks.projectId))
    .leftJoin(projectSites, eq(projectSites.projectId, projects.id))
    .where(and(
      eq(creationSessionProjectLinks.sessionId, sessionId),
      eq(creationSessionProjectLinks.linkKind, SESSION_PROJECT_LINK_APP),
      // The tenant gate is on the PROJECT, not the link: the link table carries
      // no tenant of its own, and reading one by session id alone would let a
      // guessed uuid report another workspace's app.
      eq(projects.tenantId, tenantId),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * The same answer, read through the platform cache.
 *
 * The narrow `GET /:id/app` route exists so a surface can ask "is this board an
 * app?" without paying for the whole graph, and a board is opened, closed and
 * reopened constantly — so the read that made that cheap must not then make a
 * database round-trip per mount. Invalidated by `convertSessionToApp`, the only
 * thing that can change the answer, rather than left to expire.
 */
export async function cachedAppForSession(
  db: Db,
  env: Env,
  tenantId: number,
  sessionId: string,
): Promise<SessionAppLink | null> {
  return getOrSetCached(
    env,
    sessionAppCacheKey(sessionId),
    () => appForSession(db, tenantId, sessionId),
  );
}

/** Allocate a free project key, walking a numeric suffix on collision. */
async function allocateProjectKey(db: Db, tenantId: number, name: string): Promise<string> {
  const base = buildProjectKey(tenantId, name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = attempt === 0 ? base : `${base.slice(0, 46)}-${attempt + 1}`;
    // DELIBERATELY cross-tenant: `projects.key` is unique across the deployment,
    // so a tenant-scoped "is it taken?" answers free for a key another tenant
    // already holds and the insert below then trips the unique constraint.
    const [taken] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(acrossTenants(projects, 'global_uniqueness', eq(projects.key, key)))
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
 * IDEMPOTENT by design: a board that is already an app returns that app rather
 * than creating a second one. Conversion is a button a person can double-click,
 * and the alternative is two projects racing for one address.
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
    })
    .from(creationSessions)
    .where(and(
      eq(creationSessions.id, input.sessionId),
      eq(creationSessions.tenantId, input.tenantId),
    ))
    .limit(1);
  if (!session) return { ok: false, status: 404, error: 'Board not found.' };

  // Already converted — return what it became. Read through the same helper the
  // canvas uses, so "is this a board or an app" has one answer everywhere.
  const already = await appForSession(db, input.tenantId, session.id);
  if (already) {
    const subdomain = already.subdomain ?? '';
    return {
      ok: true,
      app: {
        projectId: already.projectId,
        projectKey: already.projectKey,
        name: already.name,
        sessionId: session.id,
        subdomain,
        host: subdomain ? `${subdomain}.${HOSTING_APEX}` : '',
        created: false,
      },
    };
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

  // THE JOIN. `onConflictDoUpdate` on the composite key so a board that already
  // REFERENCED this project is promoted to owning it rather than failing on the
  // primary key.
  await db
    .insert(creationSessionProjectLinks)
    .values({
      sessionId: session.id,
      projectId: project.id,
      linkKind: SESSION_PROJECT_LINK_APP,
      addedBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [creationSessionProjectLinks.sessionId, creationSessionProjectLinks.projectId],
      set: { linkKind: SESSION_PROJECT_LINK_APP },
    });

  await db
    .update(creationSessions)
    .set({ lastActivityAt: new Date(), updatedAt: new Date(), updatedBy: input.userId })
    .where(and(
      eq(creationSessions.id, session.id),
      eq(creationSessions.tenantId, input.tenantId),
    ));

  // Reserve the address. Assets arrive on the first publish; until then the site
  // resolves and serves 404, which is correct for a name nobody has been given
  // yet. `onConflictDoNothing` rather than a second existence check: two
  // conversions racing for one name must lose in the database.
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

  // AFTER the address is reserved, not after the link: `subdomain` is part of the
  // answer, so invalidating between the two would let a concurrent read refill
  // the cache with an app that has no address and keep it there.
  await invalidateCached(env, sessionAppCacheKey(session.id));

  return {
    ok: true,
    app: {
      projectId: project.id,
      projectKey: project.key,
      name: project.name,
      sessionId: session.id,
      subdomain,
      host: availability.host ?? `${subdomain}.${HOSTING_APEX}`,
      created: true,
    },
  };
}
