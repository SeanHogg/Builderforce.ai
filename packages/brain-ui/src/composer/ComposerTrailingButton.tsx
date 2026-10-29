/**
 * The composer's ONE trailing button — mic, Send or Stop. Which one is the shared
 * `promptTrailingAction` rule; the dictation is the shared `useVoiceDictation`, and
 * where the runtime cannot listen there is no mic at all. Send during a run queues the
 * message behind it, so its name says so — unless the host STEERS the run with Send
 * (`onQueue`), and then "Queue for after" sits beside it, naming its shortcut.
 */
import { promptTrailingAction } from '../promptTrailingAction';
import { useVoiceDictation } from '../useVoiceDictation';
import { IconMic, IconQueue, IconSend, IconStop } from './ComposerIcons';
import type { ComposerLabels } from './labels';

/** The platform's spelling of the queue shortcut: `⌥+Enter` on macOS, `Alt+Enter` elsewhere. */
export function queueShortcutKeys(nav: { platform?: string; userAgentData?: { platform?: string } } | undefined = typeof navigator === 'undefined' ? undefined : (navigator as never)): string {
  const platform = nav?.userAgentData?.platform || nav?.platform || '';
  return /mac|iphone|ipad/i.test(platform) ? '⌥+Enter' : 'Alt+Enter';
}

export interface ComposerTrailingButtonProps {
  labels: ComposerLabels;
  canSubmit: boolean;
  running: boolean;
  disabled?: boolean;
  onSend: () => void;
  onStop?: () => void;
  /** Mid-run "Queue for after" — shown beside Send while a run is going and there is text. */
  onQueue?: () => void;
  /** Whether Send while a run streams steers the run (true/absent: the host's `queueSend` verb) or holds the message (false: `queueHold`). */
  sendSteers?: boolean;
  /** Offer dictation. Needs the current text reader + setter. */
  voice?: { getValue: () => string; setValue: (value: string) => void };
}

const noopGet = () => '';
const noopSet = () => undefined;

export function ComposerTrailingButton({ labels, canSubmit, running, disabled = false, onSend, onStop, onQueue, sendSteers, voice }: ComposerTrailingButtonProps) {
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
  const label = running ? (sendSteers === false ? labels.queueHold : labels.queueSend) : labels.send;
  const send = (
    <button type="submit" className="bf-cmp-iconbtn bf-cmp-iconbtn--send" onClick={(e) => { e.preventDefault(); onSend(); }} disabled={!canSubmit || disabled} title={label} aria-label={label}>
      <IconSend />
    </button>
  );
  if (!(running && onQueue && canSubmit)) return send;
  const queueLabel = labels.queueAfter(queueShortcutKeys());
  return (
    <>
      <button type="button" className="bf-cmp-queuebtn" onClick={onQueue} disabled={disabled} title={queueLabel} aria-label={queueLabel}>
        <IconQueue />
        <span className="bf-cmp-queuebtn__text">{labels.queueAfterShort}</span>
      </button>
      {send}
    </>
  );
}
