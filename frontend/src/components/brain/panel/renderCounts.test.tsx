// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createComposerDraftStore } from '@seanhogg/builderforce-brain-embedded';
import { BrainPanelContext } from './BrainPanelContext';
import { BrainConversation } from './BrainConversation';
import type { BrainPanelController } from '../hooks/useBrainPanelController';

/**
 * WHAT RE-RENDERS WHEN, by count: the composer's text lives in a draft store, so typing re-renders the box
 * (the panel's `BrainComposer`) and not the conversation column or its transcript.
 * Everything heavy around them is stubbed; the transcript and the web surface only count their renders.
 */
const counts = vi.hoisted(() => ({ timeline: 0, surface: 0, timelineProps: null as Record<string, unknown> | null }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@seanhogg/builderforce-brain-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seanhogg/builderforce-brain-ui')>();
  return {
    ...actual,
    BrainTimeline: (props: Record<string, unknown>) => { counts.timeline += 1; counts.timelineProps = props; return <div data-testid="timeline" />; },
    PersonaPicker: () => null,
    RecipientPicker: () => null,
  };
});
vi.mock('@/components/ai-surface/WebAiSurface', () => ({
  WebAiSurface: (props: { thread?: React.ReactNode; composer?: React.ReactNode }) => {
    counts.surface += 1;
    return <div>{props.thread}{props.composer}</div>;
  },
}));
vi.mock('@/components/ChatInput', () => ({
  ChatInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="box" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('@/components/ThemeSelect', () => ({ ThemeSelect: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/brain/ChatTicketsPanel', () => ({ ChatTicketsPanel: () => null }));
vi.mock('@/components/brain/BrainCapabilityPicker', () => ({ BrainCapabilityPicker: () => null }));
vi.mock('@/components/brain/WorkOptionsPicker', () => ({ WorkOptionsPicker: () => null }));
vi.mock('@/components/brain/AllowanceBanner', () => ({ AllowanceBanner: () => null }));
vi.mock('@/components/builder/PreviewPickChip', () => ({ PreviewPickChips: () => null }));
vi.mock('@/lib/workspace/previewPick', () => ({ useSpendPreviewPicksOnSettle: () => undefined }));
vi.mock('@/lib/useModalityCopy', () => ({ useLocalizedModalities: () => [] }));
vi.mock('@/i18n/useLabelLookup', () => ({ useLabelLookup: () => () => undefined }));
vi.mock('../../workforce/AssigneeHovercard', () => ({ default: () => null }));
vi.mock('../AiDisclosure', () => ({ AiDisclosure: () => null }));
vi.mock('../BrainErrorBanner', () => ({ BrainErrorBanner: () => null }));
vi.mock('./BrainConversationHeader', () => ({ BrainConversationHeader: () => null }));
vi.mock('./BrainMessageActions', () => ({ renderBrainAssistantActions: () => null }));
vi.mock('./BrainNewProjectForm', () => ({ BrainNewProjectForm: () => null }));
vi.mock('./BrainProviderCapBanner', () => ({ BrainProviderCapBanner: () => null }));

afterEach(() => {
  cleanup();
  counts.timeline = 0;
  counts.surface = 0;
  counts.timelineProps = null;
});

const NO_MESSAGES: never[] = [];
const noop = () => undefined;

describe('typing in the web panel composer', () => {
  it('re-renders the box, not the conversation column or its transcript, for 20 keystrokes', () => {
    const draftStore = createComposerDraftStore();
    // One identity for the whole test, as the controller's value is between keystrokes.
    const panel = {
      isPage: false,
      chats: { activeChatId: 1, activeChat: { id: 1 }, chats: [] },
      conv: { messages: NO_MESSAGES, sending: false, streamingText: '', uploading: false, pendingAttachments: NO_MESSAGES, contextUsage: null },
      draftStore,
      error: null,
      timeline: { timelineLabels: {} },
      timelineTrace: NO_MESSAGES,
      repoContext: { repoPickerOpen: false },
      prefs: {}, memory: {}, consolidation: {}, persona: {}, queued: {}, rows: {}, newProject: {},
      participants: NO_MESSAGES,
      recipient: null,
      chooseRecipient: noop,
      handleSend: noop,
      handleQueueAfter: noop,
      stopTurn: noop,
      composerId: 'c',
      capabilitySurface: 'chat',
      capabilityId: null,
      chatMode: 'chat',
    } as unknown as BrainPanelController;

    render(<BrainPanelContext.Provider value={panel}><BrainConversation /></BrainPanelContext.Provider>);
    const box = screen.getByLabelText('box') as HTMLTextAreaElement;
    const before = { ...counts };

    for (let i = 1; i <= 20; i += 1) act(() => { fireEvent.change(box, { target: { value: 'x'.repeat(i) } }); });

    expect(draftStore.get()).toBe('x'.repeat(20));
    expect(box.value).toBe('x'.repeat(20));
    expect(counts.timeline).toBe(before.timeline);
    expect(counts.surface).toBe(before.surface);
  });
});

describe('the web panel transcript after a send', () => {
  it('is handed the pending turn and the serving model from the conversation', () => {
    const panel = {
      isPage: false,
      chats: { activeChatId: 1, activeChat: { id: 1 }, chats: [] },
      conv: {
        messages: NO_MESSAGES, sending: true, streamingText: '', uploading: false, pendingAttachments: NO_MESSAGES, contextUsage: null,
        pendingTurn: { text: 'fix the build' }, servedBy: { model: 'local/kimi-code/k3', account: 'own' },
      },
      draftStore: createComposerDraftStore(),
      error: null,
      timeline: { timelineLabels: {} },
      timelineTrace: NO_MESSAGES,
      repoContext: { repoPickerOpen: false },
      prefs: {}, memory: {}, consolidation: {}, persona: {}, queued: {}, rows: {}, newProject: {},
      participants: NO_MESSAGES,
      recipient: null,
      chooseRecipient: noop,
      handleSend: noop,
      handleQueueAfter: noop,
      stopTurn: noop,
      composerId: 'c',
      capabilitySurface: 'chat',
      capabilityId: null,
      chatMode: 'chat',
    } as unknown as BrainPanelController;

    render(<BrainPanelContext.Provider value={panel}><BrainConversation /></BrainPanelContext.Provider>);

    expect(counts.timelineProps).toMatchObject({ pendingUserText: 'fix the build', liveModel: 'local/kimi-code/k3', liveAccount: 'own' });
  });
});
