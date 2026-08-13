/**
 * Reading levels, as data.
 *
 * A board is written at whatever register the model reached for, which is a
 * problem the moment the reader is not the author: the same lab report has to
 * be readable by the person who wrote it, the classmate it is being explained
 * to, and the adult marking it. The levels are declared once here so the control
 * that offers them and the request that carries them cannot drift, and adding a
 * level is a row rather than a branch.
 *
 * `audience` is model-facing English (it goes into a prompt, not onto a screen);
 * the visible label is `creationCanvas.readingLevel.<id>` in the catalogs.
 */

export const READING_LEVELS = [
  { id: 'simple', audience: 'a 10-year-old — short sentences, everyday words, one idea per sentence' },
  { id: 'standard', audience: 'a 13-year-old — plain language, technical terms explained the first time they appear' },
  { id: 'advanced', audience: 'a well-read adult — precise, technical, no simplification' },
] as const;

export type ReadingLevelId = (typeof READING_LEVELS)[number]['id'];

export function readingLevel(id: string): (typeof READING_LEVELS)[number] {
  return READING_LEVELS.find((level) => level.id === id) ?? READING_LEVELS[1];
}

/**
 * The one phrasing of "say this again, at this level".
 *
 * Meaning-preserving by construction: the instruction names what must survive
 * (every fact, number, name and citation) because a rewrite that quietly drops
 * the third paragraph is indistinguishable from one that simplified it, and the
 * learner reading the result is the person least able to notice.
 */
export function relevelRequest(title: string, kind: string, levelId: string): string {
  const level = readingLevel(levelId);
  return `Rewrite the ${kind} "${title}" that is on this canvas so it reads for ${level.audience}. `
    + 'Keep every fact, number, name, formula and citation exactly as it is — this is a rewrite, not a summary, '
    + 'and nothing may be dropped. Keep the headings and the order of the material. '
    + `Update the object in place with canvas_update_object; do not create a second copy.`;
}
