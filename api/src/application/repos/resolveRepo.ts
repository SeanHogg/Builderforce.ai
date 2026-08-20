/**
 * Pure repo-resolution logic for multi-repo task associations.
 *
 * Given a task and the set of repositories associated with its project, decide
 * WHICH repo an agent should target. No IO — the caller loads repos/tasks and
 * passes plain data in. This keeps the precedence rules deterministic and
 * heavily unit-testable.
 *
 * Precedence (highest wins):
 *   1. explicit   — task.explicitRepoId names a known repo
 *   2. inferred   — task labels / description keywords / path globs match a
 *                   repo's matchHints
 *   3. default    — the repo flagged isDefault
 *
 * Fail-closed: if nothing matches (and there is no default), OR an inference is
 * ambiguous (two+ distinct repos match by hints and none is otherwise
 * preferred), return null so the caller can refuse to dispatch rather than
 * guess.
 */

export type ResolveRepoTask = {
  labels?: string[];
  description?: string;
  explicitRepoId?: string;
};

export type ResolveRepoCandidate = {
  id: string;
  isDefault?: boolean;
  /** JSON string: { labels?: string[]; keywords?: string[]; pathGlobs?: string[] } */
  matchHints?: string | null;
};

export type ResolveMethod = 'explicit' | 'inferred' | 'default';

export type ResolveRepoResult = {
  repoId: string;
  method: ResolveMethod;
};

type ParsedHints = {
  labels: string[];
  keywords: string[];
  pathGlobs: string[];
};

