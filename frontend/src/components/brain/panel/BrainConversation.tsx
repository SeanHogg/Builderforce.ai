import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { BrainTimeline, StarterGroup, StarterTile, SurfaceEmptyState } from '@seanhogg/builderforce-brain-ui';
import { WebAiSurface } from '@/components/ai-surface/WebAiSurface';
import { ThemeSelect } from '@/components/ThemeSelect';
import { Icon } from '@/components/ui/Icon';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import { BrainCapabilityPicker } from '@/components/brain/BrainCapabilityPicker';
import { WorkOptionsPicker } from '@/components/brain/WorkOptionsPicker';
import { AllowanceBanner } from '@/components/brain/AllowanceBanner';
import { REPLAY_MASK } from '@/lib/replaySensitive';
import { AiDisclosure } from '../AiDisclosure';
import { BrainErrorBanner } from '../BrainErrorBanner';
import { useBrainPanel } from './BrainPanelContext';
import { BrainComposer } from './BrainComposer';
import { BrainConversationHeader } from './BrainConversationHeader';
import { renderBrainAssistantActions } from './BrainMessageActions';
import { BrainNewProjectForm } from './BrainNewProjectForm';
import { BrainProviderCapBanner } from './BrainProviderCapBanner';

// Opened only from the composer's "Add context" — kept out of the panel's initial chunk.
const RepoContextPicker = dynamic(
  () => import('@/components/brain/RepoContextPicker').then((m) => m.RepoContextPicker),
  { ssr: false },
);

/**
 * The conversation column — the panel's binding of THE web surface (`WebAiSurface`):
 * header (page: the AI disclosure + the chat's project header) · rail (linked
 * tickets, new-project form) · the thread or the empty state · notices · footer.
 */
