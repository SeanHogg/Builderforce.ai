/**
 * THE TRANSLATOR SEAM — how a plain module says something to a person.
 *
 * A use case is not a React component and must not become one, so it cannot call
 * `useTranslations` itself. It takes a translator instead: the surface builds one
 * from the catalogs and passes it in, and the English text lives in `en.json`
 * with its four translations and NOWHERE else — no module-level default to drift
 * from them.
 *
 * ── WHY IT IS DECLARED HERE ──────────────────────────────────────────────────
 * This exact shape was invented twice already — `ImportTranslator` in
 * `application/ImportCanvasFile.ts` and `CanvasNoticeTranslator` in `lib/canvasNotices.ts`
 * — because both modules hit the same problem and neither had a place to put the
 * answer. It belongs to the canvas context, so it is declared once here and both
 * of those become aliases. A third copy is what the DRY rule exists to stop.
 *
 * It is deliberately the NARROWEST slice of next-intl's translator that these
 * modules use: a key and some values in, a string out. Anything wider would let a
 * plain module reach for `t.rich` or `t.markup`, which return React nodes and
 * would drag the framework back across the seam this type exists to hold.
 */
export type CanvasTextTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * Formatting a NUMBER is a locale decision too, and a separate one.
 *
 * `useFormat()` is a hook, so a use case takes the one function it needs rather
 * than the formatter object — the same argument as the translator, and it keeps
 * the dependency honest about how little is actually used.
 */
export type CanvasNumberFormat = (value: number) => string;
