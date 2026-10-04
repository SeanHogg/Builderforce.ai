import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { BrainTimeline } from '@seanhogg/builderforce-brain-ui';
import { ThemeSelect } from '@/components/ThemeSelect';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import { BrainCapabilityPicker } from '@/components/brain/BrainCapabilityPicker';
import { WorkOptionsPicker } from '@/components/brain/WorkOptionsPicker';
import { AllowanceBanner } from '@/components/brain/AllowanceBanner';
import { BrainEmptyState } from '../BrainEmptyState';
import { BrainErrorBanner } from '../BrainErrorBanner';
import { useBrainPanel } from './BrainPanelContext';
import { BrainComposer } from './BrainComposer';
import { BrainComposerArea } from './BrainComposerArea';
import { BrainConversationHeader } from './BrainConversationHeader';
import { renderBrainAssistantActions } from './BrainMessageActions';
import { BrainNewProjectForm } from './BrainNewProjectForm';
import { BrainProviderCapBanner } from './BrainProviderCapBanner';

// Opened only from the composer's "Add context" — kept out of the panel's initial chunk.
const RepoContextPicker = dynamic(
  () => import('@/components/brain/RepoContextPicker').then((m) => m.RepoContextPicker),
  { ssr: false },
);

/** The conversation column: banners, then the empty state or the active thread. */
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
    selectMode,
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
    modelIdentity,
    repoContext,
  } = useBrainPanel();
  const tBrain = useTranslations('brain');
  return (
    <>
      {/* The message AND the fix: a 402/429 gets an Upgrade / Add-a-card action from
          the shared verdict, instead of dead-ending on prose. The verdict only
          applies to a CONVERSATION error — a chat-list failure isn't an entitlement
          problem, so it gets the plain dismissible banner. */}
      <BrainErrorBanner
        error={error}
        action={conv.error ? conv.errorAction : null}
        onDismiss={dismissError}
      />
      {/* Spent/nearly-spent token allowance — the state that silently degrades or
          truncates turns. Self-gating on the shared consumption snapshot. */}
      <AllowanceBanner />
      {showProviderCapBanner && <BrainProviderCapBanner providers={conv.providerCap} onDismiss={dismissProviderCap} />}
      {chats.activeChatId == null ? (
        <>
          <BrainEmptyState
            layout={isPage ? 'page' : 'docked'}
            mode={chatMode}
            onModeChange={selectMode}
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
            composer={isPage ? <BrainComposer /> : undefined}
            // WORK: the jobs people hand over (each fills the composer with a brief to
            // edit). CHAT: what you want to make (opens a chat in that capability). The
            // two are alternatives, not a stack.
            starters={chatMode === 'work'
              ? <WorkOptionsPicker mode={chatMode} onPick={pickWorkOption} />
              : <BrainCapabilityPicker surface={capabilitySurface} value={capabilityId} onSelect={selectCapability} layout="tiles" />}
            onOnboard={onboard}
          />
          {!isPage && <BrainComposerArea />}
        </>
      ) : (
        <>
          {isPage && pinnedProjectId == null && (
            <BrainConversationHeader
              chat={chats.activeChat}
              projects={projects}
              projectName={projectName}
              onAssign={rows.onAssign}
              onNewProject={newProject.openNewProject}
            />
          )}
          {chats.activeChat && (
            <ChatTicketsPanel
              chatId={chats.activeChat.id}
              projectId={chats.activeChat.projectId ?? pinnedProjectId ?? viewingProjectId ?? null}
              chatList={chats.chats}
              onChanged={timeline.onTicketsChanged}
              transcript={conv.messages}
            />
          )}
          {newProject.showNewProject && (
            <BrainNewProjectForm
              name={newProject.newProjectName}
              onNameChange={newProject.setNewProjectName}
              creating={newProject.creatingProject}
              onSubmit={newProject.createProjectAndAssign}
              onCancel={newProject.cancelNewProject}
            />
          )}
          <div className="bs-messages" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <BrainTimeline
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
            />
          </div>
          <BrainComposerArea />
        </>
      )}
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
