/**
 * The composer's ONE trailing button — mic, Send or Stop. Which one is the shared
 * `promptTrailingAction` rule; the dictation is the shared `useVoiceDictation`, and
 * where the runtime cannot listen there is no mic at all. Send during a run queues the
 * message behind it, so its name says so.
 */
import { promptTrailingAction } from '../promptTrailingAction';
import { useVoiceDictation } from '../useVoiceDictation';
import { IconMic, IconSend, IconStop } from './ComposerIcons';
import type { ComposerLabels } from './labels';

export interface ComposerTrailingButtonProps {
  labels: ComposerLabels;
  canSubmit: boolean;
  running: boolean;
  disabled?: boolean;
  onSend: () => void;
  onStop?: () => void;
  /** Offer dictation. Needs the current text reader + setter. */
  voice?: { getValue: () => string; setValue: (value: string) => void };
}

const noopGet = () => '';
const noopSet = () => undefined;

export function ComposerTrailingButton({ labels, canSubmit, running, disabled = false, onSend, onStop, voice }: ComposerTrailingButtonProps) {
  const dictation = useVoiceDictation(voice?.getValue ?? noopGet, voice?.setValue ?? noopSet);
  const action = promptTrailingAction({
    canSubmit,
    running,
    canStop: !!onStop,
    voice: !!voice && dictation.supported,
    recording: dictation.recording,
  });
  if (action === 'voice') {
    const label = dictation.recording ? labels.stopDictation : labels.dictate;
    return (
      <button
        type="button"
        className={`bf-cmp-iconbtn bf-cmp-iconbtn--voice${dictation.recording ? ' is-listening' : ''}`}
        title={label}
        aria-label={label}
        aria-pressed={dictation.recording}
        disabled={disabled}
        onClick={dictation.recording ? dictation.stopVoice : dictation.startVoice}
      >
        <IconMic />
      </button>
    );
  }
  if (action === 'stop') {
    return (
      <button type="button" className="bf-cmp-iconbtn bf-cmp-iconbtn--stop" onClick={onStop} title={labels.stop} aria-label={labels.stop}>
        <IconStop />
      </button>
    );
  }
  const label = running ? labels.queueSend : labels.send;
  return (
    <button type="submit" className="bf-cmp-iconbtn bf-cmp-iconbtn--send" onClick={(e) => { e.preventDefault(); onSend(); }} disabled={!canSubmit || disabled} title={label} aria-label={label}>
      <IconSend />
    </button>
  );
}
