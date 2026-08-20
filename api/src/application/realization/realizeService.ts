/**
 * Realize — the act that turns an idea into something a person can open.
 *
 * ── WHY THIS IS MORE THAN "MATERIALIZE THE PLAN" ────────────────────────────
 * `materializeChallenge` writes files into the canvas, seeds the board and wires
 * the backend. That is a built project; it is not yet a proof, because nothing
 * about it has an address. A smoke test in a canvas measures no demand and a
 * demo reel in a canvas cannot be sent to anyone. So this service does the two
 * further things that make it REAL:
 *
 *   1. PUBLISH the project's static files, so the proof has a URL.
 *   2. CREATE the collections its forms post to, so the first submission is
 *      stored rather than 404'd.
 *
 * The second one is not a nicety. `/__api/collections/<name>` answers 404 for a
 * collection that does not exist, and it answers 404 identically for one that
 * does not accept public writes — so a landing page whose collection was never
 * created reports zero demand for an idea people wanted, which is the worst
 * possible failure for a feature whose entire job is to produce evidence.
 *
 * ── WHY IT PUBLISHES THE WHOLE CANVAS AND NOT JUST WHAT IT GENERATED ────────
 * Publishing REPLACES the site's contents. A project accumulates proofs — a demo
 * reel, then a smoke test, then a pilot dashboard — and publishing only the
 * newest one would silently delete the previous ones from a URL somebody has
 * already sent to somebody else.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ingressUrlFor, ensureProjectBackend } from '../backend';
import { materializeChallenge, type MaterializeChallengeResult } from '../challenge/materializeChallenge';
import type { ChallengeSpec } from '../challenge/parseBrief';
import type { ChallengePlan } from '../challenge/planChallenge';
import { publishStaticSite, type PublishAsset } from '../ide/publishStaticSite';
import { createCollection, updateCollection } from '../ide/siteData';
import { siteForProject } from '../ide/siteTraffic';
import { listWorkspaceFiles, readWorkspaceObject } from '../ide/workspaceStore';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * Canvas directories that are source, tooling or backend — never site content.
 *
 * The backend bundles are excluded for a reason beyond tidiness: `aws/`, `gcp/`
 * and `azure/` contain a generated `engine.js` with the project's handler specs
 * embedded, and publishing that to a public static site would hand every
 * visitor the system's internal design.
 */
const NON_SITE_PREFIXES = [
  'handlers/',
  'worker/',
  'aws/',
  'gcp/',
  'azure/',
  '.github/',
  'node_modules/',
  'src/',
];

/** Site content is what a browser can be served. A `.md` charter is a working
 *  document for the team, not a page, and publishing it puts the pilot's exit
 *  criteria on the public internet. */
const SITE_EXTENSIONS = [
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.txt', '.xml', '.pdf', '.mp4', '.webm',
];

