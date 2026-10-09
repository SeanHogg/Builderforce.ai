import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { sendButtonStyle } from './composerStyles';

/**
 * Send, or Stop while a run is in flight. Handed to the shell's trailing slot,
 * which pins it to the far right edge.
 */
export interface ComposerPrimaryActionProps {
  running: boolean;
  onStop?: () => void;
  canSubmit: boolean;
  submitLabel: string;
}

export const ComposerPrimaryAction = memo(function ComposerPrimaryAction({ running, onStop, canSubmit, submitLabel }: ComposerPrimaryActionProps) {
  const t = useTranslations('chatInput');
  if (running && onStop && !canSubmit) {
    // Streaming with an empty composer → the button interrupts the run.
    // When the composer HAS submittable text (e.g. the queue-while-thinking
    // path where the host keeps the input editable), the Send button below
    // renders instead so the typed turn can be queued.
    return (
      <button
        type="button"
        onClick={onStop}
        title={t('stop')}
        aria-label={t('stop')}
        style={sendButtonStyle(false)}
      >
        <Icon name="stop" size={14} />
      </button>
    );
  }
  return (
    <button
      type="submit"
      disabled={!canSubmit}
      title={submitLabel}
      style={sendButtonStyle(!canSubmit)}
    >
      {/* The send arrow sits on a filled accent plate, so it keeps the heavier
          stroke it needs to read there rather than the set's 1.8. */}
      <Icon name="arrow-up" size={18} strokeWidth={2.5} />
    </button>
  );
});
