// No 'use client' directive: this is drawn only inside `CanvasComposer`, which sits
// inside the `CreationCanvas` client boundary already — the same reason
// `CanvasBarGroup` and `CanvasSessionActions` each state at the top of themselves. A
// second declaration would only add a file to the architecture ratchet's tally.
import { useTranslations } from 'next-intl';
import { BrainMark } from '@/components/brain/BrainMark';
import {
  canvasComposerIntent,
  type CanvasComposerIntentId,
} from '@/lib/canvasComposerIntents';
import styles from './CreationCanvas.module.css';

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
 * It holds no state. The composer owns the armed intent, because the composer is what
 * routes the submit — a control that remembered its own answer would be a second
 * source of truth for the one decision the Enter key reads.
 */
export interface CanvasComposerIntentProps {
  /** The verbs this surface offers, in offer order. One or none draws nothing. */
  intents: readonly CanvasComposerIntentId[];
  /** The armed verb. Always one of `intents`. */
  value: CanvasComposerIntentId;
  onChange: (intent: CanvasComposerIntentId) => void;
}

export function CanvasComposerIntent({ intents, value, onChange }: CanvasComposerIntentProps) {
  const t = useTranslations('creationCanvas');

  // One segment is not a choice. See the header.
  if (intents.length < 2) return null;

  return (
    <div
      className={styles.composerIntent}
      role="radiogroup"
      aria-label={t('composerIntent.label')}
      data-testid="canvas-composer-intent"
    >
      {intents.map((id) => {
        const def = canvasComposerIntent(id);
        const active = id === value;
        // The registry's keys are catalog keys; the cast is the one every consumer of a
        // registry-declared key makes, because next-intl types the key as a literal
        // union and a registry deals in strings.
        const label = t(def.labelKey as 'share');
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            className={styles.composerIntentSegment}
            data-testid={`canvas-composer-intent-${id}`}
            data-stage={def.stage}
            title={t(def.placeholderKey as 'share')}
            onClick={() => onChange(id)}
          >
            {/* A staged verb wears the arc's own dot in the arc's own hue; the one verb
                that is not a stage wears the Brain mark, which is how Brain is drawn
                everywhere else on this canvas. Two marks for two different kinds of
                thing, rather than one decorative glyph repeated. */}
            {def.stage
              ? <i className={styles.composerIntentDot} aria-hidden />
              : <span className={styles.composerIntentSpark} aria-hidden><BrainMark size={12} /></span>}
            {label}
          </button>
        );
      })}
    </div>
  );
}
