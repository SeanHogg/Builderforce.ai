import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerTrailingButton } from './ComposerTrailingButton';
import { composerLabelsFrom, DEFAULT_COMPOSER_LABELS } from './labels';

/**
 * Send's verb while a run streams names what Send will DO: a host whose turn door steers says
 * so (`queueSend`), and says "queue" (`queueHold`) the moment the message would be held - a
 * participant, a file a steer would drop, turns already waiting, a run being stopped.
 */
const noop = () => undefined;
const steerVerb = { ...DEFAULT_COMPOSER_LABELS, queueSend: 'Send into the running turn now' };

function sendButton(sendSteers?: boolean): string {
  return renderToStaticMarkup(
    <ComposerTrailingButton labels={steerVerb} canSubmit running onSend={noop} onStop={noop} onQueue={noop} {...(sendSteers !== undefined ? { sendSteers } : {})} />,
  );
}

describe('Send while a run streams', () => {
  it('reads as a steer where the door will steer (or the host does not say)', () => {
    expect(sendButton(true)).toContain('title="Send into the running turn now"');
    expect(sendButton()).toContain('title="Send into the running turn now"');
  });

  it('reads as a queue where the message would be held', () => {
    const html = sendButton(false);
    expect(html).toContain('title="Queue message');
    expect(html).not.toContain('title="Send into the running turn now"');
  });

  it('is plain Send with no run going', () => {
    const idle = renderToStaticMarkup(<ComposerTrailingButton labels={steerVerb} canSubmit running={false} onSend={noop} sendSteers={false} />);
    expect(idle).toContain('title="Send"');
  });

  it('takes the hold verb from a host catalog like every other label', () => {
    const labels = composerLabelsFrom((key) => (key === 'queueHold' ? 'Einreihen — wird nach dem Lauf gesendet' : undefined));
    expect(labels.queueHold).toBe('Einreihen — wird nach dem Lauf gesendet');
  });
});
