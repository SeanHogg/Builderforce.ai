import { describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import { PromptOptionsMenu } from '../promptOptions/PromptOptionsMenu';
import { BrainComposer } from '../composer/BrainComposer';
import { ChatErrorBanner } from '../ChatErrorBanner';
import { DEFAULT_PROMPT_OPTIONS_LABELS, promptOptionsLabelsFrom } from '../promptOptions/types';
import { DEFAULT_INFERENCE_MODE_LABELS, INFERENCE_MODE_LABEL_FIELDS } from './labels';
import { requestComposerMenu, useComposerMenuRequest } from '../promptOptions/composerMenuRequest';
import { useInferenceModeGate, type InferenceModeGate } from './useInferenceModeGate';
import { inferenceModeOption, modelRemedies } from './modelRemedies';
import type { PromptOptionsInferenceMode } from './InferenceModeControl';

function mount(ui: ReactElement): { el: HTMLDivElement; rerender: (next: ReactElement) => void; unmount: () => void } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root;
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  return {
    el,
    rerender: (next) => act(() => { root.render(next); }),
    unmount: () => {
      act(() => { root.unmount(); });
      el.remove();
    },
  };
}

const buttonNamed = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('inference mode labels', () => {
  it('ride the `/` menu key table, so every host maps them through one lookup', () => {
    for (const field of INFERENCE_MODE_LABEL_FIELDS) {
      expect(DEFAULT_PROMPT_OPTIONS_LABELS[field]).toBe(DEFAULT_INFERENCE_MODE_LABELS[field]);
    }
    const fr = promptOptionsLabelsFrom((key) => (key === 'inferenceModeLocalOnly' ? 'Local uniquement' : undefined));
    expect(fr.inferenceModeLocalOnly).toBe('Local uniquement');
    expect(fr.inferenceModeHybrid).toBe('Hybrid');
  });
});