/** Parse a repo's matchHints JSON column into normalized lower-cased arrays. */
export function parseMatchHints(raw: string | null | undefined): ParsedHints {
  const empty: ParsedHints = { labels: [], keywords: [], pathGlobs: [] };
  if (!raw || !raw.trim()) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;

  const rec = parsed as Record<string, unknown>;
  return {
    labels: toStringArray(rec.labels).map((s) => s.toLowerCase()),
    keywords: toStringArray(rec.keywords).map((s) => s.toLowerCase()),
    pathGlobs: toStringArray(rec.pathGlobs),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

/**
 * Translate a glob (supporting `*` and `**`) into a RegExp matched against a
 * lower-cased haystack. `**` matches across path separators; `*` does not.
 */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp(out, 'i');
}

/** Does a single candidate's hints match the task at all? */
function candidateMatchesHints(task: ResolveRepoTask, hints: ParsedHints): boolean {
  const taskLabels = (task.labels ?? []).map((l) => l.toLowerCase());
  for (const hl of hints.labels) {
    if (taskLabels.includes(hl)) return true;
  }

  const description = (task.description ?? '').toLowerCase();
  if (description) {
    for (const kw of hints.keywords) {
      if (description.includes(kw)) return true;
    }
    for (const glob of hints.pathGlobs) {
      if (globToRegExp(glob).test(description)) return true;
    }
  }

  return false;
}

/**
 * Resolve the target repo for a task. Returns null when no decision can be made
 * safely (no match + no default, or an ambiguous inference).
 */
export function resolveRepoForTask(
  task: ResolveRepoTask,
  repos: ResolveRepoCandidate[],
): ResolveRepoResult | null {
  if (!Array.isArray(repos) || repos.length === 0) return null;

  // 1. explicit — only honored if it names a real candidate.
  const explicitId = task.explicitRepoId?.trim();
  if (explicitId) {
    const match = repos.find((r) => r.id === explicitId);
    if (match) return { repoId: match.id, method: 'explicit' };
    // An explicit-but-unknown repo id is a fail-closed condition: the caller
    // asked for something we do not have an association for.
    return null;
  }

  // 2. inferred — match by hints. Ambiguity (2+ distinct repos) fails closed.
  const inferred = repos.filter((r) => candidateMatchesHints(task, parseMatchHints(r.matchHints)));
  const distinctInferred = dedupeById(inferred);
  if (distinctInferred.length === 1) {
    return { repoId: distinctInferred[0]!.id, method: 'inferred' };
  }
  if (distinctInferred.length > 1) {
    // Ambiguous: if exactly one of the matches is also the default, prefer it;
    // otherwise refuse to guess.
    const defaults = distinctInferred.filter((r) => r.isDefault === true);
    if (defaults.length === 1) {
      return { repoId: defaults[0]!.id, method: 'inferred' };
    }
    return null;
  }

  // 3. default — single isDefault repo wins. Multiple defaults are ambiguous.
  const defaults = repos.filter((r) => r.isDefault === true);
  const distinctDefaults = dedupeById(defaults);
  if (distinctDefaults.length === 1) {
    return { repoId: distinctDefaults[0]!.id, method: 'default' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Multi-repo spanning (0956): route ONE file path to ONE repo in a task's set
// ---------------------------------------------------------------------------

/** A repo in a task's bound SET, as seen by the pure write router. */
export type RepoSetCandidate = {
  id: string;
  /** The task's primary repo — the fallback when no glob claims the path. */
  isPrimary?: boolean;
  /** JSON string: { labels?, keywords?, pathGlobs? }. Per-task override first,
   *  else the repo's own project-wide hints — the caller decides which. */
  matchHints?: string | null;
};

export type RouteWriteMethod = 'glob' | 'primary';

export type RouteWriteResult = {
  repoId: string;
  method: RouteWriteMethod;
  /** The glob that claimed the path (only when method === 'glob'). */
  glob?: string;
};

/**
 * Route one FILE PATH to the repo that should receive it.
 *
 * Distinct from {@link resolveRepoForTask}, which answers "which repo is this
 * TASK about" from its title/labels. This answers "which repo does THIS write
 * belong in", and is therefore matched against a path, not prose — `pathGlobs`
 * is the only hint kind that can decide it (labels/keywords describe a ticket,
 * not a file).
 *
 * Deterministic and total:
 *   • most SPECIFIC glob wins (longest literal, i.e. wildcard-stripped, length),
 *     so `frontend/src/**` beats `**` and two repos can share a prefix;
 *   • ties break toward the primary, then by repo id, so the same path always
 *     lands in the same repo across runs;
 *   • no match ⇒ the primary repo. A write is never dropped for want of a hint.
 */
export function routeWritePathToRepo(
  path: string,
  repos: RepoSetCandidate[],
): RouteWriteResult | null {
  if (!Array.isArray(repos) || repos.length === 0) return null;
  const primary = repos.find((r) => r.isPrimary === true) ?? repos[0]!;

  const normalized = (path ?? '').trim().replace(/^\.?\//, '');
  if (!normalized) return { repoId: primary.id, method: 'primary' };

  let best: { repo: RepoSetCandidate; glob: string; specificity: number } | null = null;
  for (const repo of repos) {
    for (const glob of parseMatchHints(repo.matchHints).pathGlobs) {
      if (!pathGlobMatches(glob, normalized)) continue;
      const specificity = glob.replace(/\*/g, '').length;
      if (
        !best ||
        specificity > best.specificity ||
        (specificity === best.specificity && preferOver(repo, best.repo))
      ) {
        best = { repo, glob, specificity };
      }
    }
  }

  return best
    ? { repoId: best.repo.id, method: 'glob', glob: best.glob }
    : { repoId: primary.id, method: 'primary' };
}

/** Stable tie-break: the primary wins, otherwise the lower id — never coin-flip. */
function preferOver(candidate: RepoSetCandidate, incumbent: RepoSetCandidate): boolean {
  if (candidate.isPrimary === incumbent.isPrimary) return candidate.id < incumbent.id;
  return candidate.isPrimary === true;
}

/**
 * Does a path glob claim this path? WHOLE-path match, not the substring match
 * {@link candidateMatchesHints} does against prose — otherwise `api/**` would
 * claim `frontend/api/x.ts`.
 *
 * Two authoring shapes are honored, because both are what people mean:
 *   • a directory glob (`api/**`, `packages/*​/src/**`) anchors at the root;
 *   • a bare suffix glob (`*.md`) matches at ANY depth — "*.md goes to the docs
 *     repo" plainly includes `docs/guide/intro.md`.
 * A trailing `/` or a bare directory name (`api`) is treated as `api/**`, since
 * a directory can never itself be a written file path.
 */
export function pathGlobMatches(glob: string, path: string): boolean {
  let g = glob.trim().replace(/^\.?\//, '');
  if (!g) return false;
  if (g.endsWith('/')) g = `${g}**`;
  else if (!g.includes('*') && !g.includes('.')) g = `${g}/**`;
  const matches = (candidate: string): boolean =>
    new RegExp(`^(?:${globToRegExp(candidate).source})$`, 'i').test(path);
  // A bare suffix glob is depth-free: `*.md` must claim BOTH `README.md` and
  // `docs/intro.md`, so try it at the root and at any depth.
  if (g.startsWith('*') && !g.startsWith('**/')) return matches(g) || matches(`**/${g}`);
  return matches(g);
}

function dedupeById(items: ResolveRepoCandidate[]): ResolveRepoCandidate[] {
  const seen = new Set<string>();
  const out: ResolveRepoCandidate[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
