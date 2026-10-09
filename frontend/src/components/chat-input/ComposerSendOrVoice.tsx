import { memo } from 'react';
import { ComposerPrimaryAction, type ComposerPrimaryActionProps } from './ComposerPrimaryAction';
import { VoiceDictationButton } from './VoiceDictationButton';
import { useVoiceDictation } from './useVoiceDictation';

/**
 * ONE trailing button for a composer that offers voice: the mic while there is nothing
 * to send or stop, Send once there is text, Stop while a run streams.
 *
 * Mic and Send used to be two controls on two different rows — the mic in the wrapping
 * tool row, Send pinned right — so an empty composer showed a greyed-out Send beside a
 * mic nobody could find. They are never both useful at once, so they share the slot.
 * A live recording keeps the mic (now Stop dictation) in place even as phrases land in
 * the box; otherwise the first phrase would swap it for Send and strand the recording.
 */
export const ComposerSendOrVoice = memo(function ComposerSendOrVoice({ getValue, onChange, disabled, ...primary }: ComposerPrimaryActionProps & {
  /** Reads the composer's current text when a phrase lands — stable, so typing does not re-render the recognizer. */
  getValue: () => string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { recording, startVoice, stopVoice } = useVoiceDictation(getValue, onChange);
  if (recording || (!primary.canSubmit && !primary.running)) {
    return <VoiceDictationButton recording={recording} onToggle={recording ? stopVoice : startVoice} disabled={disabled} />;
  }
  return <ComposerPrimaryAction {...primary} />;
});
