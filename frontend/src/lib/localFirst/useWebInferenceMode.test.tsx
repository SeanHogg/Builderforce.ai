// @vitest-environment jsdom
/**
 * THE web's mode as the composer and the first-run gate read it (`useWebInferenceMode`),
 * and THE web turn door over it (`useWebTurnGate`). The reported failure: a landing prompt
 * on Studio ran on Local only with no model on the device, before anyone was asked. These
 * pin the two halves of the answer — who DEFAULTS to what (a signed-in owner opening a
 * local Studio board is on Hybrid, never Local only), and that whoever never chose is asked
 * before the turn runs, with the held turn sent once they answer.
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWebInferenceMode, useWebTurnGate } from './useWebInferenceMode';
import { WEB_INFERENCE_MODE_STORAGE_KEY, webInferenceModeNow } from './webInferenceMode';

function mount(ui: ReactElement): () => void {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root!: Root;
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  return () => {
    act(() => { root.unmount(); });
    el.remove();
  };
}

afterEach(() => { window.localStorage.clear(); });

describe('useWebInferenceMode', () => {
  it('defaults a signed-in owner to Hybrid — a local Studio board does not make them anonymous', () => {
    window.localStorage.setItem('bf_web_token', 'web-token');
    let seen!: ReturnType<typeof useWebInferenceMode>;
    function Probe() { seen = useWebInferenceMode(); return null; }
    const unmount = mount(<Probe />);
    expect(seen.signedIn).toBe(true);
    expect(seen.value).toBe('hybrid');
    expect(webInferenceModeNow()).toBe('hybrid');
    // Never chosen: asked once all the same — for a signed-in person it confirms Hybrid.
    expect(seen.needsChoice).toBe(true);
    unmount();
  });

  it('defaults an anonymous visitor to Local only, and asks them', () => {
    let seen!: ReturnType<typeof useWebInferenceMode>;
    function Probe() { seen = useWebInferenceMode(); return null; }
    const unmount = mount(<Probe />);
    expect(seen.signedIn).toBe(false);
    expect(seen.value).toBe('local-only');
    expect(seen.needsChoice).toBe(true);
    unmount();
  });
});

describe('useWebTurnGate — THE web turn door', () => {
  it('holds a turn until the person chooses, then applies the mode and sends it', async () => {
    let door!: ReturnType<typeof useWebTurnGate>;
    function Probe() { door = useWebTurnGate(); return null; }
    const unmount = mount(<Probe />);
    const send = vi.fn();
    let ranNow = true;
    act(() => { ranNow = door.gate.request(send); });
    expect(ranNow).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(door.gate.asking).toBe(true);

    await act(async () => { door.gate.choose('local-only'); });

    expect(send).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(WEB_INFERENCE_MODE_STORAGE_KEY)).toBe('local-only');
    expect(door.gate.asking).toBe(false);
    // Chosen: the next turn goes straight through.
    act(() => { ranNow = door.gate.request(send); });
    expect(ranNow).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    unmount();
  });
});
