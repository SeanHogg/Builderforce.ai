import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposerAttachment } from './AttachmentChips';
import { useUploadGate, type UploadGate } from './useUploadGate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; });

function harness() {
  const seen: { gate: UploadGate | null } = { gate: null };
  function Probe({ items }: { items: ComposerAttachment[] }) {
    seen.gate = useUploadGate(items);
    return null;
  }
  root = createRoot(document.createElement('div'));
  const render = (items: ComposerAttachment[]) => act(() => root!.render(<Probe items={items} />));
  return { seen, render };
}

const up = (status?: ComposerAttachment['status']): ComposerAttachment => ({ key: 'a', name: 'shot.png', ...(status ? { status } : {}) });

describe('the composer upload gate', () => {
  it('lets a send through when every attachment is uploaded', () => {
    const { seen, render } = harness();
    render([up()]);
    const send = vi.fn();
    expect(seen.gate!.intercept(send)).toBe(false);
    expect(seen.gate!.notice).toBeNull();
  });

  it('regression: a send while a file uploads is HELD, says so, and goes the moment the upload lands', () => {
    const { seen, render } = harness();
    render([up('uploading')]);
    const send = vi.fn();
    let held = false;
    act(() => { held = seen.gate!.intercept(send); });
    expect(held).toBe(true);
    expect(seen.gate!.notice).toBe('waiting');
    expect(send).not.toHaveBeenCalled();

    render([up()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(seen.gate!.notice).toBeNull();
  });

  it('never sends without a file whose upload failed — held or new', () => {
    const { seen, render } = harness();
    render([up('uploading')]);
    const send = vi.fn();
    act(() => { seen.gate!.intercept(send); });
    render([up('error')]);
    expect(send).not.toHaveBeenCalled();
    expect(seen.gate!.notice).toBe('failed');

    let refused = false;
    act(() => { refused = seen.gate!.intercept(send); });
    expect(refused).toBe(true);
    // Removing the failed chip clears the refusal.
    render([]);
    expect(seen.gate!.notice).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
