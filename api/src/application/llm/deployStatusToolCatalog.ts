/**
 * The DEPLOY STATUS tool — "is my commit live yet?", spread into `builtinMcpService`'s
 * `CATALOG`. PLATFORM-INTERNAL: it describes Builderforce's own Workers, so only the
 * platform operator sees or runs it (`isPlatformOperator`, gated in
 * `builtinToolEntitlements` for the listing and re-checked in `run`).
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * An agent that pushed a fix polled CI several times and still could not confirm the
 * deployed API was its commit: GET /health reported only a package version, which does
 * not move per commit. Both Workers now carry the commit they were deployed from
 * (release.yml stamps `GIT_SHA` on deploy-api and deploy-frontend), and this row reads
 * the three facts in ONE call: what the API runs, what the frontend runs, and the
 * latest Release workflow run on the platform repo.
 *
 * ── "IS MY COMMIT LIVE" SURVIVES A NEWER DEPLOY ─────────────────────────────────
 * With `commit`, a Worker serving a DIFFERENT sha is asked of GitHub
 * (`compare/{asked}...{deployed}`): `ahead`/`identical` means the asked commit is in
 * the deployed one, so it is live (`via: 'superseded'`). Unknown stays null.
 *
 * ── NEVER THROWS FOR A MISSING PART ──────────────────────────────────────────────
 * The frontend probe and the GitHub reads each degrade to `{ error }` / null
 * (unreachable frontend, no GitHub connection to the platform repo, Actions 404) so
 * the API part, which reads its own env, always answers.
 *
 * ── CACHED (successes only) ──────────────────────────────────────────────────────
 * The release read is cached 30 s per tenant (KV floors its copy at 60 s) and a
 * compare verdict an hour (two fixed shas never change answer). A failed read is
 * thrown out of the loader and caught outside, so an error is never cached. The
 * frontend probe is not cached — it is the fact that flips first when a deploy lands.
 */
import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { API_VERSION, deployedCommit } from '../../version';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { githubRequest, repoPath, resolveRepoAuth, type ResolvedRepoAuth } from '../repos/githubClient';
import { readLatestActionsRun } from '../repos/repoDelivery';
import { resolveTenantRepoBySlug } from '../repos/resolveDefaultRepo';
import { isPlatformOperator } from '../tenant/platformOperator';
import type { BuiltinCtx, BuiltinTool } from './builtinToolContext';
import { PLATFORM_OPERATOR_REFUSAL } from './platformOperatorTools';

type Json = Record<string, unknown>;

/** The platform's own repo, release workflow and branch — what "the release" means here. */
export const PLATFORM_REPO = { provider: 'github', owner: 'SeanHogg', repo: 'Builderforce.ai' } as const;
export const RELEASE_WORKFLOW = 'release.yml';
export const RELEASE_BRANCH = 'main';

/** Seconds the release read is cached (KV raises its own TTL to its 60 s floor). */
export const RELEASE_CACHE_SECONDS = 30;
/** Seconds a compare verdict is cached — immutable for a fixed sha pair. */
export const COMPARE_CACHE_SECONDS = 3600;
/** The frontend probe's deadline — a stalled frontend must not stall the tool. */
export const FRONTEND_PROBE_TIMEOUT_MS = 5_000;

export { PLATFORM_OPERATOR_REFUSAL };

export type Failure = { error: string };

export interface ReleaseRun {
  workflow: string;
  status: string | null;
  conclusion: string | null;
  headSha: string | null;
  url: string | null;
  createdAt: string | null;
}

export interface FrontendDeploy {
  commit: string | null;
  url: string;
}

/** How a Worker was judged to serve the asked commit: its own sha, or a later sha that contains it. */
export type DeployedVia = 'exact' | 'superseded';

export interface DeployedVerdict {
  commit: string;
  /** true = live, false = not live, null = cannot tell (unstamped Worker or an unreadable compare). */
  api: boolean | null;
  frontend: boolean | null;
  via: { api: DeployedVia | null; frontend: DeployedVia | null };
}

