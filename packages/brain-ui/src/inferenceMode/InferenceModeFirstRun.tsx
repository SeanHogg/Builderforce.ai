/**
 * The FIRST-RUN question — "How should BuilderForce run models?" — asked once, the first
 * time a person the host asks (`needsChoice`) sends a turn without having chosen a mode. Two answers: Hybrid
 * (recommended) and Local only; Specific model is chosen in the `/` menu's Model tab,
 * beside the picker it needs. THE first-run gate (`useInferenceModeGate`) holds the turn
 * behind this and sends it the moment a mode is picked, so the question never costs a re-type.
 *
 * It appears because the person pressed Send, so it takes focus (the recommended answer)
 * and says why through a polite live region — a keyboard or screen-reader user is never
 * left on a Send that silently did nothing.
 */
import { useEffect, useId, useRef } from 'react';
import { inferenceModeCopy, type InferenceModeLabels } from './labels';
import type { InferenceMode } from '@seanhogg/builderforce-brain-embedded';

const ASKED: readonly InferenceMode[] = ['hybrid', 'local-only'];

export interface InferenceModeFirstRunProps {
  labels: InferenceModeLabels;
  onChoose: (mode: InferenceMode) => void;
}

export function InferenceModeFirstRun({ labels, onChoose }: InferenceModeFirstRunProps) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement | null>(null);
  const region = useRef<HTMLDivElement | null>(null);
  const announcement = `${labels.inferenceModeAskTitle} ${labels.inferenceModeAskBody}`;
  // Filled AFTER mount (written to the node, not rendered): a live region that already
  // holds its text when it appears is not reliably announced.
  useEffect(() => {
    first.current?.focus();
    if (region.current) region.current.textContent = announcement;
  }, [announcement]);
  return (
    <div className="bf-imode-ask" role="group" aria-labelledby={titleId}>
      <div ref={region} className="bf-imode-ask__announce" role="status" aria-live="polite" />
      <div className="bf-imode-ask__title" id={titleId}>{labels.inferenceModeAskTitle}</div>
      <div className="bf-imode-ask__choices">
        {ASKED.map((mode, index) => {
          const { name, hint } = inferenceModeCopy(mode, labels);
          return (
            <button
              key={mode}
              ref={index === 0 ? first : undefined}
              type="button"
              className={`bf-imode-ask__choice${mode === 'hybrid' ? ' is-recommended' : ''}`}
              onClick={() => onChoose(mode)}
            >
              <span className="bf-imode-ask__name">
                {name}
                {mode === 'hybrid' && <span className="bf-imode__tag">{labels.inferenceModeRecommended}</span>}
              </span>
              <span className="bf-imode-ask__hint">{hint}</span>
            </button>
          );
        })}
      </div>
      <div className="bf-imode-ask__body">{labels.inferenceModeAskBody}</div>
    </div>
  );
}
