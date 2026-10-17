import { useTranslations } from 'next-intl';
import { ToolConfirmBar } from '@seanhogg/builderforce-brain-ui';
import { resolveRunConfirm, useRunSnapshot, type RunKey } from '@seanhogg/builderforce-brain-embedded';

/**
 * A run paused on a tool approval — THE web binding of the shared `ToolConfirmBar`,
 * read straight from the run store, so a web chat (keyed by its chat id) and a canvas
 * turn (keyed by `canvasRunKey`) ask with one bar and one sentence. Whichever surface is
 * on screen answers it; a Stop declines it. Renders nothing while nothing is pending.
 *
 * `onApproveAll` is the host's "approve the rest of this run" switch; the bar then lets
 * this call through. Omitted ⇒ no Approve-all button.
 */
export function RunConfirmBar({ runKey, onApproveAll }: { runKey: RunKey | null; onApproveAll?: () => void }) {
  const tBrain = useTranslations('brain');
  const tCommon = useTranslations('common');
  const { pendingConfirm } = useRunSnapshot(runKey);
  if (!pendingConfirm || runKey == null) return null;
  const action = pendingConfirm.name.replace(/_/g, ' ');
  return (
    <ToolConfirmBar
      req={pendingConfirm}
      onApprove={() => resolveRunConfirm(runKey, true)}
      onDeny={() => resolveRunConfirm(runKey, false)}
      {...(onApproveAll ? { onApproveAll: () => { onApproveAll(); resolveRunConfirm(runKey, true); } } : {})}
      // A fragment, not the bare node: the shared bar's ReactNode comes from a second
      // copy of React's types, and only an element is assignable across the two.
      title={<>{tBrain.rich('wantsTo', { action, b: (chunks) => <strong>{chunks}</strong> })}</>}
      labels={{
        approve: tCommon('approve'),
        approveAll: tBrain('approveAll'),
        approveAllTitle: tBrain('approveAllTitle'),
        deny: tCommon('cancel'),
        aria: tBrain('confirmActionAria'),
      }}
    />
  );
}
