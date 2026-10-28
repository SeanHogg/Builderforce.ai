import { memo, useEffect, useRef, type ReactNode } from 'react';
import { prefetchConfirmOf } from '@seanhogg/builderforce-brain-embedded';
import { stringsFrom, type LabelLookup } from './labelCatalog';
import { PrefetchConfirmChip, type PrefetchChipLabels, type PrefetchLabelOf } from './prefetch/PrefetchChips';

/**
 * The human-in-the-loop approval — ONE bar for every surface that pauses a run on a
 * mutating tool call (`BrainRunSnapshot.pendingConfirm`): the web Brain panel, the VS
 * Code chat and its sub-agent strip, and Rovr's side panel. Extracted from the web's
 * BrainToolConfirmBar; it carries what the other copies had and it lacked:
 *
 * - the exact command line for `run_command` (VS Code), so the person approves what
 *   actually runs, not just the tool name;
 * - an optional "always" lever (`onApproveAll`) — omitted ⇒ not offered;
 * - a `children` slot for a host's own WHY and WHAT (Rovr's safety reasons, the element
 *   it would act on, a masked sensitive value) — given ⇒ the raw-args preview stands down;
 * - focus on Approve when it appears (keyboard-first, as Rovr had it).
 *
 * A pending confirm raised by a PreFetch WRITE action (`prefetchConfirmOf`) renders as the
 * PreFetch confirm CHIP instead — same pending confirm, same answer path, so every host
 * that shows this bar shows the chip with no wiring of its own; it never offers "always".
 *
 * Presentational and theme-driven (`--bf-*`); a host passes handlers and copy, never a
 * `canX` flag.
 */

export interface ToolConfirmBarLabels {
  /** The question — must contain `{name}`, replaced by the tool name in `<code>`. */
  prompt: string;
  approve: string;
  /** The "always" lever's label (approve this and stop asking). */
  approveAll: string;
  /** Tooltip for the "always" lever. */
  approveAllTitle?: string;
  deny: string;
  /** Accessible name of the bar. */
  aria: string;
}

export const DEFAULT_TOOL_CONFIRM_LABELS: ToolConfirmBarLabels = {
  prompt: 'Run {name}?',
  approve: 'Approve',
  approveAll: 'Always',
  deny: 'Cancel',
  aria: 'Approve this action',
};

/** THE confirm bar's copy from a host catalog (canonical keys = the field names). */
export function toolConfirmLabelsFrom(lookup: LabelLookup): ToolConfirmBarLabels {
  const approveAllTitle = lookup('approveAllTitle');
  return { ...stringsFrom(DEFAULT_TOOL_CONFIRM_LABELS, lookup), ...(approveAllTitle ? { approveAllTitle } : {}) };
}

export interface ToolConfirmBarProps {
  req: { name: string; args: unknown };
  onApprove: () => void;
  onDeny: () => void;
  /** Approve and stop asking. Omit and the lever is not offered. */
  onApproveAll?: () => void;
  /** Replaces the `prompt` sentence (a host whose question is richer than "Run X?"). */
  title?: ReactNode;
  /** A host's own detail rows. Given ⇒ the generic args preview is not shown. */
  children?: ReactNode;
  labels?: Partial<ToolConfirmBarLabels>;
  className?: string;
  /** Copy for the PreFetch confirm chip (a deterministic write action's confirm). */
  prefetchLabels?: Partial<PrefetchChipLabels>;
  /** The host's text for an action's `labelKey` (`prefetch.action.<id>`). */
  prefetchLabelOf?: PrefetchLabelOf;
}

const PREVIEW_MAX = 240;

/** What the person is approving, in one line: the command for a shell call, else the args. */
export function toolConfirmPreview(req: { name: string; args: unknown }): { command: string | null; args: string } {
  const command = req.name === 'run_command' && typeof (req.args as { command?: unknown } | null)?.command === 'string'
    ? (req.args as { command: string }).command
    : null;
  let args = '';
  try {
    const s = JSON.stringify(req.args ?? {});
    args = s === '{}' ? '' : s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX)}…` : s;
  } catch {
    args = '';
  }
  return { command, args };
}

export const ToolConfirmBar = memo(function ToolConfirmBar({
  req,
  onApprove,
  onDeny,
  onApproveAll,
  title,
  children,
  labels: labelOverrides,
  className,
  prefetchLabels,
  prefetchLabelOf,
}: ToolConfirmBarProps) {
  const labels = { ...DEFAULT_TOOL_CONFIRM_LABELS, ...labelOverrides };
  const approveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => approveRef.current?.focus(), [req]);
  const prefetch = prefetchConfirmOf(req);
  if (prefetch) {
    return (
      <PrefetchConfirmChip
        confirm={prefetch}
        onConfirm={onApprove}
        onDismiss={onDeny}
        {...(prefetchLabels ? { labels: prefetchLabels } : {})}
        {...(prefetchLabelOf ? { labelOf: prefetchLabelOf } : {})}
        {...(className ? { className } : {})}
      />
    );
  }
  const { command, args } = toolConfirmPreview(req);
  const [before, after = ''] = labels.prompt.split('{name}');

  return (
    <div role="alertdialog" aria-label={labels.aria} className={['bf-confirm', className].filter(Boolean).join(' ')}>
      <div className="bf-confirm__title">
        {title ?? (
          <>
            {before}
            <code>{req.name}</code>
            {after}
          </>
        )}
      </div>
      {children ?? (command ? <pre className="bf-confirm__cmd">{command}</pre> : args ? <div className="bf-confirm__args">{args}</div> : null)}
      <div className="bf-confirm__actions">
        <button ref={approveRef} type="button" className="bf-confirm__btn bf-confirm__btn--primary" onClick={onApprove}>
          {labels.approve}
        </button>
        {onApproveAll && (
          <button type="button" className="bf-confirm__btn" onClick={onApproveAll} title={labels.approveAllTitle}>
            {labels.approveAll}
          </button>
        )}
        <button type="button" className="bf-confirm__btn" onClick={onDeny}>
          {labels.deny}
        </button>
      </div>
    </div>
  );
});
