import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PendingQuestionBanner, type AskUserPayload } from './askUser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const payload: AskUserPayload = {
  question: 'Which PRD do you want to finish?',
  options: [{ label: 'PRD 33a' }, { label: 'Other PRD' }],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(onAnswer: (answer: string) => void): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<PendingQuestionBanner payload={payload} onAnswer={onAnswer} />));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('<PendingQuestionBanner>', () => {
  it('unpins itself once answered, without waiting for the transcript', () => {
    // Chat #133: the answer was taken, the banner stayed pinned over a chat that had
    // moved on — it reads as the click having failed.
    const onAnswer = vi.fn();
    const el = mount(onAnswer);
    const option = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('PRD 33a'));
    act(() => option!.click());
    expect(onAnswer).toHaveBeenCalledWith('PRD 33a');
    expect(el.querySelector('.bf-qpend')).toBeNull();
  });

  it('closes on its × without answering', () => {
    const onAnswer = vi.fn();
    const el = mount(onAnswer);
    const close = el.querySelector<HTMLButtonElement>('.bf-qpend__close');
    expect(close?.getAttribute('aria-label')).toBe('Dismiss');
    act(() => close!.click());
    expect(onAnswer).not.toHaveBeenCalled();
    expect(el.querySelector('.bf-qpend')).toBeNull();
  });
});
