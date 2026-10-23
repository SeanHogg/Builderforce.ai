// @vitest-environment jsdom
/**
 * Rovr's chat on THE shared conversation (`useBrainConversation`, the hook the web Brain
 * and the VS Code webview mount), mounted for real: the panel's services with the device
 * record in memory, Rovr's run-time parts (`prepareRun`) and a scripted stream. Pins what
 * moving Rovr onto the shared path promises:
 *   - a typed turn is sent, saved on the device and answered through the hook;
 *   - a refused turn (`no_local_model`, Local only) shows the shared banner, and its
 *     "Switch to Hybrid" moves the mode, then re-sends the SAME turn (`retryLastTurn`) —
 *     one user row on the device, never two;
 *   - a row written from another panel window appears live (`subscribeMessages`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import {
  BrainProvider,
  createModelFallbackChannel,
  resetBrainRunStore,
  type BrainConfig,
  type BrainStreamFn,
  type StreamChatResult,
} from '@seanhogg/builderforce-brain-embedded';
import type { PanelServices } from '../host/panelServices';
import { createRovrRunHost } from '../host/rovrRunHost';
import { createLocalFirstPersistence } from '../persistence/localFirstPersistence';
import { createRovrBrainPersistence, type MessageChangeChannel } from '../persistence/rovrBrainPersistence';
import { createMemoryKeyValue } from '../platform/keyValue';
import { createRovrPlatformPolicy } from '../platform/policy';
import { createSettings } from '../platform/settings';
import { createMemoryRecords, type LocalChat, type RovrRecords } from '../store/records';
import { createWorkingTab } from '../tools/tabPort';
import { ChatView } from './ChatView';
import { ServicesContext } from './hooks';

/** `chrome.*` as the panel reads it: no catalog (every `t()` is its key), English UI. */
beforeEach(() => {
  vi.stubGlobal('chrome', {
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    runtime: { id: 'rovr', onMessage: { addListener: () => undefined, removeListener: () => undefined }, sendMessage: async () => undefined },
    tabs: { create: () => undefined },
  });
});

afterEach(() => {
  cleanup();
  resetBrainRunStore();
  vi.unstubAllGlobals();
});

