import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToolConfirmBar } from '../ToolConfirmBar';
import { PrefetchAnswerChips, PrefetchConfirmChip, prefetchChipLabelsFrom } from './PrefetchChips';
import { buildTimeline } from '../timelineModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(el: ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** A PreFetch write action's pending confirm, as the run store raises it. */
const pending = { name: 'lint.fix', args: { prefetch: true, labelKey: 'prefetch.action.lint.fix', request: '/lint-fix' } };
const labelOf = (key: string) => ({ 'prefetch.action.lint.fix': 'Lint auto-fix', 'prefetch.chip.openInGraph': 'Open in graph' } as Record<string, string>)[key];
const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')];

describe('<PrefetchConfirmChip>', () => {
  it('renders the action by name with Run and Dismiss, and no "always" lever', () => {
    const el = mount(<PrefetchConfirmChip confirm={{ actionId: 'lint.fix', labelKey: 'prefetch.action.lint.fix', request: '/lint-fix' }} onConfirm={() => {}} onDismiss={() => {}} labelOf={labelOf} />);
    const chip = el.querySelector('.bf-prefetch-confirm')!;
    expect(chip.getAttribute('role')).toBe('group');
    expect(chip.textContent).toContain('Lint auto-fix');
    expect(chip.textContent).toContain('/lint-fix');
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Run', 'Dismiss']);
    expect(document.activeElement?.textContent).toBe('Run');
  });

  it('confirms on Run and dismisses on Dismiss or Escape', () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    const el = mount(<PrefetchConfirmChip confirm={{ actionId: 'lint.fix', labelKey: 'prefetch.action.lint.fix', request: '' }} onConfirm={onConfirm} onDismiss={onDismiss} />);
    act(() => buttons(el)[0]!.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    act(() => buttons(el)[1]!.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => { el.querySelector('.bf-prefetch-confirm')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('reads its copy from a host catalog', () => {
    const labels = prefetchChipLabelsFrom((key) => (key === 'confirm' ? 'Ausführen' : undefined));
    expect(labels.confirm).toBe('Ausführen');
    expect(labels.dismiss).toBe('Dismiss');
  });
});

describe('<ToolConfirmBar> with a PreFetch confirm', () => {
  it('renders the chip instead of the tool bar, answering through the same handlers', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const onApproveAll = vi.fn();
    const el = mount(<ToolConfirmBar req={pending} onApprove={onApprove} onDeny={onDeny} onApproveAll={onApproveAll} prefetchLabelOf={labelOf} />);
    expect(el.querySelector('.bf-confirm')).toBeNull();
    expect(el.querySelector('.bf-prefetch-confirm')).not.toBeNull();
    // Never "always": a write action is confirmed every time.
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Run', 'Dismiss']);
    act(() => buttons(el)[0]!.click());
    expect(onApprove).toHaveBeenCalledTimes(1);
    act(() => buttons(el)[1]!.click());
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApproveAll).not.toHaveBeenCalled();
  });

  it('goes away when the run stops (the pending confirm is cleared) and a tool confirm keeps its bar', () => {
    const el = mount(<ToolConfirmBar req={pending} onApprove={() => {}} onDeny={() => {}} />);
    expect(el.querySelector('.bf-prefetch-confirm')).not.toBeNull();
    // Stop declines the confirm and clears `pendingConfirm`: the host stops rendering the bar.
    act(() => root!.render(<></>));
    expect(el.querySelector('.bf-prefetch-confirm')).toBeNull();
    act(() => root!.render(<ToolConfirmBar req={{ name: 'run_command', args: { command: 'ls' } }} onApprove={() => {}} onDeny={() => {}} />));
    expect(el.querySelector('.bf-confirm')).not.toBeNull();
    expect(el.querySelector('.bf-prefetch-confirm')).toBeNull();
  });
});

describe('<PrefetchAnswerChips>', () => {
  it('renders each chip by its label and hands it back on click', () => {
    const onChip = vi.fn();
    const chip = { labelKey: 'prefetch.chip.openInGraph', command: 'builderforce.openKnowledgeGraph', args: { focus: ['src:r::a.ts'] } };
    const el = mount(<PrefetchAnswerChips chips={[chip]} onChip={onChip} labelOf={labelOf} />);
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Open in graph']);
    act(() => buttons(el)[0]!.click());
    expect(onChip).toHaveBeenCalledWith(chip);
  });

  it('a PreFetch answer step becomes a prefetch answer node carrying its chips', () => {
    const chip = { labelKey: 'prefetch.chip.openInGraph', command: 'builderforce.openKnowledgeGraph', args: { focus: ['src:r::a.ts'] } };
    const nodes = buildTimeline({
      messages: [],
      trace: [{ ts: '2026-10-28T00:00:00.000Z', category: 'recall', label: 'dup.check', args: {}, result: { source: 'dup.check', route: 'answer', skippedLlm: true, chips: [chip] } }] as never,
      streamingText: '',
      isRunning: false,
    });
    const node = nodes.find((n) => n.kind === 'memoryAnswer');
    expect(node).toMatchObject({ source: 'prefetch', actionId: 'dup.check', chips: [chip] });
  });
});