export function BrainConversation() {
  const {
    isPage,
    chats,
    conv,
    error,
    dismissError,
    showProviderCapBanner,
    dismissProviderCap,
    chatMode,
    pinnedProjectId,
    viewingProjectId,
    filterProjectId,
    setFilterProjectId,
    projects,
    projectName,
    capabilitySurface,
    capabilityId,
    selectCapability,
    pickWorkOption,
    onboard,
    rows,
    newProject,
    timeline,
    timelineTrace,
    timelinePrefetch,
    modelIdentity,
    repoContext,
    approveAll,
    composerId,
  } = useBrainPanel();
  const tBrain = useTranslations('brain');
  const activeChat = chats.activeChatId == null ? null : chats.activeChat;
  const emptyLayout = isPage ? 'page' : 'docked';

  const empty = chats.activeChatId == null ? (
    <SurfaceEmptyState
      layout={emptyLayout}
      title={tBrain(isPage ? 'brainTitle' : 'emptyGreeting')}
      hint={tBrain(chatMode === 'work' ? 'emptyHintWork' : 'emptyHint')}
      // File the conversation as it starts. New chats otherwise inherit the global
      // scope silently, so a user with no project in scope had no way to put THIS
      // conversation somewhere without first creating it.
      controls={pinnedProjectId == null ? (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          {tBrain('newChatProjectLabel')}
          <ThemeSelect
            ariaLabel={tBrain('newChatProjectAria')}
            value={filterProjectId ?? ''}
            onChange={setFilterProjectId}
            options={[
              { value: '', label: tBrain('noProject') },
              ...projects.map((p) => ({ value: String(p.id), label: p.name })),
            ]}
            style={{ minWidth: 140, padding: '4px 8px', fontSize: 'var(--font-size-small)' }}
          />
        </label>
      ) : undefined}
      // Page: the composer sits in the hero; docked pins it in the footer below.
      composer={isPage ? <div {...REPLAY_MASK}><BrainComposer /></div> : undefined}
      // WORK: the jobs people hand over (each fills the composer with a brief to
      // edit). CHAT: what you want to make (opens a chat in that capability). The
      // two are alternatives, not a stack; onboarding is one more starting point.
      starters={(
        <>
          {chatMode === 'work'
            ? <WorkOptionsPicker mode={chatMode} onPick={pickWorkOption} />
            : <BrainCapabilityPicker surface={capabilitySurface} value={capabilityId} onSelect={selectCapability} layout="tiles" />}
          <StarterGroup heading={tBrain('onboardHeading')}>
            <StarterTile icon={<Icon name="sparkles" size={18} />} label={tBrain('onboardMe')} hint={tBrain('onboardMeHint')} onClick={onboard} />
          </StarterGroup>
        </>
      )}
    />
  ) : undefined;

  const header = isPage ? (
    <>
      <AiDisclosure variant="banner" />
      {activeChat && pinnedProjectId == null && (
        <BrainConversationHeader
          chat={activeChat}
          projects={projects}
          projectName={projectName}
          onAssign={rows.onAssign}
          onNewProject={newProject.openNewProject}
          onRename={(chatId, title) => { void chats.rename(chatId, title); }}
        />
      )}
    </>
  ) : undefined;

  const rail = activeChat ? (
    <>
      <ChatTicketsPanel
        chatId={activeChat.id}
        projectId={activeChat.projectId ?? pinnedProjectId ?? viewingProjectId ?? null}
        chatList={chats.chats}
        onChanged={timeline.onTicketsChanged}
        transcript={conv.messages}
        spend={activeChat.spend}
        // The chat's first prompt, kept verbatim (1245) — the auto-title is only a
        // ~60-char derivation of it, and a linked ticket needs the request itself.
        originalRequest={activeChat.originalRequest ?? null}
      />
      {newProject.showNewProject && (
        <BrainNewProjectForm
          name={newProject.newProjectName}
          onNameChange={newProject.setNewProjectName}
          creating={newProject.creatingProject}
          onSubmit={newProject.createProjectAndAssign}
          onCancel={newProject.cancelNewProject}
        />
      )}
    </>
  ) : undefined;

  return (
    <>
      <WebAiSurface
        label={tBrain('brainTitle')}
        header={header}
        rail={rail}
        empty={empty}
        thread={(
          <div className="bs-messages" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <BrainTimeline
              conversationKey={chats.activeChatId}
              messages={conv.messages}
              trace={timelineTrace}
              streamingText={conv.sending ? conv.streamingText : ''}
              isRunning={conv.sending}
              activity={conv.activity}
              loading={conv.loadingMessages}
              labels={timeline.timelineLabels}
              modelIdentity={modelIdentity}
              onApplyCode={timeline.timelineApplyCode}
              onCreateFile={timeline.timelineCreateFile}
              // Answering an ask_user card posts the choice as the next user turn.
              onAnswerQuestion={timeline.onAnswerTimelineQuestion}
              // Reuse the web's rich markdown (mermaid, router links, code-apply) so
              // no feature is lost; the model-authored "next step" JSON is lifted out.
              renderMessage={timeline.renderTimelineMessage}
              renderStreaming={timeline.renderTimelineStreaming}
              renderAssistantActions={renderBrainAssistantActions}
              onReplayMessage={timeline.onReplayTimelineMessage}
              // Thumbs live in the shared action row now; the press files a durable
              // rating against the model + MCP tool that served the turn.
              onRateMessage={conv.rateMessage}
              ratings={conv.ratings}
              // A PreFetch answer's chips (Open in graph, Choose a folder to review).
              prefetch={timelinePrefetch}
            />
          </div>
        )}
        // What went wrong reads next to the box you answer it from. The verdict (Upgrade
        // / Add a card) only applies to a CONVERSATION error — a chat-list failure isn't
        // an entitlement problem, so it gets the plain dismissible banner. The allowance
        // banner self-gates on the shared consumption snapshot.
        notices={(
          <>
            <BrainErrorBanner error={error} action={conv.error ? conv.errorAction : null} onDismiss={dismissError} composerId={composerId} onRetry={conv.retryLastTurn} />
            <AllowanceBanner />
            {showProviderCapBanner && <BrainProviderCapBanner providers={conv.providerCap} onDismiss={dismissProviderCap} />}
          </>
        )}
        // The footer: the run's approval and open question come with the web surface;
        // the composer, the uploading line and (docked) the AI footnote are the panel's.
        // The page's empty state carries its own composer in the hero.
        footer={!(isPage && empty)}
        runKey={chats.activeChatId}
        onApproveAll={approveAll}
        messages={conv.messages}
        onAnswerQuestion={timeline.onAnswerTimelineQuestion}
        timelineLabels={timeline.timelineLabels}
        composer={<BrainComposer />}
        status={conv.uploading ? tBrain('uploading') : undefined}
        // Docked: the AI notice is a footnote under the input, not a banner over the thread.
        footnote={isPage ? undefined : <AiDisclosure variant="footnote" />}
      />
      {repoContext.repoPickerOpen && (
        <RepoContextPicker
          sources={repoContext.contextSources}
          onPick={repoContext.attachRepoFile}
          onClose={repoContext.closeRepoPicker}
        />
      )}
    </>
  );
}
