import { ChatMessageActions } from '@/components/ChatMessageActions';
import { CapabilityArtifactNotice } from '@/components/brain/CapabilityArtifactNotice';
import { TurnChangesCard } from '@/components/brain/TurnChangesCard';
import { isStepMessage, parseSuggestedActions, type SuggestedAction, type useBrainConversation } from '@/lib/brain';
import type { BrainMessage } from '@/lib/builderforceApi';
import { useBrainPanel } from './BrainPanelContext';

export function BrainMessageActions({ msg, conv, projectId, capability, chatTitle, suggestions, onRunSuggestion }: {
  msg: BrainMessage;
  conv: ReturnType<typeof useBrainConversation>;
  projectId?: number;
  /** The chat's capability — drives the reply's "Download as …" action. */
  capability?: string | null;
  chatTitle?: string;
  /** Model-authored next-step buttons parsed from this reply. */
  suggestions?: SuggestedAction[];
  onRunSuggestion?: (prompt: string) => void;
}) {
  // Only the newest assistant turn is worth judging/retrying for a missing artifact.
  const lastAssistantId = [...conv.messages].reverse().find((m) => m.role === 'assistant' && !isStepMessage(m))?.id;
  return (
    <>
      {/* What this turn changed in the project beside the chat, under its last reply. */}
      <TurnChangesCard messages={conv.messages} replyId={msg.id} projectId={projectId} />
      {suggestions && suggestions.length > 0 && onRunSuggestion && (
        <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onRunSuggestion(s.prompt)}
              disabled={conv.sending}
              title={s.prompt}
              style={{
                fontSize: 'var(--font-size-small)',
                fontWeight: 600,
                padding: '5px 12px',
                cursor: conv.sending ? 'wait' : 'pointer',
                background: 'var(--coral-bright)',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {/* A capability reply that never produced its artifact reads as "nothing
          happened" — say so, and offer to ask for it explicitly. */}
      <CapabilityArtifactNotice
        capability={capability}
        content={msg.content}
        streaming={conv.sending}
        isLatest={msg.id === lastAssistantId}
        onRetry={(prompt) => { void conv.send(prompt); }}
      />
      {/* Thumbs are no longer here — they live in the shared <BrainTimeline> action
          row so the Canvas and the editor rate turns too. */}
      <ChatMessageActions
        projectId={projectId}
        capability={capability}
        chatTitle={chatTitle}
        assistantContent={msg.content}
        conversationMessages={conv.messages.filter((m) => !isStepMessage(m)).map((m) => ({ role: m.role, content: m.content }))}
      />
    </>
  );
}

/**
 * A reply's action row wired to the panel: reads the live conversation and the chat's
 * project / capability / title from the panel controller, so the timeline's render
 * prop can stay one stable module-level function (see `renderBrainAssistantActions`).
 */
function BrainPanelMessageActions({ msg }: { msg: BrainMessage }) {
  const { conv, chats, pinnedProjectId } = useBrainPanel();
  return (
    <BrainMessageActions
      msg={msg}
      conv={conv}
      projectId={chats.activeChat?.projectId ?? pinnedProjectId ?? undefined}
      capability={chats.activeChat?.capability ?? null}
      chatTitle={chats.activeChat?.title}
      suggestions={parseSuggestedActions(msg.content).actions}
      onRunSuggestion={(prompt) => { void conv.send(prompt); }}
    />
  );
}

/** <BrainTimeline>'s `renderAssistantActions` — module scope, so its identity never changes. */
export function renderBrainAssistantActions(msg: BrainMessage) {
  return <BrainPanelMessageActions msg={msg} />;
}
