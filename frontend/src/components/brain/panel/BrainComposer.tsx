import { useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PersonaPicker, RecipientPicker } from '@seanhogg/builderforce-brain-ui';
import type { DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import { ChatInput } from '@/components/ChatInput';
import { PreviewPickChip } from '@/components/builder/PreviewPickChip';
import { useSpendPreviewPickOnSettle } from '@/lib/workspace/previewPick';
import { EvermindStatusBadge } from '@/components/builder/EvermindStatusBadge';
import { BrainCapabilityPicker } from '@/components/brain/BrainCapabilityPicker';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import AssigneeHovercard from '../../workforce/AssigneeHovercard';
import { useBrainPanel } from './BrainPanelContext';
import { modeVocabularyFor } from '@/lib/brain/useChatModeCopy';

/** A recipient's avatar inside the shared hovercard — module scope, so its identity never changes. */
function renderRecipientAvatar(r: DirectedRecipient, avatar: ReactNode) {
  return (
    <AssigneeHovercard selectValue={r.kind === 'agent' ? `c:${r.ref}` : `u:${r.ref}`}>{avatar}</AssigneeHovercard>
  );
}

/**
 * One composer instance for both the pre-chat and active-chat states. Sending
 * from the empty state creates the chat through conv.ensureChatId; selecting a
 * capability can still seed and focus this same input.
 */
export function BrainComposer() {
  const {
    chats,
    conv,
    input,
    setInput,
    handleSend,
    recipient,
    chooseRecipient,
    participants,
    queuedCount,
    repoContext,
    prefs,
    modelOptions,
    modelIdentity,
    autoApprove,
    setAutoApproveMode,
    chatMode,
    selectMode,
    memory,
    consolidation,
    ticketables,
    handleTicketTag,
    composerFocusToken,
    composerDensity,
    compactComposer,
    persona,
    capabilitySurface,
    capabilityId,
    selectCapability,
    ctxProjectId,
  } = useBrainPanel();
  const tBrain = useTranslations('brain');
  // The element picked in a preview rides the turn's context (`useWorkspaceBrainContext`);
  // the turn that carried it spends it.
  useSpendPreviewPickOnSettle(conv.sending);
  const localizedModalities = useLocalizedModalities();
  const personaLabels = useMemo(() => ({
    actingAs: tBrain('actingAs'),
    title: tBrain('personaAria'),
    defaultBrain: tBrain('defaultBrain'),
    personas: tBrain('personas'),
    assignedAgents: tBrain('assignedAgents'),
  }), [tBrain]);
  const recipientLabels = useMemo(() => ({
    to: tBrain('to'),
    title: tBrain('recipientPickerTitle'),
    brain: tBrain('brainRecipient'),
    brainHint: tBrain('brainRecipientHint'),
    agentHint: tBrain('agentRecipientHint'),
    humanHint: tBrain('humanRecipientHint'),
  }), [tBrain]);

  return (
    <ChatInput
      value={input}
      onChange={setInput}
      onSubmit={handleSend}
      // A builder's chat is about changing the thing on screen, so it says so.
      placeholder={recipient ? tBrain('messageParticipant', { name: recipient.name }) : tBrain(capabilitySurface === 'build' ? 'messagePlaceholderBuild' : 'messagePlaceholder')}
      disabled={false}
      running={conv.sending}
      onStop={conv.stop}
      queuedCount={queuedCount}
      rows={2}
      submitOnEnter={false}
      onAttach={conv.attach}
      onAddContext={repoContext.onAddContext}
      webBrowsing={prefs.webBrowsing}
      onWebBrowsingChange={prefs.setWebBrowsing}
      effort={prefs.effort}
      onEffortChange={prefs.setEffort}
      thinking={prefs.thinking}
      onThinkingChange={prefs.setThinking}
      accountSettingsHref="/settings"
      modelSelection={prefs.modelSelection}
      modelOptions={modelOptions}
      modelIdentity={modelIdentity}
      onModelSelectionChange={prefs.setModelSelection}
      autoMode={autoApprove}
      onAutoModeChange={setAutoApproveMode}
      // Chat | Work moved into the composer's `/` menu, which names the armed mode on
      // its trigger. One control less in a row that a phone could not fit, and the two
      // surfaces that have this setting now render it from the same place.
      chatMode={chatMode}
      onChatModeChange={selectMode}
      modeVocabulary={modeVocabularyFor(capabilitySurface)}
      // Memory and the consolidate/fork actions live in that same `/` menu, for the
      // same reason and on both surfaces: three pills that were inert for most of a
      // chat's life used to sit between the mode control and Send.
      memoryEnabled={memory.memoryEnabled}
      onMemoryChange={memory.toggleMemory}
      memoryUnavailableReason={memory.evermindProjectId == null ? tBrain('memoryUnavailable') : undefined}
      canConsolidate={consolidation.canConsolidate}
      consolidating={consolidation.consolidating}
      forking={consolidation.forking}
      onConsolidate={consolidation.consolidate}
      onFork={consolidation.fork}
      showVoice
      pendingAttachments={conv.pendingAttachments}
      onRemoveAttachment={conv.removeAttachment}
      mentionables={participants}
      onMention={chooseRecipient}
      ticketables={ticketables}
      onTicketTag={handleTicketTag}
      focusToken={composerFocusToken}
      density={composerDensity}
      contextControls={<>
        {/* What the next request is about, when an element was picked in the preview. */}
        <PreviewPickChip />
        {/* "Acting as" and "To" are the shared brain-ui pickers — the SAME controls the
            editor's composer renders, so the two surfaces offer and word them alike.
            Compact: "Acting as" only when there is someone else to act as, or the
            person already moved off the project's own persona. */}
        {(!compactComposer || persona.personaAgents.length > 0 || persona.personaSel !== persona.dockedPersona) && <PersonaPicker
          value={persona.personaSel}
          onChange={persona.choosePersona}
          modalities={localizedModalities}
          agents={persona.personaAgents}
          labels={personaLabels}
        />}
        {chats.activeChatId != null && (!compactComposer || capabilityId != null) && <BrainCapabilityPicker surface={capabilitySurface} value={capabilityId} onSelect={selectCapability} layout="compact" disabled={conv.sending} />}
        {/* WHO YOU ARE ADDRESSING, with their personality. The shared hovercard showed
            on /settings, the Workforce card and task-assignee chips — everywhere except
            the surface where you actually choose which agent to talk to. It reads the
            same provider map (mounted once in BrainPanel) and self-hides for a participant
            with no personality on file, so nothing changes for anyone who has not set one.
            The picker self-hides in a chat with no participants. */}
        <RecipientPicker
          participants={participants}
          recipient={recipient}
          onChoose={chooseRecipient}
          labels={recipientLabels}
          renderAvatar={renderRecipientAvatar}
        />
      </>}
      // Memory status is a standing fact, not a mode: it sits beside the plan chip in
      // the composer's last row, never in the tool row competing with Send.
      meta={chats.activeChatId != null ? <EvermindStatusBadge projectId={ctxProjectId} /> : undefined}
    />
  );
}
