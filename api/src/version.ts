/**
 * The deployed API version, reported by GET /health, the error handler and every
 * diagnostics capture.
 *
 * Derived from `api/package.json` at bundle time rather than hand-copied, so there is
 * nothing to keep in sync and nothing to drift. esbuild (via wrangler) inlines the
 * single `version` field and tree-shakes the rest of the manifest away.
 *
 * It used to be a literal guarded by a `check:version` CI script. The literal drifted 44
 * releases anyway, and the guard's only effect was to fail deploys over a number a human
 * had forgotten to retype — so the pairing was removed instead of policed.
 */
import { version } from '../package.json';

export const API_VERSION: string = version;

/**
 * The commit this Worker was deployed from, or null when unstamped (local dev, or a
 * deploy that did not pass `--var GIT_SHA:<sha>`). Read by GET /health and the
 * `deploy.status` tool so both report the same value.
 */
export function deployedCommit(env: { GIT_SHA?: string } | undefined): string | null {
  const sha = env?.GIT_SHA?.trim();
  return sha ? sha : null;
}
