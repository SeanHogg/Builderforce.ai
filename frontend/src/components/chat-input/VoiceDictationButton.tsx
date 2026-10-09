import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { iconButtonStyle } from './composerStyles';

/**
 * The composer's dictate / stop-dictation toggle. Presentational: the dictation itself
 * is owned by `ComposerSendOrVoice`, which also decides when this button stands in the
 * Send slot — so it has to know whether a recording is live before choosing.
 */
export const VoiceDictationButton = memo(function VoiceDictationButton({ recording, onToggle, disabled }: {
  recording: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const t = useTranslations('chatInput');
  const label = recording ? t('stopDictation') : t('dictate');
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={recording}
      style={{ ...iconButtonStyle(disabled), background: recording ? 'var(--surface-interactive)' : undefined }}
    >
      <Icon name="mic" size={20} />
    </button>
  );
});
