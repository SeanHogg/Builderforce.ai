import { memo } from 'react';
import { promptTrailingAction, useVoiceDictation } from '@seanhogg/builderforce-brain-ui';
import { ComposerPrimaryAction, type ComposerPrimaryActionProps } from './ComposerPrimaryAction';
import { VoiceDictationButton } from './VoiceDictationButton';

/**
 * ONE trailing button for a composer that offers voice: the mic while there is nothing
 * to send or stop, Send once there is text, Stop while a run streams. Which one is the
 * shared `promptTrailingAction`, the same rule the editor panel follows; the dictation
 * is the shared `useVoiceDictation`, and where the runtime cannot listen there is no
 * mic at all.
 */
export const ComposerSendOrVoice = memo(function ComposerSendOrVoice({ getValue, onChange, disabled, ...primary }: ComposerPrimaryActionProps & {
  /** Reads the composer's current text when a phrase lands — stable, so typing does not re-render the recognizer. */
  getValue: () => string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { supported, recording, startVoice, stopVoice } = useVoiceDictation(getValue, onChange);
  const action = promptTrailingAction({
    canSubmit: primary.canSubmit,
    running: primary.running,
    canStop: !!primary.onStop,
    voice: supported,
    recording,
  });
  if (action === 'voice') {
    return <VoiceDictationButton recording={recording} onToggle={recording ? stopVoice : startVoice} disabled={disabled} />;
  }
  return <ComposerPrimaryAction {...primary} />;
});
