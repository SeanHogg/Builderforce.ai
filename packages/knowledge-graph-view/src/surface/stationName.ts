/**
 * The ONE name a station (and a line) is shown under. An area's label is a whole repo path
 * ("Builderforce.ai/clients/vscode/src"), far too long for a map label. A station reads as at
 * most its last two path segments once the directory every station shares is stripped
 * ("clients/vscode/src" -> "vscode/src"). Two stations that would read the same grow one segment
 * at a time until they differ. The full path stays on `Station.path` for tooltips and
 * aria-labels. A line is named after its package: the first distinctive segment.
 */

/** The name of the one station that holds a repo's top-level non-code files (LICENSE, Dockerfile, dotfiles, root docs). */
export const REPO_CONFIG_NAME = 'repo config';

/** Joins an entry station's "group › file" name: only the group is a path. */
const ENTRY_SEPARATOR = ' › ';
const MAX_SEGMENTS = 2;

/** Folders that only contain packages: they never name a line. */
const CONTAINERS: ReadonlySet<string> = new Set(['src', 'lib', 'app', 'apps', 'dist', 'source', 'sources', 'main', 'index', 'internal', 'pkg', 'packages', 'clients', 'services', 'modules', 'libs']);

const segmentsOf = (path: string): string[] => path.split('/').filter((s) => s !== '');

/** A top-level file that is configuration, not content (dotfiles, LICENSE, Dockerfile, CODEOWNERS, root yaml/toml). Root *.md stay: they may be the reviewed documents. */
export function isRepoConfigFile(name: string): boolean {
    if (name.includes('/')) return false;
    return name.startsWith('.') || /^(license|licence|dockerfile|codeowners|makefile|notice|changelog)(\..*)?$/i.test(name) || /\.(ya?ml|toml|lock)$/i.test(name);
}

function headOf(full: string): { head: string; tail: string } {
    const at = full.indexOf(ENTRY_SEPARATOR);
    return at >= 0 ? { head: full.slice(0, at), tail: full.slice(at) } : { head: full, tail: '' };
}

/** How many leading segments every path shares (never the last one of any path). */
function sharedPrefix(heads: readonly string[][]): number {
    if (heads.length < 2) return 0;
    const limit = Math.min(...heads.map((h) => h.length - 1));
    let n = 0;
    while (n < limit && heads.every((h) => h[n] === heads[0]![n])) n += 1;
    return n;
}

function render(segments: readonly string[], skip: number, extra: number): string {
    const rest = segments.slice(skip);
    return rest.slice(-Math.min(rest.length, MAX_SEGMENTS + extra)).join('/');
}

/** One name on its own (nothing shared to strip, nothing to tell it from). */
export const stationName = (full: string): string => stationNames([full])[0]!;

/** The short names of a list of full names, index for index. */
export function stationNames(fulls: readonly string[]): string[] {
    const parts = fulls.map(headOf);
    const segs = parts.map((p) => segmentsOf(p.head));
    // Names that are not paths ("(root)", "repo config") neither share a prefix nor get cut.
    const pathy = segs.map((s) => s.length > 1);
    const skip = sharedPrefix(segs.filter((_, i) => pathy[i]));
    const extra = fulls.map(() => 0);
    const name = (i: number): string => (pathy[i] ? render(segs[i]!, skip, extra[i]!) : parts[i]!.head) + parts[i]!.tail;
    const names = fulls.map((_, i) => name(i));
    for (let round = 0; round < 8; round += 1) {
        const seen = new Map<string, number[]>();
        names.forEach((n, i) => (seen.get(n) ?? seen.set(n, []).get(n)!).push(i));
        let widened = false;
        for (const at of seen.values()) {
            if (at.length < 2) continue;
            for (const i of at) {
                if (!pathy[i]) continue;
                extra[i] = extra[i]! + 1;
                const next = name(i);
                if (next !== names[i]) { names[i] = next; widened = true; }
            }
        }
        if (!widened) break;
    }
    return names;
}

/** The package a path belongs to: its first segment that is not a plain container ("clients/vscode/src" -> "vscode"). */
export function packageNameOf(full: string): string {
    const segments = segmentsOf(headOf(full).head);
    return segments.find((s) => !CONTAINERS.has(s.toLowerCase())) ?? segments[segments.length - 1] ?? full;
}

/** Fits `name` in `max` characters keeping its END, which is what tells names apart: "…/vscode/src". */
export function clipName(name: string, max: number): string {
    if (name.length <= max) return name;
    const tail = name.slice(-(max - 2));
    const slash = tail.indexOf('/');
    return `…/${slash >= 0 && slash < tail.length - 1 ? tail.slice(slash + 1) : tail}`;
}
