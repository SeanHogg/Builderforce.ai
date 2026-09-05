/**
 * gatherChatDiagnostics — the one ASSEMBLER behind every "Copy diagnostics" report.
 *
 * {@link formatChatDiagnostics} has always been shared, so the two surfaces RENDER
 * identically. What was not shared was the step before it: each host built its own
 * {@link ChatDiagnosticsData} inline — the VS Code webview inside `App.tsx`'s
 * `copyTranscript` callback, the web app inside `BrainPanel.tsx`'s `captureExecution`,
 * the headless probe inside `probe.ts`. Three assemblies of one object, and they
 * drifted exactly as three copies do: the probe's report silently omitted
 * `projectName`, `chatVisibility`, `modelFunding` and `extensionVersion`, because those
 * four were assembled from React state the probe has no access to. A report that is
 * "equivalent" to a Copy click is not the same thing as one that is byte-identical to
 * it, and only the second can be used to reproduce a user's capture.
 *
 * So the assembly lives here, host-agnostic: the caller supplies the facts it already
 * holds and READERS for the facts it has to fetch, and this owns the parts that must
 * not be re-derived — running every read concurrently, degrading each one
 * independently to null/[], reading the observed per-turn tool exposure off the trace,
 * and classifying which purse funds the model.
 *
 * Pure of fetch, DOM and React: the readers are injected, so the same function serves
 * a webview, a Next.js client component and a Node CLI.
 */

import { classifyModelFunding, type ChatDiagnosticsAccount, type ChatDiagnosticsData, type ChatDiagnosticsEvermind, type ChatDiagnosticsMeter } from './chatDiagnostics';
import { toolExposureInTrace, type BrainTraceEvent } from './brainTriage';

/** The `/api/consumption` snapshot, structurally — each host has its own named type
 *  for it, and they agree on exactly these fields. */
export interface ChatDiagnosticsPlanSnapshot {
  period: { start: string; resetsAt: string };
  plan: { effective: string; billingStatus: string };
  meters: ChatDiagnosticsMeter[];
}

/** The `/llm/v1/models` surface, structurally — enough to classify funding and to
 *  count what the plan pool offers. */
export interface ChatDiagnosticsModelSurface {
  data?: Array<{ id?: string }>;
  byo?: { providers?: string[]; models?: Array<{ id?: string; vendor?: string }> };
  canUsePremiumModels?: boolean;
}

/** The `/api/projects/:id/evermind/contributions` head, structurally. */
export interface ChatDiagnosticsEvermindHead {
  version: number;
  mode: string;
  inferenceEnabled?: boolean;
  teacherModel?: string | null;
  contributions?: number;
  pending?: number;
  lastLearnedAt?: string | null;
}

/** The minimum of a message this needs: the last assistant turn's learn outcome.
 *  Structural on purpose so a host can pass its own message array unchanged. */
export interface ChatDiagnosticsMessageLike {
  role: string;
  evermindLearn?: { learned: boolean; version: number; reason?: string | null } | null;
}

/**
 * Everything the report needs, split into what the host KNOWS and what it must READ.
 *
 * Every reader is optional and best-effort: an omitted one is simply "not gathered"
 * and a rejecting one degrades to null/[]. That is deliberate — a diagnostics capture
 * whose whole point is to explain a broken chat must never itself fail because one of
 * the endpoints it asks about is the broken one.
 */
