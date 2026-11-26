/**
 * A repository identity as a reader names it (PRD 41 §C11): its last path segment, without a trailing `.git` or slash.
 * `https://github.com/acme/api.git` → `api`, `C:\work\web\` → `web`, `local:3f2a…` → `3f2a…`. ONE spelling for every
 * surface that labels a run's repository: the chat card, the web card and the history rows.
 */
export function repoDisplayName(repo: string): string {
    return repo.replace(/[\\/]+$/, '').replace(/\.git$/, '').split(/[\\/:]/).filter(Boolean).pop() ?? repo;
}
