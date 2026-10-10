import type { PromptTrailingAction } from '@seanhogg/builderforce-brain-ui';
import { IconMic, IconSend, IconStop } from './ChatMenu';

/**
 * The editor composer's ONE trailing button — mic, Send or Stop. WHICH one is the
 * shared `promptTrailingAction` (the same rule as the web composer), passed in; this
 * only draws it with the editor's own icons and copy. Send during a run queues the
 * message behind it, so its name says so.
 */
export function ComposerTrailingButton({ action, canSubmit, running, recording, onSend, onStop, onVoice, t }: {
  action: PromptTrailingAction;
  canSubmit: boolean;
  running: boolean;
  recording: boolean;
  onSend: () => void;
  onStop: () => void;
  onVoice: () => void;
  t: (key: string, fallback: string) => string;
}) {
  if (action === 'voice') {
    const label = recording ? t('app.stopDictation', 'Stop dictation') : t('app.dictate', 'Dictate');
    return (
      <button
        type="button"
        className={`bf-iconbtn bf-iconbtn--voice${recording ? ' is-listening' : ''}`}
        title={label}
        aria-label={label}
        aria-pressed={recording}
        onClick={onVoice}
      >
        <IconMic />
      </button>
    );
  }
  if (action === 'stop') {
    return (
      <button type="button" className="bf-iconbtn bf-iconbtn--stop" onClick={onStop} title={t('app.stop', 'Stop')} aria-label={t('app.stop', 'Stop')}>
        <IconStop />
      </button>
    );
  }
  const label = running
    ? t('app.queueSend', 'Queue message — sends when the current run finishes')
    : t('app.send', 'Send');
  return (
    <button type="button" className="bf-iconbtn bf-iconbtn--send" onClick={onSend} disabled={!canSubmit} title={label} aria-label={label}>
      <IconSend />
    </button>
  );
}