export interface ChatDiagnosticsSources {
  /** Which surface produced the capture ('Web' | 'VS Code (VSIX)' | …). */
  surface: string;
  chatId?: number | null;
  chatTitle?: string | null;
  /** 'shared' | 'locked'. */
  chatVisibility?: string | null;
  /** The CHAT's own project — what the learn gate keys on. */
  projectId?: number | null;
  projectName?: string | null;
  /** The project the surrounding UI currently has SELECTED — `null` when none is.
   *  Always reported, so "nothing selected" stays distinguishable from "selected but
   *  the chat never adopted it" (see `ChatDiagnosticsData.selectedProjectId`). */
  selectedProjectId?: number | null;
  /** Display name for {@link selectedProjectId}, when the host holds one. */
  selectedProjectName?: string | null;
  tenantId?: number | string | null;
  userId?: string | null;
  /** The transcript — read only for the newest assistant turn's learn outcome. */
  messages?: readonly ChatDiagnosticsMessageLike[];
  /** The live tool registry the conversation runs on, and why it might be short. */
  tools?: { count: number; error?: string | null; loading?: boolean };
  /** The run's trace, so the report states the tools the model was ACTUALLY handed
   *  per turn rather than a ceiling derived from the registry size. */
  trace?: readonly BrainTraceEvent[];
  /** The model pinned for this chat, or null when the gateway routes per turn. */
  model?: string | null;
  /** The model surface the pickers already loaded — reused, never re-fetched. */
  modelSurface?: ChatDiagnosticsModelSurface | null;
  /** The build that produced the capture (extension version / web app version). */
  uiVersion?: string | null;
  /** Short SOURCE HASH of the client artifact — the identity `uiVersion` cannot carry
   *  (two artifacts can share a version and differ in code). `"dev"` when unbundled. */
  uiBuildId?: string | null;
  /** ISO timestamp the client artifact was built. */
  uiBuiltAt?: string | null;
  /** Source hash of the WEBVIEW bundle, when the surface ships one separately from its
   *  host. Both halves of the VS Code extension travel in one `.vsix`, so these match in
   *  a released install — a MISMATCH is the case that used to be invisible, and the one
   *  that made "is the host older than the version it reports?" unanswerable. */
  webviewBuildId?: string | null;
  webviewBuiltAt?: string | null;
  /** Whether this machine can run the POSIX git scripts (`git_sync_latest` / `undo` /
   *  `redo`). Absent on a surface with no local shell. */
  posixShell?: string | null;
  /** The gateway this surface is talking to. */
  baseUrl?: string | null;

  /** Resolve the chat project's NAME when the host does not already hold it (the two
   *  UI surfaces read it from a loaded project list; the headless probe has none).
   *  Wins over the static `projectName` above when it answers. */
  readProjectName?: () => Promise<string | null>;
  readAgents?: () => Promise<Array<{ agentRef: string; role: string }>>;
  readTickets?: () => Promise<Array<{ kind: string; ref: string; label?: string; linkType?: string; status?: string }>>;
  readEvermind?: () => Promise<ChatDiagnosticsEvermindHead | null>;
  readPlan?: () => Promise<ChatDiagnosticsPlanSnapshot | null>;
  /** Resolve the deployed API version — bounded + session-cached by
   *  `fetchApiVersionVia`, which every host reaches it through. */
  readApiVersion?: () => Promise<string | null>;
}