describe('<InferenceModeControl> in the Model tab', () => {
  it('lists the three modes with their one-line descriptions and reports a pick', () => {
    const onChange = vi.fn();
    const { el, unmount } = mount(<PromptOptionsMenu inferenceMode={{ value: 'hybrid', onChange }} />);
    act(() => { (el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    const group = el.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.getAttribute('aria-label')).toBe('Run models');
    const radios = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(radios).toHaveLength(3);
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    expect(group.textContent).toContain(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeLocalOnlyHint);
    expect(group.textContent).toContain(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeSpecificHint);
    act(() => { (radios[1] as HTMLButtonElement).click(); });
    expect(onChange).toHaveBeenCalledWith('local-only');
    unmount();
  });

  it('is not offered when the host wires no mode', () => {
    const { el, unmount } = mount(<PromptOptionsMenu effort="balanced" onEffortChange={() => {}} />);
    act(() => { (el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    expect(el.querySelector('[role="radiogroup"]')).toBeNull();
    expect(el.querySelector('[role="tablist"]')?.textContent).not.toContain('Model');
    unmount();
  });
});

describe('<PromptOptionsMenu openOn>', () => {
  it('opens on the requested tab for each NEW token, never for the one it mounted with', () => {
    const props = { inferenceMode: { value: 'hybrid' as const, onChange: () => {} }, effort: 'balanced' as const, onEffortChange: () => {} };
    const { el, rerender, unmount } = mount(<PromptOptionsMenu {...props} openOn={{ tab: 'model', token: 1 }} />);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    rerender(<PromptOptionsMenu {...props} openOn={{ tab: 'model', token: 2 }} />);
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    expect(el.querySelector('#bf-pmenu-tab-model')?.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[role="radiogroup"]')).toBeTruthy();
    unmount();
  });
});

describe('<BrainComposer> first-run question', () => {
  it('holds the first turn until a mode is chosen, then applies it and sends', async () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const ui = (needsChoice: boolean) => (
      <BrainComposer
        value="hello"
        onChange={() => {}}
        onSubmit={onSubmit}
        options={{ inferenceMode: { value: 'hybrid', onChange, needsChoice } }}
      />
    );
    const { el, unmount } = mount(ui(true));
    const send = el.querySelector('textarea') as HTMLTextAreaElement;
    act(() => { send.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(el.textContent).toContain(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeAskTitle);
    const localOnly = el.querySelector('.bf-imode-ask__choice:not(.is-recommended)') as HTMLButtonElement;
    await act(async () => { localOnly.click(); });
    expect(onChange).toHaveBeenCalledWith('local-only');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(el.textContent).not.toContain(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeAskTitle);
    unmount();
  });

  it('sends at once when a mode is already chosen', () => {
    const onSubmit = vi.fn();
    const { el, unmount } = mount(
      <BrainComposer value="hello" onChange={() => {}} onSubmit={onSubmit} options={{ inferenceMode: { value: 'local-only', onChange: () => {} } }} />,
    );
    act(() => { (el.querySelector('textarea') as HTMLTextAreaElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.bf-imode-ask')).toBeNull();
    unmount();
  });
});

describe("useInferenceModeGate — THE first-run gate, shared by Send and a host's own send", () => {
  /** A host that owns the gate (the guest panel): it starts a turn itself, and hands the gate to the composer. */
  function Host({ mode, onReady, onSubmit }: { mode: PromptOptionsInferenceMode; onReady: (gate: InferenceModeGate) => void; onSubmit: () => void }) {
    const gate = useInferenceModeGate(mode);
    onReady(gate);
    return <BrainComposer value="" onChange={() => {}} onSubmit={onSubmit} options={{ inferenceMode: mode }} modeGate={gate} />;
  }

  it("holds a host's programmatic send behind the composer's question, then applies the mode and sends", async () => {
    const onChange = vi.fn();
    const sent = vi.fn();
    let gate!: InferenceModeGate;
    const { el, unmount } = mount(<Host mode={{ value: 'local-only', onChange, needsChoice: true }} onReady={(g) => { gate = g; }} onSubmit={() => {}} />);
    let ranNow = true;
    act(() => { ranNow = gate.request(sent); });
    expect(ranNow).toBe(false);
    expect(sent).not.toHaveBeenCalled();
    expect(el.textContent).toContain(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeAskTitle);
    const hybrid = el.querySelector('.bf-imode-ask__choice.is-recommended') as HTMLButtonElement;
    await act(async () => { hybrid.click(); });
    expect(onChange).toHaveBeenCalledWith('hybrid');
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(sent.mock.invocationCallOrder[0]!);
    expect(sent).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('sends a held turn when the mode is chosen elsewhere (the / menu), and at once when no choice is needed', () => {
    const sent = vi.fn();
    let gate!: InferenceModeGate;
    const ui = (needsChoice: boolean) => <Host mode={{ value: 'local-only', onChange: () => {}, needsChoice }} onReady={(g) => { gate = g; }} onSubmit={() => {}} />;
    const { rerender, unmount } = mount(ui(true));
    act(() => { gate.request(sent); });
    expect(sent).not.toHaveBeenCalled();
    act(() => { rerender(ui(false)); });
    expect(sent).toHaveBeenCalledTimes(1);
    act(() => { gate.request(sent); });
    expect(sent).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('keeps EVERY held send, in order, and the answer opens the gate before the host re-renders', async () => {
    let gate!: InferenceModeGate;
    const order: string[] = [];
    // A host whose mode store has not re-rendered yet: needsChoice stays true after the pick.
    const { el, unmount } = mount(<Host mode={{ value: 'local-only', onChange: () => {}, needsChoice: true }} onReady={(g) => { gate = g; }} onSubmit={() => {}} />);
    act(() => { gate.request(() => order.push('landing')); });
    act(() => { gate.request(() => order.push('typed')); });
    expect(order).toEqual([]);
    const hybrid = el.querySelector('.bf-imode-ask__choice.is-recommended') as HTMLButtonElement;
    await act(async () => { hybrid.click(); });
    expect(order).toEqual(['landing', 'typed']);
    // A held send that passes the gate again (a door behind a composer) runs now — never held twice.
    let ranNow = false;
    act(() => { ranNow = gate.request(() => order.push('nested')); });
    expect(ranNow).toBe(true);
    expect(order).toEqual(['landing', 'typed', 'nested']);
    expect(el.textContent).not.toContain(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeAskTitle);
    unmount();
  });
});

describe('modelRemedies — THE no-model remedies every host renders', () => {
  it('Switch to Hybrid applies the mode first, then re-sends the refused turn', async () => {
    const calls: string[] = [];
    const remedies = modelRemedies({
      mode: 'local-only',
      setMode: async (mode) => { calls.push(`mode:${mode}`); },
      composerId: 'c-remedy',
      onDismiss: () => calls.push('dismiss'),
      retry: () => calls.push('retry'),
    });
    await act(async () => { remedies.onSwitchToHybrid!(); });
    expect(calls).toEqual(['dismiss', 'mode:hybrid', 'retry']);
  });

  it("offers no Switch to Hybrid off Local only; Download and Pick open THIS composer's Model tab", () => {
    const onDismiss = vi.fn();
    const remedies = modelRemedies({ mode: 'hybrid', setMode: () => {}, composerId: 'c-remedy-2', onDismiss });
    expect(remedies.onSwitchToHybrid).toBeUndefined();
    function Probe({ onRequest }: { onRequest: (tab: string | undefined) => void }) {
      onRequest(useComposerMenuRequest('c-remedy-2')?.tab);
      return null;
    }
    const seen: Array<string | undefined> = [];
    const { unmount } = mount(<Probe onRequest={(tab) => seen.push(tab)} />);
    act(() => { remedies.onPickModel!(); });
    expect(seen.at(-1)).toBe('model');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    const download = vi.fn();
    modelRemedies({ mode: 'local-only', setMode: () => {}, composerId: 'x', onDismiss, downloadLocalModel: download }).onDownloadLocalModel!();
    expect(download).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('inferenceModeOption asks anyone who never chose — signed in or not', () => {
    expect(inferenceModeOption({ value: 'local-only', chosen: false, onChange: () => {} }).needsChoice).toBe(true);
    expect(inferenceModeOption({ value: 'hybrid', chosen: true, onChange: () => {} }).needsChoice).toBe(false);
  });
});

describe('<ChatErrorBanner> no_local_model', () => {
  it('never asks a signed-in / Local only person to sign in — offers Hybrid and a download', () => {
    const onSwitchToHybrid = vi.fn();
    const onDownloadLocalModel = vi.fn();
    const onSignIn = vi.fn();
    const { el, unmount } = mount(
      <ChatErrorBanner
        error="no_local_model"
        action={{ kind: 'no_local_model' }}
        onDismiss={() => {}}
        onSignIn={onSignIn}
        onSwitchToHybrid={onSwitchToHybrid}
        onDownloadLocalModel={onDownloadLocalModel}
      />,
    );
    expect(el.textContent).not.toContain('no_local_model');
    expect(el.textContent).not.toContain('Sign in');
    act(() => { buttonNamed(el, 'Switch to Hybrid').click(); });
    act(() => { buttonNamed(el, 'Download a local model').click(); });
    expect(onSwitchToHybrid).toHaveBeenCalledTimes(1);
    expect(onDownloadLocalModel).toHaveBeenCalledTimes(1);
    expect(onSignIn).not.toHaveBeenCalled();
    unmount();
  });

  it('offers only the download when the host gives no Hybrid switch (already on Hybrid)', () => {
    const { el, unmount } = mount(
      <ChatErrorBanner error="no_local_model" action={{ kind: 'no_local_model' }} onDismiss={() => {}} onDownloadLocalModel={() => {}} />,
    );
    expect(buttonNamed(el, 'Switch to Hybrid')).toBeUndefined();
    expect(buttonNamed(el, 'Download a local model')).toBeTruthy();
    unmount();
  });
});

describe('<InferenceModeControl> keyboard', () => {
  const open = (value: 'hybrid' | 'local-only' | 'specific') => {
    const view = mount(<PromptOptionsMenu inferenceMode={{ value, onChange: () => {} }} />);
    act(() => { (view.el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    const radios = Array.from(view.el.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];
    return { ...view, radios };
  };
  const press = (target: HTMLElement, key: string) => {
    act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
  };

  it('is ONE tab stop — the checked mode — and the Arrow, Home and End keys move between modes', () => {
    const { radios, unmount } = open('local-only');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    radios[1]!.focus();
    press(radios[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(radios[2]);
    press(radios[2]!, 'ArrowDown');
    expect(document.activeElement).toBe(radios[0]);
    press(radios[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(radios[2]);
    press(radios[2]!, 'Home');
    expect(document.activeElement).toBe(radios[0]);
    press(radios[0]!, 'End');
    expect(document.activeElement).toBe(radios[2]);
    unmount();
  });

  it('moving focus never chooses — only a press does', () => {
    const onChange = vi.fn();
    const view = mount(<PromptOptionsMenu inferenceMode={{ value: 'hybrid', onChange }} />);
    act(() => { (view.el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    const radios = Array.from(view.el.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];
    press(radios[0]!, 'ArrowDown');
    expect(onChange).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('<BrainComposer> first-run question a11y', () => {
  it('takes focus, announces itself politely, and labels itself with a generated id', async () => {
    const { el, unmount } = mount(
      <BrainComposer value="hello" onChange={() => {}} onSubmit={() => {}} options={{ inferenceMode: { value: 'hybrid', onChange: () => {}, needsChoice: true } }} />,
    );
    act(() => { (el.querySelector('textarea') as HTMLTextAreaElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    const ask = el.querySelector('.bf-imode-ask') as HTMLElement;
    expect(ask).toBeTruthy();
    expect(document.activeElement).toBe(ask.querySelector('.bf-imode-ask__choice.is-recommended'));
    const live = ask.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toContain(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeAskTitle);
    const labelledBy = ask.getAttribute('aria-labelledby')!;
    expect(labelledBy).not.toBe('bf-imode-ask-title');
    expect(document.getElementById(labelledBy)?.textContent).toBe(DEFAULT_INFERENCE_MODE_LABELS.inferenceModeAskTitle);
    unmount();
  });
});

describe('<ChatErrorBanner> no_specific_model', () => {
  it('says why and offers "Pick a model" — never a sign-in prompt or the raw code', () => {
    const onPickModel = vi.fn();
    const { el, unmount } = mount(
      <ChatErrorBanner error="no_specific_model" action={{ kind: 'no_specific_model' }} onDismiss={() => {}} onSignIn={() => {}} onPickModel={onPickModel} />,
    );
    expect(el.textContent).not.toContain('no_specific_model');
    expect(el.textContent).not.toContain('Sign in');
    act(() => { buttonNamed(el, 'Pick a model').click(); });
    expect(onPickModel).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('requestComposerMenu', () => {
  it('opens ONLY the composer that raised the remedy', () => {
    const props = { inferenceMode: { value: 'hybrid' as const, onChange: () => {} } };
    function Keyed({ id }: { id: string }) {
      const openOn = useComposerMenuRequest(id);
      return <div data-composer={id}><PromptOptionsMenu {...props} {...(openOn ? { openOn } : {})} /></div>;
    }
    const { el, unmount } = mount(<><Keyed id="a" /><Keyed id="b" /></>);
    act(() => { requestComposerMenu('b'); });
    expect(el.querySelector('[data-composer="a"] [role="dialog"]')).toBeNull();
    expect(el.querySelector('[data-composer="b"] [role="dialog"]')).toBeTruthy();
    expect(el.querySelector('[data-composer="b"] #bf-pmenu-tab-model')?.getAttribute('aria-selected')).toBe('true');
    unmount();
  });
});

describe('picking a model never changes the mode', () => {
  it('reports the pick through the model onChange only — Specific is chosen in the mode control', () => {
    const onModel = vi.fn();
    const onMode = vi.fn();
    const { el, unmount } = mount(
      <PromptOptionsMenu
        inferenceMode={{ value: 'hybrid', onChange: onMode }}
        model={{
          selection: { mode: 'auto' },
          options: { byo: [], free: ['meta/llama'], plan: [], paid: [] },
          onChange: onModel,
          identity: { product: 'pro', canChoose: true },
        }}
      />,
    );
    act(() => { (el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    const item = Array.from(el.querySelectorAll('button')).find(
      (b) => b.getAttribute('role') !== 'radio' && /llama/i.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    expect(item).toBeTruthy();
    act(() => { item.click(); });
    expect(onModel).toHaveBeenCalled();
    expect(onMode).not.toHaveBeenCalled();
    unmount();
  });
});

describe('<ChatErrorBanner> local_engine_failed', () => {
  it('names a crash and a detach in the host language, never the raw code', () => {
    const crashed = mount(
      <ChatErrorBanner
        error="bfi_engine_crashed: RuntimeError: unreachable"
        action={{ kind: 'local_engine_failed', engineCode: 'bfi_engine_crashed' }}
        onDismiss={() => {}}
        labels={{ engineCrashed: 'Crashed (localized)' }}
      />,
    );
    expect(crashed.el.textContent).toContain('Crashed (localized)');
    expect(crashed.el.textContent).not.toContain('bfi_engine_crashed');
    crashed.unmount();
    const detached = mount(
      <ChatErrorBanner error="page_engine_detached: gone" action={{ kind: 'local_engine_failed', engineCode: 'page_engine_detached' }} onDismiss={() => {}} />,
    );
    expect(detached.el.textContent).toContain('stopped before it finished');
    detached.unmount();
  });

  it('offers "Pick a model" and "Manage on-device models" for a model that keeps crashing', () => {
    const onPickModel = vi.fn();
    const onDownloadLocalModel = vi.fn();
    const { el, unmount } = mount(
      <ChatErrorBanner
        error="model_keeps_crashing: bonsai-8b"
        action={{ kind: 'local_engine_failed', engineCode: 'model_keeps_crashing' }}
        onDismiss={() => {}}
        onPickModel={onPickModel}
        onDownloadLocalModel={onDownloadLocalModel}
      />,
    );
    expect(el.textContent).toContain('keeps crashing on this device');
    act(() => { buttonNamed(el, 'Pick a model').click(); });
    act(() => { buttonNamed(el, 'Manage on-device models').click(); });
    expect(onPickModel).toHaveBeenCalledTimes(1);
    expect(onDownloadLocalModel).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('<ChatErrorBanner> platform_refused', () => {
  it('names the mode and offers "Switch to Hybrid" — never the raw platform_send_disabled code', () => {
    const onSwitchToHybrid = vi.fn();
    const { el, unmount } = mount(
      <ChatErrorBanner
        error="agent.run failed: platform_send_disabled"
        action={{ kind: 'platform_refused', capability: 'send', setting: 'inferenceMode' }}
        onDismiss={() => {}}
        onSwitchToHybrid={onSwitchToHybrid}
        labels={{ platformRefusedMode: 'Local only keeps this on the device.' }}
      />,
    );
    expect(el.textContent).not.toContain('platform_send_disabled');
    expect(el.textContent).toContain('Local only keeps this on the device.');
    act(() => { buttonNamed(el, 'Switch to Hybrid').click(); });
    expect(onSwitchToHybrid).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('names the sync switch for a sync refusal, and offers no mode switch', () => {
    const { el, unmount } = mount(
      <ChatErrorBanner
        error="platform_synchronize_disabled"
        action={{ kind: 'platform_refused', capability: 'synchronize', setting: 'synchronize' }}
        onDismiss={() => {}}
        onSwitchToHybrid={() => {}}
      />,
    );
    expect(el.textContent).not.toContain('platform_synchronize_disabled');
    expect(el.textContent).toContain('Account sync is off');
    expect(buttonNamed(el, 'Switch to Hybrid')).toBeUndefined();
    unmount();
  });
});