/** A cross-context channel in memory — what `BroadcastChannel` is between two windows. */
function memoryChannel(): MessageChangeChannel {
  const listeners = new Set<(chatId: number) => void>();
  return {
    post: (chatId) => { for (const l of [...listeners]) l(chatId); },
    listen: (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
  };
}

const answer = (text: string): StreamChatResult => ({ text, toolCalls: [], finishReason: 'stop' }) as StreamChatResult;

async function panel(stream: BrainStreamFn) {
  const records = createMemoryRecords();
  const channel = memoryChannel();
  const persistence = createRovrBrainPersistence(records, createLocalFirstPersistence(records, { enqueue: () => undefined }), channel);
  const storage = createMemoryKeyValue();
  const policy = createRovrPlatformPolicy(storage);
  await policy.ready();
  // Chosen already — the first-run question has its own tests in brain-ui.
  await policy.setInferenceMode('local-only');
  const host = createRovrRunHost({
    catalog: async () => ({ specs: [], run: async () => ({}), needsConfirm: () => false }),
    systemPrompt: async () => 'You are Rovr.',
  });
  const brainConfig: BrainConfig = { transport: { baseUrl: 'https://gw.example', getToken: () => null }, persistence, stream, resolveSystemPrompt: () => '' };
  const services = {
    host,
    brainConfig,
    records,
    policy,
    settings: createSettings(storage),
    session: { isSignedIn: () => false, subscribe: () => () => undefined, key: async () => null },
    api: { request: vi.fn() },
    working: createWorkingTab(),
    baseUrl: 'https://gw.example',
    modelFallback: createModelFallbackChannel(),
    reportError: vi.fn(),
    safety: () => ({ url: null, allowedOrigins: new Set<string>(), factsFor: () => undefined }),
    // No in-page model store in these turn tests: the composer's `localStore` is optional.
    pageEngines: { store: undefined },
  } as unknown as PanelServices;
  // Another panel window over the same device record: its writes reach this one only
  // through the channel.
  const otherWindow = createRovrBrainPersistence(records, createLocalFirstPersistence(records, { enqueue: () => undefined }), channel);
  return { services, records, otherWindow };
}

function Harness({ services }: { services: PanelServices }) {
  const [chatId, setChatId] = useState<number | null>(null);
  const [chats, setChats] = useState<LocalChat[]>([]);
  const reload = useCallback(() => { void services.records.listChats().then(setChats); }, [services]);
  const onNewChat = useCallback(async () => {
    const created = await services.records.createChat('newChatTitle');
    setChatId(created.id);
    reload();
    return created.id;
  }, [services, reload]);
  return (
    <ServicesContext.Provider value={services}>
      <BrainProvider config={services.brainConfig}>
        <ChatView chats={chats} chatId={chatId} onNewChat={onNewChat} onChatsChanged={reload} onOpenSettings={() => undefined} />
      </BrainProvider>
    </ServicesContext.Provider>
  );
}

async function type(text: string) {
  const box = screen.getByRole('textbox', { name: 'composerLabel' });
  fireEvent.change(box, { target: { value: text } });
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
}

const userRows = async (records: RovrRecords) => {
  const chats = await records.listChats();
  const rows = await Promise.all(chats.map((c) => records.listMessages(c.id)));
  return rows.flat().filter((m) => m.role === 'user').map((m) => m.content);
};

describe('Rovr ChatView on the shared conversation hook', () => {
  it('sends a typed turn through the hook: saved on the device, answered, shown', async () => {
    const stream = vi.fn<BrainStreamFn>(async () => answer('Hello from Rovr.'));
    const { services, records } = await panel(stream);
    render(<Harness services={services} />);

    await type('hi');

    await waitFor(() => expect(screen.getByText('Hello from Rovr.')).toBeTruthy());
    expect(stream).toHaveBeenCalledTimes(1);
    expect(await userRows(records)).toEqual(['hi']);
  });

  it('a refused turn shows the shared banner; Switch to Hybrid re-sends the SAME turn — one user row', async () => {
    const stream = vi.fn<BrainStreamFn>()
      .mockRejectedValueOnce(new Error('no_local_model'))
      .mockResolvedValue(answer('Dear Ava, I am so proud of you.'));
    const { services, records } = await panel(stream);
    render(<Harness services={services} />);

    await type('help me write a letter to my daughter');
    const switchToHybrid = await screen.findByRole('button', { name: 'switchToHybrid' });

    await act(async () => { fireEvent.click(switchToHybrid); });

    await waitFor(() => expect(screen.getByText('Dear Ava, I am so proud of you.')).toBeTruthy());
    expect(stream).toHaveBeenCalledTimes(2);
    expect(services.policy.inferenceMode().mode).toBe('hybrid');
    expect(await userRows(records)).toEqual(['help me write a letter to my daughter']);
    expect(screen.queryByRole('button', { name: 'switchToHybrid' })).toBeNull();
  });

  it('a row written from another panel window appears live', async () => {
    const stream = vi.fn<BrainStreamFn>(async () => answer('Hello from Rovr.'));
    const { services, records, otherWindow } = await panel(stream);
    render(<Harness services={services} />);
    await type('hi');
    await waitFor(() => expect(screen.getByText('Hello from Rovr.')).toBeTruthy());
    const [chat] = await records.listChats();

    await act(async () => { await otherWindow.sendMessages(chat!.id, [{ role: 'assistant', content: 'Synced from the other window.' }]); });

    await waitFor(() => expect(screen.getByText('Synced from the other window.')).toBeTruthy());
  });
});
