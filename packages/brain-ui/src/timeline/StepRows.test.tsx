import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ErrorRow } from './StepRows';
import { DEFAULT_TIMELINE_LABELS } from './labels';
import { timelineLabelsFrom } from '../timelineCatalog';

function renderRow(message: string, labels = DEFAULT_TIMELINE_LABELS): string {
  const el = document.createElement('ul');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<ErrorRow node={{ key: 'e', kind: 'error', ts: 0, order: 0, label: 'agent.run', message }} labels={labels} />);
  });
  const text = el.textContent ?? '';
  act(() => root.unmount());
  el.remove();
  return text;
}

describe('<ErrorRow> — the transcript reads a failure through the banner verdict', () => {
  it('never shows the raw platform_send_disabled code; says the same sentence as the banner', () => {
    const text = renderRow('agent.run failed: platform_send_disabled');
    expect(text).not.toContain('platform_send_disabled');
    expect(text).toContain('Local only keeps this run on this device');
  });

  it("reads the host's localized sentence from the catalog's chatError.<field>", () => {
    const labels = timelineLabelsFrom((key) => (key === 'chatError.platformRefusedSync' ? 'Sync ist aus.' : undefined));
    expect(renderRow('platform_synchronize_disabled', labels)).toContain('Sync ist aus.');
  });

  it("keeps the server's own words when no verdict names the case", () => {
    expect(renderRow('The provider returned 500.')).toContain('The provider returned 500.');
  });
});
