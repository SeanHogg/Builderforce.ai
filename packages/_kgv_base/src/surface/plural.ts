/**
 * ONE way to say a count: every counted sentence is a `${word}One` / `${word}Other` pair in the catalog's `counts`
 * (labels/surface.map.ts), and `counted()` picks the pair's half by the number and fills `{count}` (plus the sentence's
 * own params). No other code pluralises, so no row reads "1 files".
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { CountedWord } from '../labels/surface.map';

export type { CountedWord };

/** `en`-style plural selection: the singular only for exactly 1 (a language with no plural form repeats the one in its catalog). */
export const isOne = (n: number): boolean => n === 1;

/** `params.count` may override the shown number (e.g. a locale-formatted "15,994"); `n` still picks the form. */
export function counted(labels: KnowledgeGraphLabels, word: CountedWord, n: number, params: Record<string, string | number | undefined> = {}): string {
    const c = labels.surface.counts;
    return fillTemplate(isOne(n) ? c[`${word}One`] : c[`${word}Other`], { count: n, ...params });
}
