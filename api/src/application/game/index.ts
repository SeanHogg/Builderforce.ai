/**
 * Game targets — the service layer over the {@link GameTarget} port.
 *
 * This is the ONE place that knows how an authored game is bound to the places
 * it can be played: which adapter answers for a target, where its files land in
 * the project workspace, and what was last materialised or published.
 *
 * Files are written through `workspaceStore` rather than to the bucket directly,
 * so path validation cannot be bypassed by a generator — the same discipline the
 * backend port follows for handlers. Reads go through the shared read-through
 * cache and are invalidated on every write, because the targets panel is on the
 * canvas and would otherwise re-query on every render of a game object.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveApiOrigin } from '../../env';
import { projectGameTargets, projectSites, projects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { listProjectSecrets, loadProjectSecretValues } from '../secrets/projectSecrets';
import { publishStaticSite } from '../ide/publishStaticSite';
import { HOSTING_APEX } from '../ide/siteHosting';
import { writeWorkspaceBinary, writeWorkspaceFile } from '../ide/workspaceStore';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { SetupStep } from '../backend/hostingStrategy';
import { androidTarget } from './adapters/android';
import { iosTarget } from './adapters/ios';
import { pwaTarget } from './adapters/pwa';
import { robloxTarget } from './adapters/roblox';
import { webTarget } from './adapters/web';
import { authorRobloxSpec, robloxFiles } from './adapters/roblox';
import { accentFromTitle, gameSlug, normalizeGameDocument, validateGameDocument } from './gameDocument';
import {
  isGameTarget,
  type ComposeStructured,
  type GameBuild,
  type GameTarget,
  type GameTargetContext,
  type GameTargetKey,
} from './gameTarget';
import { publishRobloxPlace, readPublishTarget } from './robloxCloud';
import { rbxlxFromSpec } from './robloxPlace';

const TARGETS: Record<GameTargetKey, GameTarget> = {
  web: webTarget,
  pwa: pwaTarget,
  android: androidTarget,
  ios: iosTarget,
  roblox: robloxTarget,
};

/** Every target, for the picker. Ordered cheapest-to-play first. */
export const GAME_TARGET_LIST: readonly GameTarget[] = [
  webTarget,
  pwaTarget,
  androidTarget,
  iosTarget,
  robloxTarget,
];

export function resolveGameTarget(key: string): GameTarget | null {
  return isGameTarget(key) ? TARGETS[key] : null;
}

/** What the picker needs to render a target without importing the adapters. */
export interface GameTargetSummary {
  key: GameTargetKey;
  label: string;
  summary: string;
  zeroSetup: boolean;
  device: GameTarget['device'];
}

export const GAME_TARGET_SUMMARIES: readonly GameTargetSummary[] = GAME_TARGET_LIST.map((target) => ({
  key: target.key,
  label: target.label,
  summary: target.summary,
  zeroSetup: target.zeroSetup,
  device: target.device,
}));

// ---------------------------------------------------------------------------
// The authored game
// ---------------------------------------------------------------------------

export type GameBuildResult = { ok: true; game: GameBuild } | { ok: false; reason: string };

/**
 * Normalise and check an authored game before anything is built from it.
 *
 * Every target funnels through here, so a document that would produce a blank
 * screen is refused ONCE — at the point of entry — rather than five times in five
 * adapters, or worse, discovered after a five-minute APK build.
 */
export function buildGame(input: { title: string; brief: string; html: string }): GameBuildResult {
  const title = input.title.trim().slice(0, 200) || 'Game';
  const html = normalizeGameDocument(input.html, title);
  const valid = validateGameDocument(html);
  if (!valid.ok) return { ok: false, reason: valid.reason };
  return {
    ok: true,
    game: {
      title,
      slug: gameSlug(title),
      brief: input.brief.trim().slice(0, 4000) || title,
      html,
      accent: accentFromTitle(title),
    },
  };
}

/**
 * The structured-authoring capability handed to adapters that need a model.
 *
 * Runs on the FREE pool (`ideProxy`) for the same reason creative generation
 * does: honouring a creative brief must never land on a paid vendor.
 */
