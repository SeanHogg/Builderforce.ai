/**
 * WHAT A REVIEW OF THIS KIND OF THING ASKS ABOUT — the axes, as data.
 *
 * ── WHY A REGISTRY AND NOT SIX COLUMNS ──────────────────────────────────────
 * The gap-register entry that specified this feature argued for six `smallint`
 * columns on the grounds that "six stable named axes are attributes, not a
 * repeating group". That is the right instinct and the wrong conclusion here,
 * because the axes are stable only WITHIN a subject kind: an employer is rated on
 * culture and work-life balance, a marketplace service on quality and value, a
 * voice clone on likeness. The source product knew this — its
 * `subject-descriptors.ts` was exactly this registry — and its `sub_ratings`
 * column was jsonb for exactly this reason.
 *
 * Six columns on `annotations` would therefore be six columns that are null for
 * every annotation that is not an employer review, which is nearly all of them,
 * and a seventh subject kind would want its own six. So the axes live in
 * `anchor.subRatings`, validated against THIS registry — and adding a reviewable
 * kind adds a row here, never a migration.
 *
 * ── ONE LIST, THREE CONSUMERS ────────────────────────────────────────────────
 * The submit path validates against it, the API hands it to the browser, and the
 * form renders from what it was handed. A second copy in the frontend is how a
 * form comes to collect an axis the server then silently drops.
 */

/** An axis is identified by a stable key; the LABEL is a translation key the
 *  browser resolves, never English stored on the server. */
export interface ReviewAxis {
  key: string;
  /** Suffix under the `employers.axis.*` namespace in the message catalogues. */
  labelKey: string;
}

/**
 * The employer axes, exactly as the ported articles describe them:
 * culture, leadership, work-life balance, compensation, career growth, and
 * diversity & inclusion.
 */
export const EMPLOYER_AXES: readonly ReviewAxis[] = [
  { key: 'culture', labelKey: 'culture' },
  { key: 'leadership', labelKey: 'leadership' },
  { key: 'work_life_balance', labelKey: 'workLifeBalance' },
  { key: 'compensation', labelKey: 'compensation' },
  { key: 'career_growth', labelKey: 'careerGrowth' },
  { key: 'diversity_inclusion', labelKey: 'diversityInclusion' },
];

/** Which axes apply to which registered object kind. A kind that is absent is
 *  reviewable with a headline score and no axes, which is a legitimate shape —
 *  not every subject deserves six sliders. */
const AXES_BY_KIND: Readonly<Record<string, readonly ReviewAxis[]>> = {
  company: EMPLOYER_AXES,
};

export function axesFor(objectKind: string): readonly ReviewAxis[] {
  return AXES_BY_KIND[objectKind] ?? [];
}

/**
 * Keep only the axes this subject actually has.
 *
 * An unknown key is DROPPED rather than stored: `anchor` is jsonb, so without
 * this a client could write arbitrary keys into it and they would render on the
 * next form that trusted the payload. Scores are bounds-checked by
 * `submitReview`; this is the vocabulary half of the same validation.
 */
export function keepKnownAxes(
  objectKind: string, submitted: Record<string, number> | undefined,
): Record<string, number> {
  if (!submitted) return {};
  const allowed = new Set(axesFor(objectKind).map((axis) => axis.key));
  return Object.fromEntries(Object.entries(submitted).filter(([key]) => allowed.has(key)));
}
