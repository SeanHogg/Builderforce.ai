/**
 * Which files of a repository the map reads — bf-index `walk.rs`'s deny-lists (the
 * generated trees that are often NOT gitignored in a monorepo's nested packages), plus
 * the caps a source WITHOUT a disk needs (a Worker reading a tarball into memory).
 * Data, not branches: a new skip is a row.
 */
import { isMapSource } from './extract.js';
/** Directory names never descended into (bf-index `SKIP_DIRS`). */
export const SKIP_DIRS = new Set([
    '.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next', '.turbo', '.cache', 'coverage',
    'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode-test',
]);
/** File names never read (bf-index `SKIP_FILES`). */
export const SKIP_FILES = new Set([
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'bun.lockb',
]);
/** File-name suffixes that are generated output, not source (bf-index's two). */
const SKIP_SUFFIXES = ['.min.js', '.map'];
export const DEFAULT_REPO_MAP_LIMITS = {
    maxFileBytes: 256 * 1024,
    maxFiles: 6_000,
    maxTotalBytes: 24 * 1024 * 1024,
};
/**
 * Whether the map reads `path` (repo-relative, `/`-separated) at `size` bytes. Hidden
 * directories are skipped except `.github`, as bf-index does.
 */
export function isMapCandidate(path, size, limits = DEFAULT_REPO_MAP_LIMITS) {
    if (size > limits.maxFileBytes)
        return false;
    const segments = path.split('/');
    const name = segments[segments.length - 1] ?? '';
    for (const dir of segments.slice(0, -1)) {
        if (SKIP_DIRS.has(dir) || (dir.startsWith('.') && dir.length > 1 && dir !== '.github'))
            return false;
    }
    if (SKIP_FILES.has(name) || SKIP_SUFFIXES.some((s) => name.endsWith(s)))
        return false;
    return isMapSource(path);
}
//# sourceMappingURL=filePolicy.js.map