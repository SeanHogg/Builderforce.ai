import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { iconButtonStyle } from './composerStyles';
import { useVoiceDictation } from './useVoiceDictation';

/** The composer's dictate / stop-dictation toggle. */
export const VoiceDictationButton = memo(function VoiceDictationButton({ getValue, onChange, disabled }: {
  /** Reads the composer's current text when a phrase lands — stable, so typing does not re-render this. */
  getValue: () => string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations('chatInput');
  const { recording, startVoice, stopVoice } = useVoiceDictation(getValue, onChange);
  return (
    <button
      type="button"
      onClick={recording ? stopVoice : startVoice}
      disabled={disabled}
      title={recording ? t('stopDictation') : t('dictate')}
      style={{ ...iconButtonStyle(disabled), background: recording ? 'var(--surface-interactive)' : undefined }}
    >
      <Icon name="mic" size={20} />
    </button>
  );
});