export interface DeployStatus {
  api: { version: string; commit: string | null };
  frontend: FrontendDeploy | Failure;
  release: ReleaseRun | Failure;
  /** null = cannot tell (a side is unstamped or its read failed), never a guessed false. */
  matches: { apiIsLatestRelease: boolean | null; frontendIsLatestRelease: boolean | null };
  /** Only when `commit` was asked about. */
  deployed?: DeployedVerdict;
}

/** Does `deployed` contain `asked`? true / false, or null when unknown. */
export type Containment = (ctx: BuiltinCtx, asked: string, deployed: string) => Promise<boolean | null>;

const isFailure = (v: object): v is Failure => 'error' in v;
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Carries a Failure out of a cache loader, so it is returned but never cached. */
class UncachedFailure extends Error {}

function sameCommit(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  return a.toLowerCase() === b.toLowerCase();
}

function startsWithCommit(sha: string | null, prefix: string): boolean {
  return !!sha && sha.toLowerCase().startsWith(prefix);
}

/** Parse the optional `commit` arg: a hex sha prefix (4–40 chars), lower-cased. */
export function parseCommitPrefix(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  const text = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{4,40}$/.test(text)) throw new Error('commit must be a hex sha or sha prefix (4-40 characters)');
  return text;
}

/**
 * One Worker's verdict for the asked commit. `contained` is the compare answer for a
 * Worker on a different sha (undefined when no compare was made).
 */
function verdictFor(sha: string | null, asked: string, contained: boolean | null | undefined): [boolean | null, DeployedVia | null] {
  if (!sha) return [null, null];
  if (startsWithCommit(sha, asked)) return [true, 'exact'];
  if (contained === true) return [true, 'superseded'];
  if (contained === false) return [false, null];
  return [null, null];
}

/** Compose the reads into the answer. Pure. */
export function composeDeployStatus(
  api: { version: string; commit: string | null },
  frontend: FrontendDeploy | Failure,
  release: ReleaseRun | Failure,
  commit?: string,
  contained: { api?: boolean | null; frontend?: boolean | null } = {},
): DeployStatus {
  const frontendCommit = isFailure(frontend) ? null : frontend.commit;
  const releaseSha = isFailure(release) ? null : release.headSha;
  const status: DeployStatus = {
    api,
    frontend,
    release,
    matches: {
      apiIsLatestRelease: sameCommit(api.commit, releaseSha),
      frontendIsLatestRelease: sameCommit(frontendCommit, releaseSha),
    },
  };
  if (commit) {
    const [apiLive, apiVia] = verdictFor(api.commit, commit, contained.api);
    const [feLive, feVia] = verdictFor(frontendCommit, commit, contained.frontend);
    status.deployed = { commit, api: apiLive, frontend: feLive, via: { api: apiVia, frontend: feVia } };
  }
  return status;
}

/**
 * GET the frontend Worker's /health and read its `commit`. Never throws.
 *
 * A Worker-to-Worker fetch on the same zone: it reaches the frontend Worker because
 * `builderforce.ai` is a `custom_domain = true` route in frontend/wrangler.toml. A
 * plain zone route on the same zone would loop back without invoking that Worker.
 */
