/**
 * "Copy chat diagnostics" — the header's triage button. Gathers the chat's identity and
 * Evermind wiring through the ONE shared assembler (`gatherChatDiagnostics`, shared with
 * the web panel and the headless probe), serializes it (`buildChatDiagnosticsReport`),
 * persists the capture with the chat, and puts the transcript + report on the clipboard
 * through the host. Lifted out of the chat surface unchanged.
 *
 * idle → copied → idle, or → error: a copy that FAILS must look different from one that
 * never ran — the button used to swallow every rejection, so a broken export looked like
 * an unwired control.
 */

import { useCallback, useState } from 'react';
import {
  buildChatDiagnosticsReport,
  fetchApiVersionVia,
  gatherChatDiagnostics,
  getMcpToolStatus,
  serverChatIdOf,
  traceWithPersistedSteps,
  type BrainChat,
  type ChatMode,
  type UseBrainConversation,
} from '@seanhogg/builderforce-brain-embedded';
import { chatDiagnosticsReads } from '@seanhogg/builderforce-brain-ui';
import { decodeTokenClaims } from '@/lib/tokenClaims';
import type { AuthedFetch } from '../authedFetch';
import type { createChatTicketsAdapter } from '../chatTicketsAdapter';
import { fetchPlanSnapshot } from '../planSnapshot';
import { buildTranscript, hasTranscriptContent } from '../transcript';
import { getToken, post, type InitData } from '../vscodeBridge';
import { WEBVIEW_BUILD_ID, WEBVIEW_BUILT_AT } from '../webviewBuildInfo';
import { subagentDiagnosticsOf } from './chatChildren';
import type { useComposerModels } from './useComposerModels';

export type CopyState = 'idle' | 'copied' | 'error';

export function useCopyDiagnostics({
  init, conv, chatId, activeChat, chatVisibility, chatMode, associatedProject, associatedProjectId,
  modelSurface, ticketAdapter, apiReq, t,
}: {
  init: InitData;
  conv: UseBrainConversation;
  chatId: number | null;
  activeChat: BrainChat | null;
  chatVisibility: 'shared' | 'locked';
  chatMode: ChatMode;
  associatedProject: { id: number; name: string } | null;
  associatedProjectId: number | null;
  modelSurface: ReturnType<typeof useComposerModels>['modelSurface'];
  ticketAdapter: ReturnType<typeof createChatTicketsAdapter>;
  apiReq: AuthedFetch;
  t: (key: string, fallback: string) => string;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  // The chat-scoped server reads and the stored report name the BOUND server chat (PRD 36);
  // the report itself still shows the local view key the person sees.
  const serverChatId = serverChatIdOf(activeChat);
  const canCopy = hasTranscriptContent({ messages: conv.messages, trace: conv.trace, error: conv.error });

  const copyTranscript = useCallback(async () => {
    const pid = associatedProjectId;
    try {
      const claims = decodeTokenClaims(getToken());
      const mcp = getMcpToolStatus();
      // Every read inside the assembler is best-effort, so one dead endpoint costs a
      // line, not the capture.
      const diagnostics = await gatherChatDiagnostics({
        surface: 'VS Code (VSIX)',
        chatId,
        chatTitle: activeChat?.title ?? null,
        spend: activeChat?.spend ?? null,
        chatVisibility,
        // The mode the run actually bound to — it decides whether "planned it and
        // stopped" is correct behaviour or a failure.
        mode: chatMode,
        projectId: pid,
        projectName: associatedProject?.name ?? null,
        selectedProjectId: init.project?.id ?? null,
        selectedProjectName: init.project?.name ?? null,
        tenantId: claims.tid ?? null,
        userId: claims.sub ?? null,
        messages: conv.messages,
        // The chat lives in this machine's local-first store, keyed by the local chat id.
        historyLocation: init.chatHistoryPath
          ? `${init.chatHistoryPath} · local chat #${chatId ?? '?'}${serverChatId != null ? ` (server chat #${serverChatId})` : ''}`
          : null,
        // The catalog the HOST built for the last run; the status explains a zero. The
        // trace supplies what was ACTUALLY advertised per turn.
        tools: { count: mcp.count, error: mcp.error, loading: mcp.loading },
        trace: conv.trace,
        model: init.model ?? null,
        modelSurface,
        uiVersion: init.extensionVersion ?? null,
        uiBuildId: init.buildId ?? null,
        uiBuiltAt: init.builtAt ?? null,
        // THIS bundle's own stamp, beside the host's above: different ids name which
        // half is stale.
        webviewBuildId: WEBVIEW_BUILD_ID,
        webviewBuiltAt: WEBVIEW_BUILT_AT,
        posixShell: init.posixShell ?? null,
        baseUrl: init.baseUrl ?? null,
        // The chat-scoped reads (agents, tickets, runs) — ONE shared wiring over the adapter.
        ...chatDiagnosticsReads(ticketAdapter, serverChatId),
        readEvermind: () =>
          pid != null
            ? apiReq<{ version: number; mode: string; inferenceEnabled: boolean; teacherModel: string | null; contributions: number; pending: number; lastLearnedAt: string | null }>(
                `/api/projects/${pid}/evermind/contributions`,
              )
            : Promise.resolve(null),
        // Plan + month-to-date quota — the same snapshot the `/` Status tab shows.
        readPlan: () => fetchPlanSnapshot(apiReq),
        // Which BUILD produced this capture (`/health` is public; session-cached, bounded).
        readApiVersion: () => fetchApiVersionVia(() => apiReq<{ version?: string }>('/health').catch(() => null)),
      });
      // The SAME capture as one versioned JSON object, built from the MERGED trace (live
      // steps plus those recovered from durable history).
      const report = buildChatDiagnosticsReport({
        diagnostics,
        events: traceWithPersistedSteps(conv.messages, conv.trace),
        messages: conv.messages,
        model: init.model,
        running: conv.sending,
        surface: 'VS Code (VSIX)',
      });
      // Best-effort store — the copy must NEVER fail because persistence did.
      if (serverChatId != null) {
        void apiReq(`/api/brain/chats/${serverChatId}/diagnostics`, {
          method: 'POST',
          body: JSON.stringify({ report }),
        }).catch(() => {});
      }
      post('copy', {
        text: buildTranscript({
          messages: conv.messages,
          trace: conv.trace,
          assistantName: 'BuilderForce',
          model: init.model,
          error: conv.error,
          project: associatedProject,
          chatTitle: activeChat?.title,
          chatId,
          diagnostics,
          report,
          // Whether the run was STILL EXECUTING when the button was pressed — a chat
          // copied mid-run has not failed to finish the work, it has not finished YET.
          running: conv.sending,
          // The live in-flight step: WHAT the agent was doing at that instant.
          activity: conv.activity,
          subagents: subagentDiagnosticsOf(chatId),
        }),
      });
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch (e) {
      // FAIL LOUDLY: a silent failure makes the triage button the next opaque thing.
      setCopyState('error');
      conv.setError(
        `${t('app.copyFailed', 'Could not build the chat diagnostics report.')} ${e instanceof Error ? e.message : String(e)}`,
      );
      window.setTimeout(() => setCopyState('idle'), 3000);
    }
  }, [conv, init.model, init.extensionVersion, init.buildId, init.builtAt, init.posixShell, init.baseUrl, init.chatHistoryPath, modelSurface, associatedProject, associatedProjectId, activeChat?.title, chatVisibility, chatMode, chatId, serverChatId, ticketAdapter, apiReq, init.project?.id, init.project?.name, t]);

  return { copyState, canCopy, copyTranscript };
}
