import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createComposerCommandRegistry,
  createComposerDraftStore,
  type ComposerDraftStore,
  type DirectedRecipient,
} from '@seanhogg/builderforce-brain-embedded';
import { BrainComposer } from '../composer/BrainComposer';
import type { PromptOptionsCommands } from '../promptOptions/ActionsPane';
import { activeCommandToken, commandPickEdit, filterCommandEntries } from './CommandAutocomplete';

/**
 * The ONE trigger typeahead (`useTriggerAutocomplete`) and its three adapters, driven through the real composer:
 * `/` lists the host's commands the moment it starts the line, `@` / `#` open on the bare trigger, a pick edits the
 * text, Enter picks instead of submitting, and an empty list still shows that the trigger was recognised.
 */

const registry = createComposerCommandRegistry(
  [
    {
      id: 'starter-kit',
      syntax: '/starter-kit <kit>',
      args: [{ name: 'kit', required: true, choices: [{ value: 'react-node' }] }],
      example: '/starter-kit react-node',
    },
    { id: 'status', syntax: '/status', args: [], example: '/status' },
    {
      id: 'launch',
      syntax: '/launch',
      args: [],
      example: '/launch',
      availability: { ok: false, reason: 'Only in the VS Code extension' },
    },
  ],
  { describe: (id) => `About ${id}` },
);
const help = registry.help();
const entry = (id: string) => help.entries.find((e) => e.id === id)!;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  }
});

describe('activeCommandToken (the `/` command position)', () => {
  it('opens on a bare `/` that starts the text, and on the name being typed', () => {
    expect(activeCommandToken('/', 1)).toEqual({ query: '', start: 0, end: 1 });
    expect(activeCommandToken('/sta', 4)).toEqual({ query: 'sta', start: 0, end: 4 });
    expect(activeCommandToken('  /sta', 6)).toEqual({ query: 'sta', start: 2, end: 6 });
  });

  it('runs the token to the end of the name, so a pick replaces all of it', () => {
    expect(activeCommandToken('/status', 3)).toEqual({ query: 'st', start: 0, end: 7 });
  });

  it('regression: never opens for the `//` escape, a path or a `/` mid-sentence', () => {
    expect(activeCommandToken('//', 1)).toBeNull();
    expect(activeCommandToken('//', 2)).toBeNull();
    expect(activeCommandToken('//not a command', 5)).toBeNull();
    expect(activeCommandToken('/api/users', 4)).toBeNull();
    expect(activeCommandToken('GET api/users', 8)).toBeNull();
    expect(activeCommandToken('please run /status', 18)).toBeNull();
  });

  it('closes once the name is complete and a space is typed', () => {
    expect(activeCommandToken('/starter-kit ', 13)).toBeNull();
    expect(activeCommandToken('/starter-kit react', 18)).toBeNull();
  });
});

describe('filterCommandEntries', () => {
  it('lists every command for an empty query', () => {
    expect(filterCommandEntries(help.entries, '')).toBe(help.entries);
  });

  it('ranks an id prefix before an id substring', () => {
    // `help` is registered before `launch`; only `launch` STARTS with "l".
    expect(filterCommandEntries(help.entries, 'l').map((e) => e.id)).toEqual(['launch', 'help']);
    expect(filterCommandEntries(help.entries, 'st').map((e) => e.id)).toEqual(['starter-kit', 'status']);
    expect(filterCommandEntries(help.entries, 'kit').map((e) => e.id)).toEqual(['starter-kit']);
    expect(filterCommandEntries(help.entries, 'zzz')).toEqual([]);
  });

  it('regression: an exact id match ranks first (`stop` before `stop-all`, whatever the registry order)', () => {
    const stops = createComposerCommandRegistry(
      [
        { id: 'stop-all', syntax: '/stop-all', args: [], example: '/stop-all' },
        { id: 'stop', syntax: '/stop', args: [], example: '/stop' },
      ],
      { describe: (id) => `About ${id}` },
    ).help().entries;
    expect(filterCommandEntries(stops, 'stop').map((e) => e.id)).toEqual(['stop', 'stop-all']);
    expect(filterCommandEntries(stops, 'sto').map((e) => e.id)).toEqual(['stop-all', 'stop']);
  });
});

describe('commandPickEdit', () => {
  it('clears the typed name for a runnable entry (the host runs it)', () => {
    expect(commandPickEdit(entry('status'), { query: 'st', start: 0, end: 3 }, '/st')).toEqual({ text: '', caret: 0 });
  });

  it('puts insertText in the box, caret after it, for an entry that needs arguments', () => {
    const kit = entry('starter-kit');
    expect(kit.runnable).toBe(false);
    expect(commandPickEdit(kit, { query: 'sta', start: 0, end: 4 }, '/sta')).toEqual({ text: kit.insertText, caret: kit.insertText.length });
  });
});