export async function readFrontendDeploy(
  env: Pick<Env, 'APP_URL'> | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<FrontendDeploy | Failure> {
  const url = `${resolveAppBaseUrl(env ?? {})}/health`;
  try {
    const res = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FRONTEND_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { error: `${url} returned ${res.status}` };
    const body = (await res.json()) as { commit?: unknown } | null;
    if (!body || typeof body !== 'object') return { error: `${url} did not return a JSON object` };
    return { commit: typeof body.commit === 'string' && body.commit ? body.commit : null, url };
  } catch (e) {
    return { error: `${url} probe failed: ${errorText(e)}` };
  }
}

/** The tenant's credentialed handle on the platform repo, or why there is none. */
async function platformRepoAuth(ctx: BuiltinCtx): Promise<{ auth: ResolvedRepoAuth } | Failure> {
  const env = ctx.env;
  if (!env) return { error: 'worker env unavailable in this context' };
  const repo = await resolveTenantRepoBySlug(ctx.db, ctx.tenantId, PLATFORM_REPO);
  if (!repo) return { error: `this workspace has no GitHub connection to ${PLATFORM_REPO.owner}/${PLATFORM_REPO.repo}` };
  const auth = await resolveRepoAuth(env, ctx.db, integrationCredentialSecret(env), ctx.tenantId, repo.repoId);
  if (!auth.ok) return { error: `GitHub credential unavailable: ${auth.error}` };
  return { auth: auth.auth };
}

/** The latest Release workflow run on the platform repo's main branch, via the tenant's
 *  GitHub connection to that repo. Never throws. Uncached — see {@link readReleaseCached}. */
export async function readLatestRelease(ctx: BuiltinCtx): Promise<ReleaseRun | Failure> {
  try {
    const handle = await platformRepoAuth(ctx);
    if (isFailure(handle)) return handle;
    const runs = await readLatestActionsRun({ auth: handle.auth }, handle.auth.coords, { workflow: RELEASE_WORKFLOW, branch: RELEASE_BRANCH });
    if (!runs.ok) return { error: `GitHub Actions read failed: ${runs.reason}` };
    const run = runs.data.workflow_runs?.[0];
    if (!run) return { error: `no ${RELEASE_WORKFLOW} run on ${RELEASE_BRANCH}` };
    return {
      workflow: run.name ?? RELEASE_WORKFLOW,
      status: run.status,
      conclusion: run.conclusion,
      headSha: run.head_sha ?? null,
      url: run.html_url,
      createdAt: run.created_at ?? null,
    };
  } catch (e) {
    return { error: `release read failed: ${errorText(e)}` };
  }
}

/** {@link readLatestRelease} behind a 30 s cache that holds successes only. */
export async function readReleaseCached(ctx: BuiltinCtx): Promise<ReleaseRun | Failure> {
  try {
    return await getOrSetCached<ReleaseRun>(ctx.env, `deploy-status:release:${ctx.tenantId}`, async () => {
      const release = await readLatestRelease(ctx);
      if (isFailure(release)) throw new UncachedFailure(release.error);
      return release;
    }, { kvTtlSeconds: RELEASE_CACHE_SECONDS, l1TtlMs: RELEASE_CACHE_SECONDS * 1000 });
  } catch (e) {
    return { error: e instanceof UncachedFailure ? e.message : `release read failed: ${errorText(e)}` };
  }
}

/**
 * GitHub `compare/{asked}...{deployed}` on the platform repo: `ahead` or `identical`
 * means `deployed` contains `asked`; `behind`/`diverged` means it does not. Null when
 * the compare cannot be read (no connection, unknown sha). Only a definite answer is
 * cached. githubRequest returns transport errors as values, so the one thing that can
 * throw past here is a programming error — that propagates as the tool's error.
 */
export async function readContainment(ctx: BuiltinCtx, asked: string, deployed: string): Promise<boolean | null> {
  try {
    return await getOrSetCached<boolean>(ctx.env, `deploy-status:compare:${ctx.tenantId}:${asked}:${deployed.toLowerCase()}`, async () => {
      const handle = await platformRepoAuth(ctx).catch((e: unknown) => ({ error: errorText(e) }));
      if (isFailure(handle)) throw new UncachedFailure(handle.error);
      const res = await githubRequest<{ status?: string }>({
        auth: handle.auth,
        path: repoPath(handle.auth.coords, `/compare/${encodeURIComponent(asked)}...${encodeURIComponent(deployed)}`),
      });
      if (!res.ok) throw new UncachedFailure(res.reason);
      const state = res.data.status;
      if (state === 'ahead' || state === 'identical') return true;
      if (state === 'behind' || state === 'diverged') return false;
      throw new UncachedFailure(`unexpected compare status ${String(state)}`);
    }, { kvTtlSeconds: COMPARE_CACHE_SECONDS, l1TtlMs: COMPARE_CACHE_SECONDS * 1000 });
  } catch (e) {
    // Unknown, by contract: the verdict reads null and the model sees "cannot tell".
    if (e instanceof UncachedFailure) return null;
    throw e;
  }
}

/** Seams the tool reads through — swapped in tests. */
export interface DeployStatusReaders {
  frontend: (ctx: BuiltinCtx) => Promise<FrontendDeploy | Failure>;
  release: (ctx: BuiltinCtx) => Promise<ReleaseRun | Failure>;
  contains: Containment;
  /** The platform-operator gate (see `tenant/platformOperator`). */
  isOperator: (ctx: BuiltinCtx) => Promise<boolean>;
}

const LIVE_READERS: DeployStatusReaders = {
  frontend: (ctx) => readFrontendDeploy(ctx.env),
  release: readReleaseCached,
  contains: readContainment,
  isOperator: async (ctx) => !!ctx.env && isPlatformOperator(ctx.env, ctx.tenantId, ctx.userId),
};

/** The tool's body over injectable readers. */
export async function runDeployStatus(ctx: BuiltinCtx, a: Json, readers: DeployStatusReaders = LIVE_READERS): Promise<DeployStatus> {
  if (!(await readers.isOperator(ctx))) throw new Error(PLATFORM_OPERATOR_REFUSAL);
  const commit = parseCommitPrefix(a.commit);
  const [frontend, release] = await Promise.all([readers.frontend(ctx), readers.release(ctx)]);
  const api = { version: API_VERSION, commit: deployedCommit(ctx.env) };
  const contained: { api?: boolean | null; frontend?: boolean | null } = {};
  if (commit) {
    const frontendCommit = isFailure(frontend) ? null : frontend.commit;
    const needs = (sha: string | null): sha is string => !!sha && !startsWithCommit(sha, commit);
    // One compare per distinct deployed sha — both Workers usually serve the same one.
    const memo = new Map<string, Promise<boolean | null>>();
    const ask = (sha: string) => {
      const key = sha.toLowerCase();
      if (!memo.has(key)) memo.set(key, readers.contains(ctx, commit, sha));
      return memo.get(key)!;
    };
    const [apiIn, feIn] = await Promise.all([
      needs(api.commit) ? ask(api.commit) : Promise.resolve(undefined),
      needs(frontendCommit) ? ask(frontendCommit) : Promise.resolve(undefined),
    ]);
    contained.api = apiIn;
    contained.frontend = feIn;
  }
  return composeDeployStatus(api, frontend, release, commit, contained);
}

export const DEPLOY_STATUS_TOOLS: BuiltinTool[] = [
  {
    tool: 'deploy.status',
    mutates: false,
    description:
      'PLATFORM-INTERNAL (platform operator only): is Builderforce\'s latest commit LIVE? One call instead of polling CI. Returns '
      + '{ api: { version, commit }, frontend: { commit, url } | { error }, '
      + 'release: { workflow, status, conclusion, headSha, url, createdAt } | { error }, '
      + 'matches: { apiIsLatestRelease, frontendIsLatestRelease } } — release is the latest Release workflow run on main '
      + '(status "completed" + conclusion "success" = shipped); a match is null when a side is unknown. '
      + 'Pass commit (a sha or prefix) to also get deployed: { commit, api, frontend, via: { api, frontend } } — '
      + 'true when that commit is live on the Worker, either as its exact sha (via "exact") or contained in a newer deployed sha (via "superseded"); '
      + 'null when it cannot be told.',
    parameters: { type: 'object', properties: { commit: { type: 'string' } }, required: [] },
    run: (ctx: BuiltinCtx, a: Json) => runDeployStatus(ctx, a),
  },
];
