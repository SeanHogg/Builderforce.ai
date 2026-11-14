/**
 * The uncommitted-work DOMAIN: what a pending change is, and how the two things git
 * can tell us about one — the Git extension's numeric `Status`, and `git status
 * --porcelain` text — become the same shape.
 *
 * Host-free on purpose (no `vscode` import), for two reasons: it is the piece worth
 * unit-testing without an extension host, and the shape has to cross the webview
 * bridge into the React chat, which cannot import editor APIs. The cached read port
 * that actually talks to git lives in {@link gitChanges}; the surfaces that render
 * this live in `pendingChangesTree.ts` and the webview's `usePendingChangesExtension`
 * (the ticket rail's "Changes (N)" pill + the shared brain-ui `PendingChangesList`).
 */
/**
 * `Status` from the Git extension API, as the numeric enum it actually is on the
 * wire. Declared here rather than imported because the Git extension publishes no
 * types, and kept beside {@link statusKindOf} — the only thing that reads it.
 */
export const GIT_STATUS = {
    INDEX_MODIFIED: 0,
    INDEX_ADDED: 1,
    INDEX_DELETED: 2,
    INDEX_RENAMED: 3,
    INDEX_COPIED: 4,
    MODIFIED: 5,
    DELETED: 6,
    UNTRACKED: 7,
    IGNORED: 8,
    INTENT_TO_ADD: 9,
    INTENT_TO_RENAME: 10,
    TYPE_CHANGED: 11,
    ADDED_BY_US: 12,
    ADDED_BY_THEM: 13,
    DELETED_BY_US: 14,
    DELETED_BY_THEM: 15,
    BOTH_ADDED: 16,
    BOTH_DELETED: 17,
    BOTH_MODIFIED: 18,
};
export const EMPTY_CHANGE_SET = { total: 0, repos: [] };
/** Normalize for path containment comparison (Windows casing + separators). */
export function normalizePath(p) {
    return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
/** True when `folder` is at or beneath `repoRoot`. */
export function contains(repoRoot, folder) {
    const a = normalizePath(repoRoot);
    const b = normalizePath(folder);
    return b === a || b.startsWith(`${a}/`);
}
/** Repo-relative POSIX path for an absolute file path under `root`. */
export function relativeTo(root, filePath) {
    const posix = filePath.replace(/\\/g, "/");
    const base = normalizePath(root);
    return posix.toLowerCase().startsWith(`${base}/`) ? posix.slice(base.length + 1) : posix;
}
/** Folder name of a repository root — the label a user recognises. */
export function repoName(root) {
    const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/);
    return parts[parts.length - 1] || root;
}
/** Map the Git extension's numeric `Status` to our vocabulary. */
export function statusKindOf(status) {
    switch (status) {
        case GIT_STATUS.INDEX_ADDED:
        case GIT_STATUS.INDEX_COPIED:
        case GIT_STATUS.INTENT_TO_ADD:
            return "added";
        case GIT_STATUS.INDEX_DELETED:
        case GIT_STATUS.DELETED:
            return "deleted";
        case GIT_STATUS.INDEX_RENAMED:
        case GIT_STATUS.INTENT_TO_RENAME:
            return "renamed";
        case GIT_STATUS.UNTRACKED:
            return "untracked";
        case GIT_STATUS.TYPE_CHANGED:
            return "typechange";
        case GIT_STATUS.ADDED_BY_US:
        case GIT_STATUS.ADDED_BY_THEM:
        case GIT_STATUS.DELETED_BY_US:
        case GIT_STATUS.DELETED_BY_THEM:
        case GIT_STATUS.BOTH_ADDED:
        case GIT_STATUS.BOTH_DELETED:
        case GIT_STATUS.BOTH_MODIFIED:
            return "conflict";
        default:
            return "modified";
    }
}
/**
 * One row per FILE. A file staged and then edited again appears in both the index and
 * the working tree; the SCM view shows it twice on purpose (two diffs), but a
 * "N changes pending review" count that double-counts it is simply wrong. First
 * occurrence wins for `status`; `staged` is the OR across occurrences.
 */
export function dedupeChanges(changes) {
    const byPath = new Map();
    for (const change of changes) {
        const key = normalizePath(change.path);
        const existing = byPath.get(key);
        if (existing)
            existing.staged = existing.staged || change.staged;
        else
            byPath.set(key, { ...change });
    }
    return [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
/** Porcelain status letter to our vocabulary. */
function letterStatus(letter) {
    switch (letter) {
        case "A":
        case "C":
            return "added";
        case "D":
            return "deleted";
        case "R":
            return "renamed";
        case "T":
            return "typechange";
        case "?":
            return "untracked";
        default:
            return "modified";
    }
}
/** Undo git's C-style quoting of paths containing spaces or control characters. */
export function unquotePath(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith('"') || !trimmed.endsWith('"') || trimmed.length < 2)
        return trimmed;
    return trimmed
        .slice(1, -1)
        .replace(/\\([\\"nrt])/g, (_all, ch) => ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch);
}
/**
 * Parse `git status --porcelain=v1 --untracked-files=all` for `repoRoot`.
 *
 * Line shape is `XY <path>` (or `XY <orig> -> <path>` for a rename), where X is the
 * index status and Y the working-tree status. Unmerged pairs (`UU`, `AA`, `DD`, ...)
 * are conflicts, `??` is untracked; otherwise the working-tree letter wins for
 * DISPLAY (that is the edit the user has not staged) and a non-blank index letter
 * sets `staged`.
 */
export function parsePorcelain(output, repoRoot) {
    const changes = [];
    for (const rawLine of output.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        if (line.length < 4)
            continue;
        const index = line[0];
        const worktree = line[1];
        let file = line.slice(3);
        // A rename reports both names; the current one is on the right of the arrow.
        const arrow = file.indexOf(" -> ");
        if (arrow >= 0)
            file = file.slice(arrow + 4);
        file = unquotePath(file);
        if (!file)
            continue;
        const pair = `${index}${worktree}`;
        const conflict = pair === "DD" || pair === "AA" || index === "U" || worktree === "U";
        const status = conflict
            ? "conflict"
            : pair === "??"
                ? "untracked"
                : letterStatus(worktree !== " " && worktree !== "?" ? worktree : index);
        changes.push({
            path: `${repoRoot.replace(/[\\/]+$/, "")}/${file}`,
            relativePath: file,
            repoRoot,
            status,
            staged: !conflict && index !== " " && index !== "?",
        });
    }
    return dedupeChanges(changes);
}
/** Every uncommitted file the Git extension reports for one repository. */
export function collectRepoChanges(repo) {
    const root = repo.rootUri.fsPath;
    const state = repo.state;
    const map = (list, staged) => (list ?? []).map((change) => ({
        path: change.uri.fsPath,
        relativePath: relativeTo(root, change.uri.fsPath),
        repoRoot: root,
        status: statusKindOf(change.status),
        staged,
    }));
    return dedupeChanges([
        ...map(state.mergeChanges, false),
        ...map(state.workingTreeChanges, false),
        ...map(state.untrackedChanges, false),
        ...map(state.indexChanges, true),
    ]);
}
/** Fold per-repository lists into the workspace set, dropping clean repositories. */
export function toChangeSet(repos) {
    const nonEmpty = repos.filter((r) => r.changes.length > 0);
    return { total: nonEmpty.reduce((n, r) => n + r.changes.length, 0), repos: nonEmpty };
}
//# sourceMappingURL=gitChangeModel.js.map