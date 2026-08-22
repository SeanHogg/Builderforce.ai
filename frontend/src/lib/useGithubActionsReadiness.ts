'use client';

import { useCallback, useEffect, useState } from 'react';

import { reposApi, type GithubActionsStatus } from '@/lib/builderforceApi';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';

/**
 * GitHub Actions readiness — the data half of the surface.
 *
 * It lives in `lib/` and not beside its component because a component may not
 * import `infrastructure/`: presentation depends on the application layer, never
 * on the transport underneath it, and the readiness read goes through the
 * browser's read-through cache. That is the layering the frontend architecture
 * guard enforces, and this module was the one production file breaking it.
 *
 * The split is the same one every other domain here already makes — `usePoints`
 * and `usePhone` are hooks in `lib/` whose cards live in `components/` — so the
 * component next door now takes its answer from a client, exactly like they do.
 *
 * Two very different screens need the same fact — "does this project's repo carry
 * the Builderforce agent workflow?" — and used to have no way to ask:
 *
 *   • Source control settings, to offer "Enable GitHub agent runs" (previously an
 *     API-only POST an operator had to curl by hand), and
 *   • the cloud-agent surface picker, where `GitHub Actions` was selectable for a
 *     project that could not run it. Dispatch then silently degraded to the
 *     durable executor and explained itself in the run timeline — after the fact.
 *
 * One hook, one endpoint, one definition of "enabled", so the settings panel and
 * the picker can never tell a user two different stories.
 */

export interface GithubActionsReadiness {
  status: GithubActionsStatus | null;
  loading: boolean;
  /** Re-read after enabling (the server invalidates its cache on that write, so
   *  this reflects the change immediately rather than after a TTL). */
  refresh: () => void;
}

/** Cache namespace for the readiness read. Prefix-invalidatable per project. */
function readinessKey(projectId: number): string {
  return `gh-actions-readiness:${projectId}`;
}

/**
 * How long a readiness answer is reused across mounts.
 *
 * Short, because the interesting transition — an operator enabling the surface —
 * must show up in the picker without a reload. `refresh()` invalidates the key
 * outright on that write, so the TTL only covers changes made ELSEWHERE (another
 * tab, the API directly), where 30 seconds of staleness costs nothing.
 */
const READINESS_TTL_MS = 30_000;

/**
 * Read the surface's readiness for a project. Defaults to the globally-scoped
 * project so callers that live in shared chrome (the agent form, which is opened
 * from several places) need no plumbing; pass `projectId` where the screen already
 * knows one.
 *
 * ONE request, however many consumers. Source-control settings, the surface
 * picker, and the picker's submit gate all ask independently — deliberately, so
 * none of them takes a hand-computed `canX` from a parent — and the browser's
 * read-through cache collapses those into a single in-flight fetch. Without it,
 * "every consumer owns its own readiness" would mean N calls per screen, which is
 * the reason this was previously argued to need prop-drilling instead.
 *
 * Degrades to `status: null` — never throws and never blocks a form — when there
 * is no project in scope or the read fails. "Unknown" must not be rendered as
 * "broken": the surface picker stays usable and only acts on a POSITIVE "not
 * enabled" answer.
 */
export function useGithubActionsReadiness(projectId?: number | null): GithubActionsReadiness {
  const scope = useOptionalProjectScope();
  const effectiveProjectId = projectId ?? scope?.currentProjectId ?? null;
  const [status, setStatus] = useState<GithubActionsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  // Bumped by refresh() to re-run the fetch effect. Keeping the request inside an
  // effect (rather than firing it from the callback) is what lets a project switch
  // or an unmount cancel an in-flight read instead of writing into a dead tree.
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => {
    if (effectiveProjectId != null) invalidateClientCache(readinessKey(effectiveProjectId));
    setNonce((n) => n + 1);
  }, [effectiveProjectId]);

  useEffect(() => {
    if (effectiveProjectId == null) { setStatus(null); return; }
    let cancelled = false;
    setLoading(true);
    getOrSetClientCached(
      readinessKey(effectiveProjectId),
      () => reposApi.githubActionsStatus(effectiveProjectId),
      { ttlMs: READINESS_TTL_MS },
    )
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveProjectId, nonce]);

  return { status, loading, refresh };
}

/**
 * Can this project actually run an agent on GitHub Actions?
 *
 * `null` is NOT "no" — it is "we do not know" (no project in scope, the read is
 * still in flight, or it failed). Every consumer must treat the three states
 * differently: only a hard `false` may disable anything, because disabling a
 * control on an unknown is how a working configuration becomes unreachable when
 * an unrelated endpoint has a bad minute.
 */
export function useGithubActionsSupported(projectId?: number | null): boolean | null {
  const { status } = useGithubActionsReadiness(projectId);
  if (!status) return null;
  return status.ready;
}

/** Does the project have a GitHub repo at all? Decides WHICH reason to give:
 *  "connect a GitHub repo" and "commit the workflow" are different fixes. */
export function hasGithubRepo(status: GithubActionsStatus | null): boolean {
  return !!status && status.repositories.some((r) => r.supported);
}
