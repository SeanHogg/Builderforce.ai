import { useCallback } from 'react';
import { chatDiagnosticsReads, type createChatTicketsRestAdapter } from '@seanhogg/builderforce-brain-ui';
import {
  formatChatDiagnostics,
  gatherChatDiagnostics,
  getMcpToolStatus,
  type BrainTraceEvent,
} from '@seanhogg/builderforce-brain-embedded';
import { getProjectEvermindContributions } from '@/lib/projectEvermindApi';
import { APP_VERSION, fetchApiVersion } from '@/lib/appVersions';
import { getStoredTenant, getStoredUser } from '@/lib/auth';
import type { ChatMode, useBrainActions, useBrainChats, useBrainConversation } from '@/lib/brain';
import { brain } from '@/lib/builderforceApi';
import { fetchConsumptionSnapshot } from '@/lib/useConsumption';
import type { useLlmModels } from '@/lib/useLlmModels';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import type { Project } from '@/lib/types';
import { captureDiagnosticsBlock } from '../captureDiagnostics';

/**
 * Capture execution: copy the Brain run's LLM/tool/error trace + transcript to
 * the clipboard — the Brain twin of the Observability/Logs "Copy triage info"
 * button, so a misbehaving run can be dropped straight into a bug report.
 */
export function useBrainCaptureExecution({
  chats,
  conv,
  chatMode,
  projects,
  pinnedProjectId,
  viewingProjectId,
  toolSpecs,
  timelineTrace,
  model,
  personaLabel,
  llmModels,
  ticketAdapter,
}: {
  chats: ReturnType<typeof useBrainChats>;
  conv: ReturnType<typeof useBrainConversation>;
  chatMode: ChatMode;
  projects: Project[];
  pinnedProjectId: number | null;
  viewingProjectId: number | null;
  toolSpecs: ReturnType<typeof useBrainActions>['toolSpecs'];
  timelineTrace: BrainTraceEvent[];
  /** The model the run is on: an explicit `/` pick, else the persona's own model. */
  model: string | undefined;
  personaLabel: string;
  llmModels: ReturnType<typeof useLlmModels>;
  ticketAdapter: ReturnType<typeof createChatTicketsRestAdapter>;
}) {
  // Was a local 'idle' | 'copied' | 'error' + a 2000ms reset — the same states the
  // shared hook owns, so it replaces the local copy verbatim.
  const capture = useCopyToClipboard();
  const captureExecution = useCallback(async () => {
    // The write, the idle→copied/error→idle feedback and its 2000ms reset all live in the
    // shared hook. Thunk form: the payload is built on click, and a build that throws
    // lands on `error` exactly as the old try/catch around it did.
    await capture.copy(async () => {
      // Prepend a Chat diagnostics block (identity + Evermind wiring state + Signals) so a
      // pasted report answers "what STATE was this chat in?". Assembled by the SHARED
      // `gatherChatDiagnostics` — the same one the VS Code webview and the headless probe
      // call — so the three reports cannot drift field-by-field the way three inline
      // copies did. Best-effort per source inside the assembler: a failed fetch degrades
      // to null/[] so the copy never breaks.
      const chatId = chats.activeChatId;
      const chatProjectId = chats.activeChat?.projectId ?? null;
      const tenant = getStoredTenant();
      const user = getStoredUser();
      const diagnostics = await gatherChatDiagnostics({
        surface: 'Web',
        chatId,
        chatTitle: chats.activeChat?.title ?? null,
        // What the run was OBLIGED to do. The same trace is a good answer in `chat` and
        // an unfinished execution in `work`; without the mode those read identically.
        mode: chatMode,
        projectId: chatProjectId,
        projectName: projects.find((p) => p.id === chatProjectId)?.name ?? null,
        selectedProjectId: pinnedProjectId ?? viewingProjectId ?? null,
        selectedProjectName:
          projects.find((p) => p.id === (pinnedProjectId ?? viewingProjectId))?.name ?? null,
        tenantId: tenant?.id ?? null,
        userId: user?.id ?? null,
        messages: conv.messages,
        // What the model could actually CALL. The COUNT is the live registry the
        // conversation runs on (`toolSpecs` — navigation + MCP catalog together), not
        // just the MCP subset; the catalog status explains a zero. The trace supplies
        // what was ACTUALLY advertised per turn, so this line and the Diagnostics block
        // below it can no longer answer one question two ways.
        tools: (() => {
          const mcp = getMcpToolStatus();
          return { count: toolSpecs.length, error: mcp.error, loading: mcp.loading };
        })(),
        trace: timelineTrace,
        model: model ?? null,
        // Shared cached model surface — `fundingSurface` keeps the vendor tagging the
        // classifier needs, so this reads the list the pickers already loaded instead
        // of re-fetching /llm/v1/models on every capture.
        modelSurface: {
          data: llmModels.fundingSurface.data,
          byo: { models: llmModels.fundingSurface.byo.models, providers: llmModels.byoProviders },
          canUsePremiumModels: llmModels.canUsePremiumModels,
        },
        // Which build produced this capture — without it, a dump taken just before a
        // deploy is indistinguishable from one taken after.
        uiVersion: APP_VERSION,
        // The chat-scoped reads (agents, tickets, runs) come from ONE shared wiring over
        // the chat-tickets adapter — the VS Code webview spreads the identical call. This
        // panel used to satisfy the same endpoints through a SECOND client
        // (`brain.listChatAgents` / `listChatTickets`), which is how one assembler ended
        // up with two hand-wired source sets and why a new read had to be added twice.
        ...chatDiagnosticsReads(ticketAdapter, chatId),
        readEvermind: () => (chatProjectId != null ? getProjectEvermindContributions(chatProjectId) : Promise.resolve(null)),
        // Plan + month-to-date allowance. A free/card-less tenant's report must SAY so
        // rather than read as an unexplained capability failure. Shared cached snapshot
        // — the same one the header's <PlanBadge/> shows, so the report and the chip
        // can't disagree.
        readPlan: () => fetchConsumptionSnapshot(),
        // Session-cached AND time-bounded in the shared helper; shares the footer's
        // /health read rather than adding one.
        readApiVersion: () => fetchApiVersion(),
      });
      const diagBlock = formatChatDiagnostics(diagnostics).join('\n');
      // The SAME capture as one versioned JSON object, appended last and persisted with
      // the chat (best-effort — the copy must never fail because the store did). The
      // prose above is what a human reads; this is the half a query or an agent can.
      const jsonBlock = captureDiagnosticsBlock({
        diagnostics,
        events: timelineTrace,
        messages: conv.messages,
        model: model ?? null,
        running: conv.sending,
        chatId,
        store: brain.postChatDiagnostics,
      });
      return `${diagBlock}\n\n${conv.buildTriageReport(personaLabel)}\n\n${jsonBlock}`;
    });
  }, [capture, conv, personaLabel, model, llmModels, toolSpecs, timelineTrace, chatMode, chats.activeChatId, chats.activeChat, projects, pinnedProjectId, viewingProjectId, ticketAdapter]);

  return { captureExecution, captureState: capture.state };
}