/** Run a best-effort read: never throws, never rejects, degrades to `fallback`. */
function safely<T>(read: (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (!read) return Promise.resolve(fallback);
  try {
    return read().then((v) => v ?? fallback, () => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}

/** Normalize an Evermind head into the reported shape, dropping absent optionals so
 *  "not returned by this API version" stays distinguishable from "zero". */
function toEvermind(head: ChatDiagnosticsEvermindHead | null): ChatDiagnosticsEvermind | null {
  if (!head) return null;
  return {
    version: head.version,
    mode: head.mode,
    ...(head.inferenceEnabled != null ? { inferenceEnabled: head.inferenceEnabled } : {}),
    teacherModel: head.teacherModel ?? null,
    ...(head.contributions != null ? { contributions: head.contributions } : {}),
    ...(head.pending != null ? { pending: head.pending } : {}),
    lastLearnedAt: head.lastLearnedAt ?? null,
  };
}

/**
 * Assemble the diagnostics payload. Resolves — never rejects — so a caller can hand
 * the result straight to {@link formatChatDiagnostics} without a try/catch that would
 * only ever produce a worse report.
 */
export async function gatherChatDiagnostics(src: ChatDiagnosticsSources): Promise<ChatDiagnosticsData> {
  const [projectName, agents, tickets, head, plan, apiVersion] = await Promise.all([
    safely(src.readProjectName, null as string | null),
    safely(src.readAgents, [] as Array<{ agentRef: string; role: string }>),
    safely(src.readTickets, [] as Array<{ kind: string; ref: string; label?: string; linkType?: string; status?: string }>),
    safely(src.readEvermind, null as ChatDiagnosticsEvermindHead | null),
    safely(src.readPlan, null as ChatDiagnosticsPlanSnapshot | null),
    safely(src.readApiVersion, null as string | null),
  ]);

  // The learn-gate outcome for the NEWEST assistant turn: walk back, first one wins.
  // (`.reverse()` on the caller's array would mutate it — a diagnostics capture must
  // not reorder the transcript it is describing.)
  let lastLearn: ChatDiagnosticsData['lastLearn'] = null;
  const msgs = src.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.evermindLearn) { lastLearn = m.evermindLearn; break; }
  }

  // What the model was ACTUALLY handed per turn, off the run's own trace — the number
  // the ceiling used to stand in for. Nulls when no turn in this run was measured.
  const exposure = src.trace ? toolExposureInTrace([...src.trace]) : null;

  const account: ChatDiagnosticsAccount = {
    plan: plan?.plan.effective ?? null,
    billingStatus: plan?.plan.billingStatus ?? null,
    periodStart: plan?.period.start ?? null,
    resetsAt: plan?.period.resetsAt ?? null,
    meters: plan?.meters ?? [],
    model: src.model ?? null,
    // Funding was one of the four fields the probe silently dropped, which is how a
    // probe report could look clean about a chat whose model the plan cannot fund.
    modelFunding: src.modelSurface ? classifyModelFunding(src.model, src.modelSurface) : null,
    ...(src.modelSurface?.canUsePremiumModels != null ? { canUsePremiumModels: src.modelSurface.canUsePremiumModels } : {}),
    ...(src.modelSurface?.data ? { planModelCount: src.modelSurface.data.length } : {}),
    byoProviders: src.modelSurface?.byo?.providers ?? [],
    extensionVersion: src.uiVersion ?? null,
    baseUrl: src.baseUrl ?? null,
  };

  return {
    surface: src.surface,
    chatId: src.chatId ?? null,
    chatTitle: src.chatTitle ?? null,
    chatVisibility: src.chatVisibility ?? null,
    projectId: src.projectId ?? null,
    projectName: projectName ?? src.projectName ?? null,
    selectedProjectId: src.selectedProjectId ?? null,
    selectedProjectName: src.selectedProjectName ?? null,
    tenantId: src.tenantId ?? null,
    userId: src.userId ?? null,
    evermind: toEvermind(head),
    lastLearn,
    agents: agents.map((a) => ({ agentRef: a.agentRef, role: a.role })),
    tickets: tickets.map((tk) => ({ kind: tk.kind, ref: tk.ref, label: tk.label, linkType: tk.linkType, status: tk.status })),
    account,
    tools: src.tools
      ? {
          count: src.tools.count,
          error: src.tools.error ?? null,
          loading: src.tools.loading ?? false,
          advertisedMin: exposure?.min ?? null,
          advertisedLastTurn: exposure?.lastTurn ?? null,
        }
      : null,
    versions: {
      ui: src.uiVersion ?? null,
      api: apiVersion,
      uiBuildId: src.uiBuildId ?? null,
      uiBuiltAt: src.uiBuiltAt ?? null,
      webviewBuildId: src.webviewBuildId ?? null,
      webviewBuiltAt: src.webviewBuiltAt ?? null,
      posixShell: src.posixShell ?? null,
    },
  };
}
