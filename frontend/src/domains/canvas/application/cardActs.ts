/**
 * THE CARD ACT REGISTRY — every act the board can run, as one list.
 *
 * This is the composition root for {@link runCardAct}, and the reason the canvas
 * dispatch is a lookup rather than a chain of `else if (kind === … && action ===
 * …)`. Each context contributes its own acts and NAMES them; nothing here knows
 * what an invoice or a rubric is.
 *
 * ── WHY THE LIST LIVES IN THE CANVAS AND THE ACTS DO NOT ─────────────────────
 * The canvas is the only place that knows the whole set — it is the surface every
 * one of these cards is drawn on. Putting the list in any single context would
 * make that context depend on the other four; putting it here keeps every edge
 * pointing at the canvas, which is the shape the context map already describes.
 *
 * Adding an act is a line in one of the context files plus its entry in that
 * file's exported array. It is not an edit to the dispatch, and that is the whole
 * point: the branch that used to be forgotten is the branch that no longer exists.
 */

import { CEREMONY_CARD_ACTS } from '@/domains/ceremony/application/ceremonyActs';
import { FOUNDER_OPS_CARD_ACTS } from '@/domains/finance/application/founderOpsActs';
import { HIRING_CARD_ACTS } from '@/domains/hiring/application/employmentHandover';
import { TEACHING_CARD_ACTS } from '@/domains/teaching/application/academicActs';
import type { CardAct } from './CardAct';

export const CARD_ACTS: readonly CardAct[] = [
  ...CEREMONY_CARD_ACTS,
  ...FOUNDER_OPS_CARD_ACTS,
  ...HIRING_CARD_ACTS,
  ...TEACHING_CARD_ACTS,
];
