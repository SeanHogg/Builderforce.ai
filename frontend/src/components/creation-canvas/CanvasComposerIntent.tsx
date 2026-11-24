// No 'use client' directive: this is drawn only inside `CanvasComposer`, which sits
// inside the `CreationCanvas` client boundary already — the same reason
// `CanvasBarGroup` and `CanvasSessionActions` each state at the top of themselves. A
// second declaration would only add a file to the architecture ratchet's tally.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  canvasComposerIntent,
  offeredCanvasComposerClarifier,
  offeredCanvasComposerIntents,
  type CanvasComposerClarifierChoiceId,
  type CanvasComposerClarifierContext,
  type CanvasComposerClarifierDef,
  type CanvasComposerIntentId,
} from '@/lib/canvasComposerIntents';
import styles from './styles/composer.module.css';
import { BrainMark } from '@seanhogg/builderforce-brain-ui';

/**
 * WHAT ENTER MEANS, as the composer's leading segment.
 *
 * ── WHY THIS IS A CONTROL AND NOT A HINT ─────────────────────────────────────────
 * The scratchpad's answer used to be a second text field, which made "what does this
 * box do" a question about WHICH BOX. One composer with a visible verb answers it in
 * the place the answer is needed: beside the thing you are about to press Enter in.
 *
 * ── WHY IT DISAPPEARS AT ONE ─────────────────────────────────────────────────────
 * A segmented control with a single segment is a label wearing a control's chrome. On
 * every surface but the scratchpad there is exactly one thing a line can mean, so
 * there is nothing to choose and this draws nothing — the placeholder already says
 * what the field is for. That rule lives HERE rather than at the call site so the
 * composer cannot ship a one-segment radio group by forgetting it.
 *
 * ── WHY `radiogroup` AND NOT A TOGGLE PAIR ───────────────────────────────────────
 * Exactly one is armed and arming one disarms the other, which is what `radio` means.
 * `aria-pressed` on two buttons would let assistive tech read a state where both are
 * on, and a state where neither is — neither of which this control can be in.
 *
 * ── PURE PRESENTATION ────────────────────────────────────────────────────────────
 * It holds no state. The composer owns the armed intent (`useComposerIntent`, below),
 * because the composer is what routes the submit — a control that remembered its own
 * answer would be a second source of truth for the one decision the Enter key reads.
 */
export interface CanvasComposerIntentProps {
  /** The verbs this surface offers, in offer order. One or none draws nothing. */
  intents: readonly CanvasComposerIntentId[];
  /** The armed verb. Always one of `intents`. */
  value: CanvasComposerIntentId;
  onChange: (intent: CanvasComposerIntentId) => void;
}

export function CanvasComposerIntent({ intents, value, onChange }: CanvasComposerIntentProps) {
  return (
    <ComposerSegments
      labelKey="composerIntent.label"
      testId="canvas-composer-intent"
      segments={intents.map((id) => {
        const def = canvasComposerIntent(id);
        // A staged verb wears the arc's own dot in the arc's own hue; the one verb that is
        // not a stage wears the Brain mark, which is how Brain is drawn everywhere else on
        // this canvas. Two marks for two different kinds of thing, rather than one
        // decorative glyph repeated.
        return { id, labelKey: def.labelKey, titleKey: def.placeholderKey, stage: def.stage, mark: def.stage ? 'dot' : 'spark' };
      })}
      value={value}
      onChange={onChange}
    />
  );
}

export interface CanvasComposerClarifierProps {
  /** The question the request raises (`offeredCanvasComposerClarifier`). */
  clarifier: CanvasComposerClarifierDef;
  /** The armed choice. Always one of the clarifier's. */
  value: CanvasComposerClarifierChoiceId;
  onChange: (choice: CanvasComposerClarifierChoiceId) => void;
}

/**
 * WHAT THIS LINE MEANS, when the request itself is ambiguous — "an agent" on a board whose
 * app can declare one. The same radiogroup as the verb, so the reader meets one control,
 * not two; its choices carry no mark because none of them is a stage or Brain.
 */
export function CanvasComposerClarifier({ clarifier, value, onChange }: CanvasComposerClarifierProps) {
  return (
    <ComposerSegments
      labelKey={clarifier.labelKey}
      testId={`canvas-composer-clarifier-${clarifier.id}`}
      segments={clarifier.choices.map((choice) => ({ id: choice.id, labelKey: choice.labelKey, titleKey: choice.titleKey, mark: 'none' }))}
      value={value}
      onChange={onChange}
    />
  );
}

