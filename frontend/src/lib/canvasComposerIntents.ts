/**
 * COMPOSER INTENTS — what a plain line of text MEANS on the surface you are reading.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE ──────────────────────────────────────────────
 * The canvas shipped with ONE composer at the bottom of the board and, on the Ideas
 * surface, a SECOND text field of the surface's own (`IdeaCaptureForm`). Two boxes on
 * one screen, both asking for a sentence, neither saying which one the Enter key you
 * are about to press belongs to — and on a phone they cost the screen two keyboards'
 * worth of chrome for one act.
 *
 * The honest reading is that a surface never wants its own INPUT. It wants a MEANING
 * for the input that is already there: on Ideas, a line is a card; on the board, in
 * the room, inside a running app, a line is a question for Brain. That is one
 * composer with a declared verb, not two composers.
 *
 * So a surface declares which intents it OFFERS (`CanvasSurfaceDef.composerIntents`)
 * and this table says what each intent is called, what it asks for and what its send
 * button says. `CanvasComposer` draws the list as a leading segmented control — and
 * only when there are two or more, because a segmented control with one segment is a
 * label pretending to be a choice.
 *
 * ── WHY THIS IS DATA AND NOT A BRANCH ────────────────────────────────────────────
 * The same reason object KINDS and canvas SURFACES are data: the next surface that
 * wants a verb ("log a decision", "add a step") is an entry here plus an id in its
 * registry row, never a `surface === 'ideas'` fork in the composer. Nothing in this
 * module imports React, so the registry can be read by tests, by the surface registry
 * and by the component without dragging a tree behind it.
 *
 * ── ADDING AN INTENT ─────────────────────────────────────────────────────────────
 *   1. an entry in `CANVAS_COMPOSER_INTENTS` below,
 *   2. `creationCanvas.composerIntent.<id>.{label,placeholder,submit}` in ALL FIVE
 *      catalogs,
 *   3. the id in the `composerIntents` of every surface that offers it, and a
 *      handler on `CanvasComposer` for what Enter then does.
 */

import type { Stage } from './navGroups';

export type CanvasComposerIntentId = 'ask' | 'captureIdea';

export interface CanvasComposerIntentDef {
  id: CanvasComposerIntentId;
  /**
   * The stage of the arc this verb belongs to, when it belongs to one. It travels to
   * the stylesheet as `data-stage`, which is what lets the segment's dot take
   * `--stage-<id>` — the rail's hue, on the rail's vocabulary, exactly as
   * `CanvasBarGroup` does it. Absent for a verb that is not a stage of the work:
   * asking Brain is how you do every stage, not one of them, and it wears the Brain
   * spark instead.
   */
  stage?: Stage;
  /** Catalog key, under `creationCanvas`. The word on the segment. */
  labelKey: string;
  /** Catalog key, under `creationCanvas`. What the field asks for while this is armed. */
  placeholderKey: string;
  /** Catalog key, under `creationCanvas`. What the send button says while this is armed. */
  submitLabelKey: string;
}

/**
 * Declaration order is NOT draw order: a surface lists its own intents and the first
 * one it lists is its default, so `ideas` can lead with capture while every other
 * surface leads with Ask.
 */
const CANVAS_COMPOSER_INTENTS: Readonly<Record<CanvasComposerIntentId, CanvasComposerIntentDef>> = {
  // The canvas's one universal verb, and the reason every surface has at least one
  // intent: there is no surface on which "ask Brain about this" is meaningless.
  ask: {
    id: 'ask',
    labelKey: 'composerIntent.ask.label',
    placeholderKey: 'composerIntent.ask.placeholder',
    submitLabelKey: 'composerIntent.ask.submit',
  },
  // The scratchpad's verb. It is `idea`-staged because that is literally what it is —
  // the Idea stage of the arc, in the same hue the left rail and the command bar's
  // first group already use for it.
  captureIdea: {
    id: 'captureIdea',
    stage: 'idea',
    labelKey: 'composerIntent.captureIdea.label',
    placeholderKey: 'composerIntent.captureIdea.placeholder',
    submitLabelKey: 'composerIntent.captureIdea.submit',
  },
};

/** The intent's copy and hue. */
export function canvasComposerIntent(id: CanvasComposerIntentId): CanvasComposerIntentDef {
  return CANVAS_COMPOSER_INTENTS[id];
}

/** Every declared intent, for the tests that read the copy back. */
export function canvasComposerIntentIds(): readonly CanvasComposerIntentId[] {
  return Object.keys(CANVAS_COMPOSER_INTENTS) as readonly CanvasComposerIntentId[];
}

/**
 * The intent every composer falls back to.
 *
 * Stated here rather than assumed at the call site: a surface whose declared list is
 * filtered down to nothing (a read-only viewer on the scratchpad, where capture is
 * withdrawn) still has a composer, and what it offers is a question for Brain.
 */
export const DEFAULT_CANVAS_COMPOSER_INTENT: CanvasComposerIntentId = 'ask';

/**
 * The intents a reader may actually press right now.
 *
 * `editable` is the board's own write gate. A viewer who cannot add cards must not be
 * offered a verb that creates one — that is a button whose only outcome is a silent
 * no — so the list collapses to `ask`, which a viewer may always do. The filter lives
 * here so the composer, the tests and any future host all narrow it the same way.
 */
export function offeredCanvasComposerIntents(
  intents: readonly CanvasComposerIntentId[],
  editable: boolean,
): readonly CanvasComposerIntentId[] {
  const offered = editable ? intents : intents.filter((id) => id === DEFAULT_CANVAS_COMPOSER_INTENT);
  return offered.length ? offered : [DEFAULT_CANVAS_COMPOSER_INTENT];
}
