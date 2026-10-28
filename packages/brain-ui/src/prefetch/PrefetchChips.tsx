import { memo, useEffect, useRef, type KeyboardEvent } from 'react';
import type { PrefetchConfirm, PrefetchResult } from '@seanhogg/builderforce-brain-embedded';
import { stringsFrom, type LabelLookup } from '../labelCatalog';

/**
 * The PreFetch chips (docs/design/deterministic-prefetch.md) — ONE component family every
 * surface (the VS Code chat, the web Brain panel, Rovr) renders in the SAME composer
 * transcript, never a modal or a panel of its own:
 *
 * - {@link PrefetchConfirmChip}: a deterministic WRITE action (lint auto-fix, format,
 *   codegen, a scaffold, a codemod) waits on the person. It is the run's own pending
 *   confirm (`prefetchConfirmOf`), so it resolves through the host's `resolveRunConfirm`
 *   on Run or Dismiss, and a Stop declines it — the chip simply goes away. Never an
 *   "always" lever: a write action is confirmed every time.
 * - {@link PrefetchAnswerChips}: the next steps under an ANSWER a tool gave without a
 *   model (e.g. **Open in graph** under a duplicate-code summary).
 *
 * Copy comes from the host's catalog (`prefetchChipLabelsFrom`); an action's or chip's
 * own name is its `labelKey`, resolved by the host's `labelOf`. Theme-driven (`--bf-*`),
 * wraps at 360px.
 */

export interface PrefetchChipLabels {
  /** The confirm question — `{action}` is replaced by the action's name. */
  confirmPrompt: string;
  confirm: string;
  dismiss: string;
  /** Accessible name of the confirm chip. */
  aria: string;
  /** The answer row's title — `{action}` is the action that answered. */
  answeredBy: string;
  answeredHint: string;
  /** Accessible name of the answer chips' row. */
  nextSteps: string;
}

export const DEFAULT_PREFETCH_CHIP_LABELS: PrefetchChipLabels = {
  confirmPrompt: 'Run {action}? It changes files in your workspace.',
  confirm: 'Run',
  dismiss: 'Dismiss',
  aria: 'Confirm a workspace change',
  answeredBy: 'Answered by {action} — no model was called',
  answeredHint: 'A deterministic tool answered this request directly, so no model ran.',
  nextSteps: 'Next steps',
};

/** The chips' copy from a host catalog (canonical keys = the field names). */
export function prefetchChipLabelsFrom(lookup: LabelLookup): PrefetchChipLabels {
  return stringsFrom(DEFAULT_PREFETCH_CHIP_LABELS, lookup);
}

/** A label key (`prefetch.action.<id>`, a chip's `labelKey`) in the host's language. */
export type PrefetchLabelOf = (labelKey: string) => string | undefined;

/** The host's text for `labelKey`, else a readable fallback. */
export function prefetchLabelText(labelOf: PrefetchLabelOf | undefined, labelKey: string, fallback: string): string {
  return labelOf?.(labelKey) || fallback;
}

/** One chip under an answer. */
export type PrefetchAnswerChip = NonNullable<PrefetchResult['chips']>[number];

/** `{action}` in a sentence, with the action's name emphasised. */
function withAction(sentence: string, action: string) {
  const [before, after = ''] = sentence.split('{action}');
  return (
    <>
      {before}
      <strong>{action}</strong>
      {after}
    </>
  );
}

export interface PrefetchConfirmChipProps {
  confirm: PrefetchConfirm;
  onConfirm: () => void;
  onDismiss: () => void;
  labels?: Partial<PrefetchChipLabels>;
  labelOf?: PrefetchLabelOf;
  className?: string;
}

export const PrefetchConfirmChip = memo(function PrefetchConfirmChip({
  confirm,
  onConfirm,
  onDismiss,
  labels: overrides,
  labelOf,
  className,
}: PrefetchConfirmChipProps) {
  const labels = { ...DEFAULT_PREFETCH_CHIP_LABELS, ...overrides };
  const runRef = useRef<HTMLButtonElement>(null);
  useEffect(() => runRef.current?.focus(), [confirm]);
  const action = prefetchLabelText(labelOf, confirm.labelKey, confirm.actionId);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  };
  return (
    <div
      role="group"
      aria-label={labels.aria}
      className={['bf-prefetch-confirm', className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
      data-action={confirm.actionId}
    >
      <span className="bf-prefetch-confirm__prompt">{withAction(labels.confirmPrompt, action)}</span>
      {confirm.request && (
        <span className="bf-prefetch-confirm__request" title={confirm.request}>{confirm.request}</span>
      )}
      {confirm.detail && <span className="bf-prefetch-confirm__detail">{confirm.detail}</span>}
      <span className="bf-prefetch-confirm__actions">
        <button ref={runRef} type="button" className="bf-chip-btn bf-chip-btn--primary" onClick={onConfirm}>
          {labels.confirm}
        </button>
        <button type="button" className="bf-chip-btn" onClick={onDismiss}>
          {labels.dismiss}
        </button>
      </span>
    </div>
  );
});

export interface PrefetchAnswerChipsProps {
  chips: readonly PrefetchAnswerChip[];
  onChip: (chip: PrefetchAnswerChip) => void;
  labels?: Partial<PrefetchChipLabels>;
  labelOf?: PrefetchLabelOf;
}

export const PrefetchAnswerChips = memo(function PrefetchAnswerChips({ chips, onChip, labels: overrides, labelOf }: PrefetchAnswerChipsProps) {
  if (chips.length === 0) return null;
  const labels = { ...DEFAULT_PREFETCH_CHIP_LABELS, ...overrides };
  return (
    <div role="group" aria-label={labels.nextSteps} className="bf-prefetch-chips">
      {chips.map((chip) => (
        <button key={`${chip.command}:${chip.labelKey}`} type="button" className="bf-chip-btn" onClick={() => onChip(chip)}>
          {prefetchLabelText(labelOf, chip.labelKey, chip.labelKey)}
        </button>
      ))}
    </div>
  );
});

/** The answer row's title for an action that answered without a model. */
export function prefetchAnsweredTitle(labels: Partial<PrefetchChipLabels> | undefined, labelOf: PrefetchLabelOf | undefined, actionId: string) {
  const l = { ...DEFAULT_PREFETCH_CHIP_LABELS, ...labels };
  return withAction(l.answeredBy, prefetchLabelText(labelOf, `prefetch.action.${actionId}`, actionId));
}