interface ComposerSegment<Id extends string> {
  id: Id;
  /** Catalog keys, under `creationCanvas`. */
  labelKey: string;
  titleKey: string;
  stage?: string;
  mark: 'dot' | 'spark' | 'none';
}

/** The one radiogroup both the verb and a clarifier draw. One segment draws nothing. */
function ComposerSegments<Id extends string>({ labelKey, testId, segments, value, onChange }: {
  labelKey: string;
  testId: string;
  segments: readonly ComposerSegment<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}) {
  const t = useTranslations('creationCanvas');

  // One segment is not a choice. See the header.
  if (segments.length < 2) return null;

  // The registry's keys are catalog keys; the cast is the one every consumer of a
  // registry-declared key makes, because next-intl types the key as a literal union and
  // a registry deals in strings.
  return (
    <div className={styles.composerIntent} role="radiogroup" aria-label={t(labelKey as 'share')} data-testid={testId}>
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          role="radio"
          aria-checked={segment.id === value}
          className={styles.composerIntentSegment}
          data-testid={`${testId}-${segment.id}`}
          data-stage={segment.stage}
          title={t(segment.titleKey as 'share')}
          onClick={() => onChange(segment.id)}
        >
          {segment.mark === 'dot' && <i className={styles.composerIntentDot} aria-hidden />}
          {segment.mark === 'spark' && <span className={styles.composerIntentSpark} aria-hidden><BrainMark size={12} /></span>}
          {t(segment.labelKey as 'share')}
        </button>
      ))}
    </div>
  );
}

/**
 * The armed verb for a composer offering `intents`, reset whenever the OFFER changes.
 *
 * The previous offer is held IN state beside the choice — React's documented way to
 * adjust state during render — rather than in a ref or an effect. An effect would paint
 * one frame with a verb this surface does not offer, and that frame is the one somebody
 * presses; a ref read during render is the pattern the hooks ratchet exists to stop.
 *
 * Keyed on the joined ids and not on the array's identity: the host rebuilds the list on
 * every render (a `readonly` row off a registry), so an identity check would throw the
 * reader's choice away on every keystroke. A verb the host PREFERS (the phone Brain
 * sheet's `ask`) overrides the standing choice while it holds, and never permanently.
 */
export function useComposerIntent(
  intents: readonly CanvasComposerIntentId[],
  editable: boolean,
  preferIntent?: CanvasComposerIntentId,
) {
  const offered = offeredCanvasComposerIntents(intents, editable);
  const fallback = offered[0]!;
  const offerKey = offered.join(',');
  const [chosen, setChosen] = useState<{ offer: string; id: CanvasComposerIntentId }>({ offer: offerKey, id: fallback });
  if (chosen.offer !== offerKey) {
    setChosen({ offer: offerKey, id: fallback });
  }
  const active = preferIntent && offered.includes(preferIntent)
    ? preferIntent
    : chosen.offer === offerKey && offered.includes(chosen.id) ? chosen.id : fallback;
  return { offered, active, choose: (id: CanvasComposerIntentId) => setChosen({ offer: offerKey, id }) };
}

/**
 * The question `request` raises on this canvas and the armed answer — reset to the
 * clarifier's first choice whenever the question itself changes (appears, goes, or is
 * another one), by the same held-offer pattern as `useComposerIntent`. Null `clarifier`
 * means the line raises no question and Enter does what the armed verb says.
 */
export function useComposerClarifier(request: string, context: CanvasComposerClarifierContext) {
  const clarifier = offeredCanvasComposerClarifier(request, context);
  const offerKey = clarifier?.id ?? '';
  const [chosen, setChosen] = useState<{ offer: string; id: CanvasComposerClarifierChoiceId | null }>({ offer: offerKey, id: null });
  if (chosen.offer !== offerKey) {
    setChosen({ offer: offerKey, id: null });
  }
  const choice = clarifier
    ? clarifier.choices.find((entry) => chosen.offer === offerKey && entry.id === chosen.id) ?? clarifier.choices[0]!
    : null;
  return {
    clarifier,
    choice,
    choose: (id: CanvasComposerClarifierChoiceId) => setChosen({ offer: offerKey, id }),
  };
}