export function isPublishablePath(path: string): boolean {
  if (NON_SITE_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return SITE_EXTENSIONS.includes(path.slice(dot).toLowerCase());
}

export interface RealizeResult extends MaterializeChallengeResult {
  /** The address a person can open, once the site is published. */
  liveUrl: string | null;
  /** Static files actually published. */
  publishedAssets: number;
  /** Collections created or confirmed for this proof's forms. */
  collections: string[];
}

/**
 * Publish every static file currently in the project's canvas.
 *
 * Streams each object rather than buffering it: a proof can carry a screen
 * recording, and reading a video into memory inside a Worker is how a publish
 * that worked in testing fails on the one project that mattered.
 */
async function publishCanvas(args: {
  env: Env;
  db: Db;
  bucket: R2Bucket;
  tenantId: number;
  projectId: number;
  projectName: string;
}): Promise<{ url: string | null; count: number; warning: string | null }> {
  const files = (await listWorkspaceFiles(args.bucket, args.projectId))
    .filter((file) => file.size > 0 && isPublishablePath(file.path));

  if (files.length === 0) {
    return {
      url: null,
      count: 0,
      warning: 'Nothing was published — this proof produced no web pages, so it has no address of its own.',
    };
  }

  const assets: PublishAsset[] = [];
  for (const file of files) {
    const object = await readWorkspaceObject(args.bucket, args.projectId, file.path);
    if (!object) continue;
    assets.push({ path: file.path, body: object.body, size: object.size });
  }

  const published = await publishStaticSite({
    env: args.env,
    db: args.db,
    bucket: args.bucket,
    projectId: args.projectId,
    tenantId: args.tenantId,
    projectName: args.projectName,
    assets,
  });

  if (!published.ok) return { url: null, count: 0, warning: `Could not publish the site: ${published.error}` };
  return { url: published.url, count: published.assetCount, warning: null };
}

/**
 * Create the collections this proof's forms post to, and open them to public
 * writes.
 *
 * Both halves matter and only together: a collection that exists but refuses
 * public writes answers 404 to the form exactly as a missing one does.
 *
 * An existing collection is left alone — including its write setting. Re-running
 * a build must not silently re-open a collection whose owner deliberately closed
 * it after the test finished.
 */
async function ensureCollections(args: {
  db: Db;
  tenantId: number;
  projectId: number;
  siteId: number;
  names: readonly string[];
  /** The session this proof came from, stamped onto every collection it creates
   *  so a lead arriving through the form can be traced back to the idea. */
  originSessionId: string | null;
}): Promise<{ created: string[]; warnings: string[] }> {
  const created: string[] = [];
  const warnings: string[] = [];

  for (const name of args.names) {
    try {
      const result = await createCollection(args.db, args.tenantId, args.siteId, args.projectId, name, args.originSessionId);
      if (!result.ok) {
        // 409 is the normal path on a rebuild: it already exists, and its write
        // setting is its owner's to decide.
        if (result.status !== 409) warnings.push(`Collection "${name}": ${result.error}`);
        continue;
      }
      const opened = await updateCollection(args.db, args.tenantId, result.collection.id, {
        acceptsPublicWrites: true,
      });
      if (!opened.ok) {
        warnings.push(`Collection "${name}" was created but could not be opened to the form: ${opened.error}`);
        continue;
      }
      created.push(name);
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/realization/realizeService.ts',
        operation: `ensureCollections:${name}`,
      });
      warnings.push(`Collection "${name}" could not be created.`);
    }
  }

  return { created, warnings };
}

/**
 * Build one realization.
 *
 * The ORDER is load-bearing:
 *   materialize → publish → collections.
 * The site row does not exist until the first publish, and a collection needs a
 * site id — so creating collections before publishing would silently skip every
 * one of them on a project's first proof, which is precisely the case that
 * matters.
 */
export async function realize(args: {
  db: Db;
  env: Env;
  bucket: R2Bucket;
  tenantId: number;
  spec: ChallengeSpec;
  plan: ChallengePlan;
  collections: readonly string[];
  projectId?: number | null;
  /** The Creation Session this proof is of, when it came from a board. Carried
   *  onto every collection so the outcome ledger and the business facts finally
   *  share a key — see migration 0935. */
  sessionId?: string | null;
  runtimeService?: RuntimeService | null;
}): Promise<RealizeResult> {
  const built = await materializeChallenge({
    db: args.db,
    env: args.env,
    bucket: args.bucket,
    tenantId: args.tenantId,
    spec: args.spec,
    plan: args.plan,
    projectId: args.projectId ?? null,
    runtimeService: args.runtimeService,
  });

  const warnings = [...built.warnings];

  const published = await publishCanvas({
    env: args.env,
    db: args.db,
    bucket: args.bucket,
    tenantId: args.tenantId,
    projectId: built.projectId,
    projectName: args.spec.title,
  });
  if (published.warning) warnings.push(published.warning);

  let collections: string[] = [];
  if (args.collections.length) {
    const site = await siteForProject(args.db, args.tenantId, built.projectId);
    if (!site) {
      warnings.push(
        'This proof has a form but no site to store its submissions — publish the project and rebuild, '
        + 'or the first person who fills it in will get an error.',
      );
    } else {
      const ensured = await ensureCollections({
        db: args.db,
        tenantId: args.tenantId,
        projectId: built.projectId,
        siteId: site.siteId,
        names: args.collections,
        originSessionId: args.sessionId ?? null,
      });
      collections = ensured.created;
      warnings.push(...ensured.warnings);
    }
  }

  return {
    ...built,
    warnings,
    liveUrl: published.url,
    publishedAssets: published.count,
    collections,
  };
}

/**
 * The ingress a not-yet-built realization's pages will be generated against.
 *
 * Resolved before the plan is built because a console has to be able to name its
 * own backend, and creating the backend row early is harmless: it is idempotent,
 * and a project that never gets built simply has an ingress token nothing points
 * at.
 */
export async function ingressForPlanning(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number | null,
): Promise<string> {
  if (!projectId) return '';
  const backend = await ensureProjectBackend(env, db, tenantId, projectId);
  return ingressUrlFor(env, backend.ingressToken);
}
