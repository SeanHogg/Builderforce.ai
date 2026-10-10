/**
 * "WHICH PROJECT?" — answered by ONE function, on every surface.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The question had five answers. The app shell's `ProjectScopeProvider` read the
 * URL then localStorage; `PmScopeProvider` read its prop then the shell; the
 * mountable components read a pin, then the embed deep-link, then the shell; the
 * embed hook parsed `?project=` and `#projectId=`; and the tool runner parsed
 * `?project=` / `?projectId=` itself. Each had its own order, so the same screen
 * could scope two widgets to two projects — and none of them knew the VS Code
 * editor has a project selection of its own, which is why the canvas could not be
 * drawn there at all.
 *
 * Now every source is named here and ranked once. Callers only COLLECT the sources
 * their surface has; they never decide the order.
 *
 * Null means portfolio — every project the tenant owns — and that is a real answer,
 * not a missing one. Tenancy is never resolved here: it rides on the caller's token.
 */

/** Every place a project selection can come from. Absent (`undefined`) = this surface has no such source. */
export interface ProjectScopeSources {
  /**
   * The MOUNT knows — a board card's own project link, an explicit scope provider.
   * Wins over everything ambient. `null` pins to the portfolio.
   */
  pinned?: number | null;
  /**
   * The HOST owns the selection — the VS Code sidebar's active project. When a host
   * owns it, the person changes it there, so nothing in the page may outrank it.
   */
  host?: number | null;
  /** A deep-link in the URL: `?project=`, legacy `?projectId=`, or the editor's `#projectId=`. */
  location?: number | null;
  /** The person's own pick in this page — in-session, or persisted per tenant. */
  selected?: number | null;
}

/** THE resolution order: pinned → host → location → selected → portfolio. */
export function resolveProjectId(sources: ProjectScopeSources): number | null {
  if (sources.pinned !== undefined) return sources.pinned;
  if (sources.host !== undefined) return sources.host;
  return sources.location ?? sources.selected ?? null;
}

/** A positive integer project id, or null. */
export function toProjectId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * The project a URL deep-links to. Every spelling in circulation, in one place:
 * `?project=` (the shell's own), `?projectId=` (older links), and `#projectId=`
 * (what the VS Code extension appends to a framed page). Query wins over hash.
 */
export function projectFromLocation(search: string, hash = ''): number | null {
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  return (
    toProjectId(query.get('project')) ??
    toProjectId(query.get('projectId')) ??
    toProjectId(new URLSearchParams(hash.replace(/^#/, '')).get('projectId'))
  );
}

/** {@link projectFromLocation} for the live window; null on the server. */
export function readLocationProject(): number | null {
  if (typeof window === 'undefined') return null;
  return projectFromLocation(window.location.search, window.location.hash);
}
