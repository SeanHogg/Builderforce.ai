/**
 * THE one-line notice every host shows when Hybrid's pick failed and the turn was answered
 * with Auto — "Your pick X failed; answered with Auto." A fallback is never silent.
 *
 * The routing step reports into a {@link ModelFallbackChannel} (brain-embedded); this reads
 * it, so a host only creates the channel, hands `channel.report` to `createHostModelStream`
 * as `onFallback`, and mounts this beside its composer. Self-gating: renders nothing while
 * nothing fell back. Polite live region, dismissible, wraps at any width (360px included).
 */
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_MODEL_FALLBACK_TEMPLATE,
  modelFallbackText,
  type ModelFallbackChannel,
  type ModelFallbackEvent,
} from '@seanhogg/builderforce-brain-embedded';

export interface ModelFallbackNoticeLabels {
  /** The line — must contain the literal `{model}` token. */
  fallback: string;
  dismiss: string;
}

export const DEFAULT_MODEL_FALLBACK_LABELS: ModelFallbackNoticeLabels = {
  fallback: DEFAULT_MODEL_FALLBACK_TEMPLATE,
  dismiss: 'Dismiss',
};

const NO_EVENT = (): null => null;
const NO_SUBSCRIBE = () => () => undefined;

/** The channel's latest undismissed fallback, re-rendering on each report / dismiss. */
export function useModelFallback(channel: ModelFallbackChannel | null | undefined): ModelFallbackEvent | null {
  return useSyncExternalStore(channel?.subscribe ?? NO_SUBSCRIBE, channel?.latest ?? NO_EVENT, NO_EVENT);
}

export interface ModelFallbackNoticeProps {
  channel: ModelFallbackChannel | null | undefined;
  labels?: Partial<ModelFallbackNoticeLabels>;
  className?: string;
}

export function ModelFallbackNotice({ channel, labels: partial, className }: ModelFallbackNoticeProps) {
  const event = useModelFallback(channel);
  if (!event || !channel) return null;
  const labels = { ...DEFAULT_MODEL_FALLBACK_LABELS, ...partial };
  return (
    <div className={['bf-fallback-notice', className].filter(Boolean).join(' ')} role="status" aria-live="polite">
      <span className="bf-fallback-notice__text">{modelFallbackText(labels.fallback, event)}</span>
      <button
        type="button"
        className="bf-fallback-notice__dismiss"
        onClick={channel.clear}
        title={labels.dismiss}
        aria-label={labels.dismiss}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
