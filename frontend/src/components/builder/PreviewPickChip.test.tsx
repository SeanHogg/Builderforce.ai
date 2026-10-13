import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { clearPreviewPicks, getPreviewPicks, setPreviewPick, setPreviewPicks, type PreviewPick } from '@/lib/workspace/previewPick';
import { PreviewPickChips } from './PreviewPickChip';

/**
 * The composer's chips: one per picked element — a source pick from a live preview
 * and the selector picks of Insights' "Apply in composer" side by side — each with
 * its own ×.
 */

const source: PreviewPick = {
  owner: 'local:app',
  appName: 'Phone plans',
  anchor: { kind: 'source', file: 'src/App.jsx', line: 12, column: 4, tag: 'h1', className: '', text: 'Hello World!' },
};
const element = (selector: string, label: string): PreviewPick => ({
  owner: 'surface:insights',
  appName: null,
  anchor: { kind: 'selector', selector, label, pagePath: '/pricing' },
});

afterEach(() => {
  cleanup();
  clearPreviewPicks();
});

describe('PreviewPickChips', () => {
  it('draws nothing while nothing is picked', () => {
    render(<PreviewPickChips />);
    expect(screen.queryByTestId('preview-pick-chip')).toBeNull();
  });

  it('draws one chip per pick, source and selector alike', () => {
    render(<PreviewPickChips />);
    act(() => {
      setPreviewPick(source);
      setPreviewPicks('surface:insights', [element('button.buy', 'Buy now'), element('#card input', '')]);
    });
    const chips = screen.getAllByTestId('preview-pick-chip');
    expect(chips.map((chip) => chip.getAttribute('data-anchor'))).toEqual(['source', 'selector', 'selector']);
    expect(chips[0]).toHaveTextContent('ide.previewPick.labelWithText h1 Hello World!');
    expect(chips[1]).toHaveTextContent('Buy now');
    expect(chips[1]).toHaveAttribute('title', 'ide.previewPick.whereSelector button.buy /pricing');
    // A masked element has no label; its selector names it.
    expect(chips[2]).toHaveTextContent('#card input');
  });

  it('× removes only that chip', () => {
    render(<PreviewPickChips />);
    act(() => setPreviewPicks('surface:insights', [element('button.buy', 'Buy now'), element('#hero h1', 'Plans')]));
    const first = screen.getAllByTestId('preview-pick-chip')[0]!;
    fireEvent.click(within(first).getByRole('button', { name: 'ide.previewPick.remove' }));
    expect(screen.getAllByTestId('preview-pick-chip')).toHaveLength(1);
    expect(getPreviewPicks().map((p) => p.anchor.kind === 'selector' && p.anchor.selector)).toEqual(['#hero h1']);
  });
});