export function composeStructured(env: Env): ComposeStructured {
  return async ({ system, user, schema, maxTokens, useCase }) => {
    const result = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: schema as never,
      useCase,
    });
    if (result.response.status >= 400) throw new Error('The generator is unavailable');
    const { content } = await readProxyChoice(result);
    if (!content.trim()) throw new Error('The generator returned nothing');
    try {
      return JSON.parse(content) as unknown;
    } catch {
      throw new Error('The generator did not return a readable spec');
    }
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface GameTargetState {
  target: GameTargetKey;
  slug: string;
  title: string;
  status: string;
  directory: string;
  fileCount: number;
  playUrl: string | null;
  detail: string | null;
  setupSteps: SetupStep[];
  robloxUniverseId: string | null;
  robloxPlaceId: string | null;
  robloxVersion: number | null;
  lastPublishedAt: string | null;
  updatedAt: string | null;
}

const stateCacheKey = (projectId: number) => `game-targets:${projectId}`;

/**
 * Every materialised target for a project.
 *
 * Cached because the canvas reads this whenever a game object is rendered or
 * selected, and the answer only changes when this module writes it — every write
 * path below invalidates, so the TTL is a backstop rather than the contract.
 */
export async function listGameTargetStates(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<GameTargetState[]> {
  return getOrSetCached(
    env,
    stateCacheKey(projectId),
    async () => {
      const rows = await db
        .select()
        .from(projectGameTargets)
        .where(scopedToTenant(projectGameTargets, tenantId, eq(projectGameTargets.projectId, projectId)))
        .orderBy(projectGameTargets.slug, projectGameTargets.target);
      return rows.map(toGameTargetState);
    },
    { kvTtlSeconds: 300, l1TtlMs: 15_000 },
  );
}

function toGameTargetState(row: typeof projectGameTargets.$inferSelect): GameTargetState {
  return {
    target: row.target as GameTargetKey,
    slug: row.slug,
    title: row.title,
    status: row.status,
    directory: row.directory,
    fileCount: row.fileCount,
    playUrl: row.playUrl,
    detail: row.detail,
    setupSteps: Array.isArray(row.setupSteps) ? (row.setupSteps as SetupStep[]) : [],
    robloxUniverseId: row.robloxUniverseId,
    robloxPlaceId: row.robloxPlaceId,
    robloxVersion: row.robloxVersion,
    lastPublishedAt: row.lastPublishedAt ? new Date(row.lastPublishedAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

async function invalidateGameTargets(env: Env, projectId: number): Promise<void> {
  await invalidateCached(env, stateCacheKey(projectId));
}

// ---------------------------------------------------------------------------
// Materialising
// ---------------------------------------------------------------------------

async function buildContext(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  game: GameBuild,
): Promise<GameTargetContext> {
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(scopedToTenant(projects, tenantId, eq(projects.id, projectId)))
    .limit(1);
  const [site] = await db
    .select({ subdomain: projectSites.subdomain, status: projectSites.status })
    .from(projectSites)
    .where(scopedToTenant(projectSites, tenantId, eq(projectSites.projectId, projectId)))
    .limit(1);
  const secrets = await listProjectSecrets(db, tenantId, projectId);

  return {
    projectId,
    tenantId,
    projectName: project?.name ?? `project-${projectId}`,
    game,
    apiOrigin: resolveApiOrigin(env),
    siteUrl: site && site.status === 'active' ? `https://${site.subdomain}.${HOSTING_APEX}` : null,
    secretNames: secrets.map((secret) => secret.name),
    compose: composeStructured(env),
  };
}

export interface MaterializeGameArgs {
  env: Env;
  db: Db;
  bucket: R2Bucket;
  tenantId: number;
  projectId: number;
  target: GameTargetKey;
  game: GameBuild;
}

export type MaterializeGameResult =
  | { ok: true; state: GameTargetState; writtenPaths: string[] }
  | { ok: false; status: 422 | 502; reason: string };

/**
 * Write a target's files into the project workspace and record what happened.
 *
 * Idempotent: re-materialising overwrites the same paths and the same row. The
 * files ARE the artifact, so a second row describing the same directory could
 * only ever disagree with the first.
 */
export async function materializeGameTarget(args: MaterializeGameArgs): Promise<MaterializeGameResult> {
  const { env, db, bucket, tenantId, projectId, game } = args;
  const target = resolveGameTarget(args.target);
  if (!target) return { ok: false, status: 422, reason: `Unknown game target "${args.target}"` };

  const ctx = await buildContext(env, db, tenantId, projectId, game);

  let produced;
  try {
    produced = await target.materialize(ctx);
  } catch (error) {
    reportCaughtError(error, { source: 'application/game/index.ts', operation: `materialize:${target.key}` });
    return {
      ok: false,
      status: 502,
      reason: error instanceof Error ? error.message : 'The target could not be generated',
    };
  }

  const directory = target.directory(game.slug);
  const writtenPaths: string[] = [];

  for (const [path, contents] of Object.entries(produced.files)) {
    const full = `${directory}/${path}`;
    const written = await writeWorkspaceFile(bucket, projectId, full, contents);
    if (!written.ok) return { ok: false, status: 422, reason: `${full}: ${written.reason}` };
    writtenPaths.push(full);
  }
  for (const [path, bytes] of Object.entries(produced.binaryFiles ?? {})) {
    const full = `${directory}/${path}`;
    const written = await writeWorkspaceBinary(bucket, projectId, full, bytes, 'image/png');
    if (!written.ok) return { ok: false, status: 422, reason: `${full}: ${written.reason}` };
    writtenPaths.push(full);
  }
  // Root files bypass the target directory by design — GitHub only runs a
  // workflow it finds at `.github/workflows/`.
  for (const [path, contents] of Object.entries(produced.rootFiles ?? {})) {
    const written = await writeWorkspaceFile(bucket, projectId, path, contents);
    if (!written.ok) return { ok: false, status: 422, reason: `${path}: ${written.reason}` };
    writtenPaths.push(path);
  }

  const [row] = await db
    .insert(projectGameTargets)
    .values({
      projectId,
      tenantId,
      slug: game.slug,
      title: game.title,
      target: target.key,
      status: 'materialized',
      directory,
      fileCount: writtenPaths.length,
      playUrl: produced.playUrl,
      detail: produced.detail,
      setupSteps: produced.setupSteps,
    })
    .onConflictDoUpdate({
      target: [projectGameTargets.projectId, projectGameTargets.slug, projectGameTargets.target],
      set: {
        title: game.title,
        status: 'materialized',
        directory,
        fileCount: writtenPaths.length,
        playUrl: produced.playUrl,
        detail: produced.detail,
        setupSteps: produced.setupSteps,
        updatedAt: new Date(),
      },
    })
    .returning();

  await invalidateGameTargets(env, projectId);
  return { ok: true, state: toGameTargetState(row!), writtenPaths };
}

// ---------------------------------------------------------------------------
// Publishing — PWA
// ---------------------------------------------------------------------------

export type PublishGameResult =
  | { ok: true; url: string; state: GameTargetState }
  | { ok: false; status: number; error: string };

/**
 * Publish the game as an installable web app.
 *
 * Goes through the SAME `publishStaticSite` the IDE and CI publishes use, so a
 * game and an app claim subdomains, retire stale assets and invalidate caches
 * identically — there is no second publish implementation to drift.
 *
 * The subdomain defaults to the game's slug rather than the project name: what
 * gets typed into a phone is the game's address, and `space-blaster` is a better
 * one than `my-first-project`.
 */
export async function publishGameAsPwa(args: {
  env: Env;
  db: Db;
  bucket: R2Bucket;
  tenantId: number;
  projectId: number;
  game: GameBuild;
  subdomain?: string | null;
}): Promise<PublishGameResult> {
  const { env, db, bucket, tenantId, projectId, game } = args;
  const ctx = await buildContext(env, db, tenantId, projectId, game);
  const produced = await pwaTarget.materialize(ctx);

  const encoder = new TextEncoder();
  const assets = [
    ...Object.entries(produced.files).map(([path, contents]) => {
      const bytes = encoder.encode(contents);
      return { path, body: bytes as unknown as ArrayBuffer, size: bytes.byteLength };
    }),
    ...Object.entries(produced.binaryFiles ?? {}).map(([path, bytes]) => ({
      path,
      body: bytes as unknown as ArrayBuffer,
      size: bytes.byteLength,
    })),
  ];

  const published = await publishStaticSite({
    env,
    db,
    bucket,
    projectId,
    tenantId,
    projectName: game.slug,
    requestedSubdomain: args.subdomain ?? game.slug,
    assets,
  });
  if (!published.ok) return { ok: false, status: published.status, error: published.error };

  // Re-materialise now that the site URL exists: the PWA's setup steps and its
  // play URL are different once it has an address, and the row must describe the
  // published game rather than the pre-publish one.
  const recorded = await materializeGameTarget({ env, db, bucket, tenantId, projectId, target: 'pwa', game });
  if (!recorded.ok) return { ok: false, status: 500, error: recorded.reason };

  return { ok: true, url: published.url, state: recorded.state };
}

// ---------------------------------------------------------------------------
// Publishing — Roblox
// ---------------------------------------------------------------------------

export type RobloxPublishOutcome =
  | { ok: true; placeUrl: string; versionNumber: number; state: GameTargetState }
  | { ok: false; status: number; error: string };

/**
 * Author the place afresh and push it to a live Roblox experience.
 *
 * Re-authoring rather than re-reading the stored `.rbxlx` is deliberate: publish
 * is the point at which the brief becomes what everyone plays, and a stale place
 * from an earlier brief is the one thing that must not go live. The generated
 * file is written back to the workspace in the same pass, so the artifact and the
 * published place are always the same bytes.
 */
export async function publishGameToRoblox(args: {
  env: Env;
  db: Db;
  bucket: R2Bucket;
  tenantId: number;
  projectId: number;
  game: GameBuild;
  universeId: string;
  placeId: string;
}): Promise<RobloxPublishOutcome> {
  const { env, db, bucket, tenantId, projectId, game } = args;

  const target = readPublishTarget(args.universeId, args.placeId);
  if (!target) {
    return {
      ok: false,
      status: 400,
      error:
        'Universe ID and Place ID are the numbers from your experience\'s Creator Dashboard URL, not the '
        + 'whole URL and not the experience name.',
    };
  }

  const secrets = await loadProjectSecretValues(db, env, tenantId, projectId);
  const apiKey = secrets.ROBLOX_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 428,
      error: 'This project has no ROBLOX_API_KEY secret. Add one before publishing to Roblox.',
    };
  }

  const ctx = await buildContext(env, db, tenantId, projectId, game);
  let rbxlx: string;
  let files: Record<string, string>;
  try {
    const spec = await authorRobloxSpec(ctx);
    rbxlx = rbxlxFromSpec(spec);
    files = robloxFiles(spec, game.slug);
  } catch (error) {
    reportCaughtError(error, { source: 'application/game/index.ts', operation: 'publishGameToRoblox:author' });
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : 'Could not author a Roblox place from this brief',
    };
  }

  const published = await publishRobloxPlace(apiKey, target, rbxlx);
  if (!published.ok) return { ok: false, status: published.status, error: published.error };

  const directory = robloxTarget.directory(game.slug);
  for (const [path, contents] of Object.entries(files)) {
    const written = await writeWorkspaceFile(bucket, projectId, `${directory}/${path}`, contents);
    if (!written.ok) {
      // The place is already live; failing the request now would report a
      // publish that demonstrably happened as a failure. Record it and carry on.
      reportCaughtError(new Error(written.reason), {
        source: 'application/game/index.ts',
        operation: 'publishGameToRoblox:write',
      });
    }
  }

  const [row] = await db
    .insert(projectGameTargets)
    .values({
      projectId,
      tenantId,
      slug: game.slug,
      title: game.title,
      target: 'roblox',
      status: 'published',
      directory,
      fileCount: Object.keys(files).length,
      playUrl: published.placeUrl,
      detail: `Published to Roblox as version ${published.versionNumber}`,
      setupSteps: [],
      robloxUniverseId: target.universeId,
      robloxPlaceId: target.placeId,
      robloxVersion: published.versionNumber,
      lastPublishedAt: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: [projectGameTargets.projectId, projectGameTargets.slug, projectGameTargets.target],
      set: {
        title: game.title,
        status: 'published',
        directory,
        fileCount: Object.keys(files).length,
        playUrl: published.placeUrl,
        detail: `Published to Roblox as version ${published.versionNumber}`,
        setupSteps: [],
        robloxUniverseId: target.universeId,
        robloxPlaceId: target.placeId,
        robloxVersion: published.versionNumber,
        lastPublishedAt: sql`NOW()`,
        updatedAt: new Date(),
      },
    })
    .returning();

  await invalidateGameTargets(env, projectId);
  return {
    ok: true,
    placeUrl: published.placeUrl,
    versionNumber: published.versionNumber,
    state: toGameTargetState(row!),
  };
}

/** Remember which experience a project publishes to, without publishing. */
export async function setRobloxPublishTarget(args: {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  slug: string;
  universeId: string;
  placeId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = readPublishTarget(args.universeId, args.placeId);
  if (!target) return { ok: false, error: 'Universe ID and Place ID must both be numeric.' };
  await args.db
    .update(projectGameTargets)
    .set({ robloxUniverseId: target.universeId, robloxPlaceId: target.placeId, updatedAt: new Date() })
    .where(
      scopedToTenant(
        projectGameTargets,
        args.tenantId,
        and(
          eq(projectGameTargets.projectId, args.projectId),
          eq(projectGameTargets.slug, args.slug),
          eq(projectGameTargets.target, 'roblox'),
        )!,
      ),
    );
  await invalidateGameTargets(args.env, args.projectId);
  return { ok: true };
}