// ── Through the real composer ────────────────────────────────────────────────

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(props: {
  store: ComposerDraftStore;
  onSubmit?: () => void;
  commands?: PromptOptionsCommands;
  participants?: DirectedRecipient[];
  tickets?: Array<{ id: number; title: string; key?: string }>;
}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const options = props.commands ? { commands: props.commands } : {};
  act(() => {
    root = createRoot(host!);
    root.render(
      <BrainComposer
        draftStore={props.store}
        onSubmit={props.onSubmit ?? (() => undefined)}
        options={options}
        {...(props.participants ? { mentions: { participants: props.participants, onPick: () => undefined } } : {})}
        {...(props.tickets ? { tickets: { tickets: props.tickets, onPick: () => undefined } } : {})}
      />,
    );
  });
  return host.querySelector('textarea')!;
}

function type(textarea: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Fire a keydown; returns the event so a test can see whether the typeahead claimed it (`defaultPrevented`). */
function press(textarea: HTMLTextAreaElement, key: string, init: KeyboardEventInit & { keyCode?: number } = {}): KeyboardEvent {
  const { keyCode, ...rest } = init;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...rest });
  if (keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: keyCode });
  act(() => { textarea.dispatchEvent(event); });
  return event;
}

/** Let the pick's caret frame (requestAnimationFrame) run. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
}

const listbox = () => host!.querySelector('[role="listbox"]');
const emptyRow = () => host!.querySelector('[role="status"]');

const options = () => Array.from(host!.querySelectorAll('[role="option"]')).map((o) => o.textContent ?? '');
const selected = () => host!.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? '';

describe('`/` typeahead in the composer', () => {
  it('regression: lists every command as soon as `/` is typed — no Enter needed', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, commands: { help, onChoose: vi.fn() } });
    type(textarea, '/');
    expect(options()).toHaveLength(help.entries.length);
    expect(host!.textContent).toContain('/starter-kit <kit>');
    expect(host!.textContent).toContain('About starter-kit');
    expect(textarea.getAttribute('aria-activedescendant')).toBeTruthy();
  });

  it('filters as the name is typed and closes after the space', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, commands: { help, onChoose: vi.fn() } });
    type(textarea, '/kit');
    expect(options()).toHaveLength(1);
    type(textarea, '/starter-kit ');
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
  });

  it('regression: Enter picks the highlighted command instead of submitting; a runnable one runs and clears the box', () => {
    const store = createComposerDraftStore();
    const onSubmit = vi.fn();
    const onChoose = vi.fn();
    const textarea = mount({ store, onSubmit, commands: { help, onChoose } });
    type(textarea, '/stat');
    expect(selected()).toContain('/status');
    press(textarea, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChoose).toHaveBeenCalledWith('status');
    expect(store.get()).toBe('');
  });

  it('an entry that needs arguments puts its insertText in the box and does not run', () => {
    const store = createComposerDraftStore();
    const onSubmit = vi.fn();
    const onChoose = vi.fn();
    const textarea = mount({ store, onSubmit, commands: { help, onChoose } });
    type(textarea, '/sta');
    expect(selected()).toContain('/starter-kit');
    press(textarea, 'Tab');
    expect(store.get()).toBe(entry('starter-kit').insertText);
    expect(onChoose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('moves the highlight with the arrows and Escape closes it', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, commands: { help, onChoose: vi.fn() } });
    type(textarea, '/');
    const first = selected();
    press(textarea, 'ArrowDown');
    expect(selected()).not.toBe(first);
    press(textarea, 'ArrowUp');
    expect(selected()).toBe(first);
    press(textarea, 'Escape');
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
  });

  it('regression: Enter on an unavailable command submits its full `/<id>` (the host says why), never picks it', () => {
    const store = createComposerDraftStore();
    const onChoose = vi.fn();
    const onSubmit = vi.fn(() => { submitted.push(store.get()); });
    const submitted: string[] = [];
    const textarea = mount({ store, onSubmit, commands: { help, onChoose } });
    type(textarea, '/lau');
    expect(host!.textContent).toContain('Only in the VS Code extension');
    press(textarea, 'Enter');
    expect(onChoose).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitted).toEqual(['/launch']);
  });

  it('regression: Shift+Enter never picks — it is left to insert a newline', () => {
    const store = createComposerDraftStore();
    const onSubmit = vi.fn();
    const onChoose = vi.fn();
    const textarea = mount({ store, onSubmit, commands: { help, onChoose } });
    type(textarea, '/stat');
    const event = press(textarea, 'Enter', { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(onChoose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(store.get()).toBe('/stat');
  });

  it('regression: keys while an IME is composing are never the typeahead\'s', () => {
    const store = createComposerDraftStore();
    const onChoose = vi.fn();
    const textarea = mount({ store, commands: { help, onChoose } });
    type(textarea, '/');
    const first = selected();
    expect(press(textarea, 'ArrowDown', { isComposing: true }).defaultPrevented).toBe(false);
    expect(selected()).toBe(first);
    expect(press(textarea, 'Enter', { isComposing: true }).defaultPrevented).toBe(false);
    expect(press(textarea, 'Enter', { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(press(textarea, 'Escape', { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(onChoose).not.toHaveBeenCalled();
    expect(listbox()).not.toBeNull();
  });

  it('regression: shows "no matching commands" and lets Enter submit the line', () => {
    const store = createComposerDraftStore();
    const onSubmit = vi.fn();
    const textarea = mount({ store, onSubmit, commands: { help, onChoose: vi.fn() } });
    type(textarea, '/zzz');
    expect(host!.querySelector('[role="status"]')?.textContent).toBe('No matching commands');
    press(textarea, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('regression: never opens for `//`, a mid-sentence `/`, or on a surface that passes no commands', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, commands: { help, onChoose: vi.fn() } });
    type(textarea, '//');
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
    type(textarea, 'GET api/');
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const bare = mount({ store: createComposerDraftStore() });
    type(bare, '/');
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
    expect(host!.querySelector('[role="status"]')).toBeNull();
  });
});

describe('`@` and `#` typeahead in the composer', () => {
  const ada: DirectedRecipient = { kind: 'agent', ref: 'a1', name: 'Ada' };
  const bob: DirectedRecipient = { kind: 'human', ref: 'h1', name: 'Bob' };

  it('`@` opens on the bare trigger with everyone, and filters as you type', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, participants: [ada, bob] });
    type(textarea, '@');
    expect(options()).toHaveLength(2);
    type(textarea, '@bo');
    expect(options()).toHaveLength(1);
    expect(selected()).toContain('Bob');
  });

  it('`@` with people to address but no match says so, and Enter still submits', () => {
    const store = createComposerDraftStore();
    const onSubmit = vi.fn();
    const textarea = mount({ store, onSubmit, participants: [ada, bob] });
    type(textarea, '@zz');
    expect(emptyRow()?.textContent).toBe('No one to direct to');
    press(textarea, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('regression: `@` / `#` with no candidates at all stay closed, and Escape is not swallowed', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, participants: [], tickets: [] });
    for (const text of ['@', '@x', '#', '#1']) {
      type(textarea, text);
      expect(listbox()).toBeNull();
      expect(emptyRow()).toBeNull();
      expect(textarea.getAttribute('aria-activedescendant')).toBeNull();
      expect(press(textarea, 'Escape').defaultPrevented).toBe(false);
    }
  });

  it('regression: after an `@` pick the popup stays closed and Enter submits', async () => {
    const store = createComposerDraftStore();
    const onSubmit = vi.fn();
    const textarea = mount({ store, onSubmit, participants: [ada, bob] });
    type(textarea, 'hi @bo');
    press(textarea, 'Enter');
    expect(store.get()).toBe('hi ');
    expect(listbox()).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    await settle();
    expect(listbox()).toBeNull();
    press(textarea, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('`#` opens on the bare trigger and a pick inserts the ticket reference and a space', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, tickets: [{ id: 7, title: 'Fix login' }, { id: 9, title: 'Ship docs' }] });
    type(textarea, 'see #');
    expect(options()).toHaveLength(2);
    type(textarea, 'see #doc');
    press(textarea, 'Enter');
    expect(store.get()).toBe('see #9 ');
  });

  it('regression: after a `#` pick (keyless or keyed) the popup does not re-open on the reference, and Enter submits', async () => {
    for (const ticket of [{ id: 9, title: 'Ship docs' }, { id: 4, title: 'Ship docs', key: 'ABC-4' }]) {
      const store = createComposerDraftStore();
      const onSubmit = vi.fn();
      const textarea = mount({ store, onSubmit, tickets: [{ id: 7, title: 'Fix login' }, ticket] });
      type(textarea, '#doc');
      press(textarea, 'Enter');
      expect(store.get()).toBe(`#${ticket.key ?? ticket.id} `);
      expect(listbox()).toBeNull();
      expect(emptyRow()).toBeNull();
      await settle();
      expect(listbox()).toBeNull();
      expect(emptyRow()).toBeNull();
      press(textarea, 'Enter');
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(store.get()).toBe(`#${ticket.key ?? ticket.id} `);
      act(() => root?.unmount());
      host?.remove();
      root = null;
    }
  });

  it('a pick does not swallow the text after the reference', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, tickets: [{ id: 9, title: 'Ship docs' }] });
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(textarea, '#doc rest');
      textarea.setSelectionRange(4, 4);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    press(textarea, 'Enter');
    expect(store.get()).toBe('#9 rest');
  });

  it('`#` with tickets but no match says so', () => {
    const store = createComposerDraftStore();
    const textarea = mount({ store, tickets: [{ id: 7, title: 'Fix login' }] });
    type(textarea, '#zzz');
    expect(emptyRow()?.textContent).toBe('No tickets found');
  });
});
