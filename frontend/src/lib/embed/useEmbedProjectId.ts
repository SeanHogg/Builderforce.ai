'use client';

import { useEffect, useState } from 'react';

/**
 * Resolve the project a framed PM surface should scope to, accepting BOTH forms:
 *
 *  - `?project=<id>`     — the query form the PM surfaces (PmScopeProvider) read.
 *  - `#projectId=<id>`   — the URL-HASH form the VS Code extension emits
 *                          (extension `projectHash()` → EmbedPanel appends `#…`).
 *
 * The VS Code "Open Board / Open Page…" deep-link passes the selected project as a
 * hash fragment, but the embed PM surfaces only ever read the query param, so a
 * project-scoped open from VS Code silently fell back to portfolio/all. This hook
 * reads the hash too and returns a numeric project id (query wins when both are
 * present), suitable to pass straight into `<PmScopeProvider projectId={…}>`.
 *
 * Returns `null` when neither form carries a valid positive integer (portfolio).
 * The hash is read in an effect (it is not part of the server-rendered URL and is
 * unavailable during SSR) and updates live on `hashchange`.
 */
export function useEmbedProjectId(): number | null {
  // Seed from the query param synchronously where possible (it is in the
  // server-rendered URL); the hash is layered in on mount + hashchange.
  const [projectId, setProjectId] = useState<number | null>(() => readQueryProject());

  useEffect(() => {
    const resolve = () => {
      const fromQuery = readQueryProject();
      const fromHash = readHashProject();
      setProjectId(fromQuery ?? fromHash);
    };
    resolve();
    window.addEventListener('hashchange', resolve);
    return () => window.removeEventListener('hashchange', resolve);
  }, []);

  return projectId;
}

/** `?project=<id>` → positive int, else null. */
function readQueryProject(): number | null {
  if (typeof window === 'undefined') return null;
  return projectFromQuery(window.location.search);
}

/** `#projectId=<id>` (the VS Code extension form) → positive int, else null. */
function readHashProject(): number | null {
  if (typeof window === 'undefined') return null;
  return projectFromHash(window.location.hash);
}

/** Pure: extract `project` from a query string (`?project=<id>` or `project=<id>`). */
export function projectFromQuery(search: string): number | null {
  return toPositiveInt(new URLSearchParams(search.replace(/^\?/, '')).get('project'));
}

/** Pure: extract `projectId` from a URL hash (`#projectId=<id>` — the extension form). */
export function projectFromHash(hash: string): number | null {
  // The hash is a `&`-joined param list (the extension emits `projectId=<id>`).
  return toPositiveInt(new URLSearchParams(hash.replace(/^#/, '')).get('projectId'));
}

/** Pure: query wins over hash; either may be a query/hash string. */
export function resolveEmbedProjectId(search: string, hash: string): number | null {
  return projectFromQuery(search) ?? projectFromHash(hash);
}

function toPositiveInt(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
