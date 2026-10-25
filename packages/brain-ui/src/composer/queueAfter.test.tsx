import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerTrailingButton, queueShortcutKeys } from './ComposerTrailingButton';
import { composerLabelsFrom, DEFAULT_COMPOSER_LABELS } from './labels';

/**
 * PRD 35 E10: where Send STEERS the running turn, "Queue for after" is a visible control
 * beside it — not only a shortcut nobody knows — and it names the platform's shortcut.
 */
const noop = () => undefined;

describe('"Queue for after" beside Send', () => {
  it('shows while a run is going and there is text to queue', () => {
    const html = renderToStaticMarkup(
      <ComposerTrailingButton labels={DEFAULT_COMPOSER_LABELS} canSubmit running onSend={noop} onStop={noop} onQueue={noop} />,
    );
    expect(html).toContain('bf-cmp-queuebtn');
    expect(html).toContain('Queue for after the run');
    expect(html).toContain('bf-cmp-iconbtn--send');
  });

  it('is absent with no run, with no text, or where the host does not steer', () => {
    const idle = renderToStaticMarkup(<ComposerTrailingButton labels={DEFAULT_COMPOSER_LABELS} canSubmit running={false} onSend={noop} onQueue={noop} />);
    const empty = renderToStaticMarkup(<ComposerTrailingButton labels={DEFAULT_COMPOSER_LABELS} canSubmit={false} running onSend={noop} onStop={noop} onQueue={noop} />);
    const noSteer = renderToStaticMarkup(<ComposerTrailingButton labels={DEFAULT_COMPOSER_LABELS} canSubmit running onSend={noop} onStop={noop} />);
    for (const html of [idle, empty, noSteer]) expect(html).not.toContain('bf-cmp-queuebtn');
  });

  it('spells the shortcut per platform', () => {
    expect(queueShortcutKeys({ platform: 'MacIntel' })).toBe('⌥+Enter');
    expect(queueShortcutKeys({ userAgentData: { platform: 'macOS' } })).toBe('⌥+Enter');
    expect(queueShortcutKeys({ platform: 'Win32' })).toBe('Alt+Enter');
    expect(queueShortcutKeys({ platform: 'Linux x86_64' })).toBe('Alt+Enter');
    expect(queueShortcutKeys(undefined)).toBe('Alt+Enter');
  });

  it('reads its copy from the host catalog, the shortcut filled in', () => {
    const labels = composerLabelsFrom((key, values) => (key === 'queueAfter' ? `Einreihen (${values?.keys})` : key === 'queueAfterShort' ? 'Einreihen' : undefined));
    expect(labels.queueAfter('⌥+Enter')).toBe('Einreihen (⌥+Enter)');
    expect(labels.queueAfterShort).toBe('Einreihen');
    expect(composerLabelsFrom(() => undefined).queueAfter('Alt+Enter')).toBe('Queue for after the run (Alt+Enter)');
  });
});
