/**
 * knowledge/graphIgnore.ts — the ignore rules a review applies, for the repo graph (PRD 41 A9).
 *
 * `planReview` drops what `.gitignore` / `.builderforce/ignore` exclude; the repo graph lists the
 * tree itself, so it applies the SAME matcher (`ignoreMatcher`, memory's) or an excluded file
 * would re-enter the map as a file node. The listing skips dot-folders, so `.builderforce/ignore`
 * is read directly. Paths are relative to the reviewed folder, as the rules are.
 */

import { ignoreMatcher, ignoreSourcesOf } from '@seanhogg/builderforce-memory/knowledge';
import type { RepoReadCapability } from '../capabilities.js';

/** A test that is true for a root-relative path the review's ignore rules exclude. `prefix` is the reviewed folder inside the workspace ('' = the workspace). */
export async function reviewIgnore(
    read: Pick<RepoReadCapability, 'readFile'>,
    prefix: string,
    rootRelativePaths: readonly string[],
): Promise<(path: string) => boolean> {
    const texts: Array<{ text: string; base: string }> = [];
    for (const { path, base } of ignoreSourcesOf([...rootRelativePaths, '.builderforce/ignore'])) {
        const file = await read.readFile(prefix ? `${prefix}/${path}` : path).catch(() => undefined);
        if (file?.ok && typeof file.content === 'string') texts.push({ text: file.content, base });
    }
    return ignoreMatcher(texts);
}
