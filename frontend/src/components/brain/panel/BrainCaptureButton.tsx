import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { useBrainPanel } from './BrainPanelContext';

/** Shared chrome for the "capture execution" icon button (page + docked headers). */
export const BrainCaptureButton = memo(function BrainCaptureButton({ onCapture, hasTrace, state }: {
  onCapture: () => void;
  /** Whether the run left anything to capture. */
  hasTrace: boolean;
  state: ReturnType<typeof useCopyToClipboard>['state'];
}) {
  const tBrain = useTranslations('brain');
  return (
    <button
      type="button"
      onClick={onCapture}
      disabled={!hasTrace}
      title={hasTrace
        ? tBrain('captureHasTrace')
        : tBrain('captureNoTrace')}
      aria-label={tBrain('captureExecutionAria')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 24,
        padding: 0,
        fontSize: 'var(--font-size-small)',
        lineHeight: 1,
        background: 'var(--bg-elevated)',
        color: state === 'error'
          ? 'var(--danger)'
          : state === 'copied'
            ? 'var(--success, var(--success))'
            : 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        cursor: hasTrace ? 'pointer' : 'not-allowed',
        opacity: hasTrace ? 1 : 0.5,
      }}
    >
      <Icon name={state === 'copied' ? 'check' : state === 'error' ? 'close' : 'document'} size={14} />
    </button>
  );
});

/** The capture button wired to the panel's controller. */
export function BrainPanelCaptureButton() {
  const { captureExecution, conv, captureState } = useBrainPanel();
  return <BrainCaptureButton onCapture={captureExecution} hasTrace={conv.hasTrace} state={captureState} />;
}
