import { useState } from 'react';

/**
 * THE clipboard button of this package.
 *
 * The tool step's Command / Input / Output / preview panels wear it as a labelled
 * chip; a message wears it as an icon. One implementation, because two would drift
 * on the confirmation timing alone.
 *
 * Its label contract is deliberately NARROW — two strings, not the whole transcript
 * bundle — so any surface can mount it without owning a `BrainTimelineLabels`.
 */
export interface CopyLabels {
  copy: string;
  copied: string;
}

/** How long the "Copied" confirmation stays up. */
const CONFIRM_MS = 1500;

export function CopyButton({ text, labels, icon = false }: { text: string; labels: CopyLabels; icon?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={icon ? 'bf-tl__act' : 'bf-tl__copy'}
      title={copied ? labels.copied : labels.copy}
      aria-label={copied ? labels.copied : labels.copy}
      data-state={copied ? 'done' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), CONFIRM_MS);
          },
          () => {},
        );
      }}
    >
      {icon ? <span aria-hidden>{copied ? '✓' : '⧉'}</span> : copied ? labels.copied : labels.copy}
    </button>
  );
}
