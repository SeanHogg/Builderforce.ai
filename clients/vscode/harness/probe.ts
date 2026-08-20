/**
 * Run one real VSIX chat turn from a terminal.
 *
 * This is the same conversation the extension has: the same gateway, the same tenant,
 * the same chat rows, the same tool catalog, the same agent loop, the same system
 * prompt — and it prints the same report the chat's "Copy" button produces, including
 * the Chat-diagnostics header. The only thing it does NOT do is render.
 *
 * That removes four steps from every validation cycle. Instead of: change code → build a
 * `.vsix` → install it → reload the window → retype the prompt → click Copy → paste the
 * output, it is:
 *
 *     BF_EDITOR_KEY=bfk_… pnpm probe "review the backlog and group by status"
 *
 * Auth uses the same editor key the extension stores in the OS keychain — generate one
 * at `https://builderforce.ai/activate` (the page the extension's sign-in opens) and put
 * it in `BF_EDITOR_KEY`. A probe run costs real tokens and writes real chat rows,
 * exactly as a hand-run reproduction does; `--chat <id>` continues an existing
 * conversation instead of starting one.
 */

import * as path from 'node:path';
import {
  computeBrainDiagnostics,
  fetchApiVersionVia,
  fetchMcpToolEntries,
  gatherChatDiagnostics,
  getRunSnapshot,
  getRunTrace,
  mcpActionsFrom,
  nextFallbackModel,
  startRun,
  streamChatCompletion,
  subscribeRun,
  toolSpecsFor,
  traceWithPersistedSteps,
  type BrainAction,
  type BrainTransport,
} from '@seanhogg/builderforce-brain-embedded';
import { TOOL_DEFS } from '../src/fileTools';
import { authedFetch } from '../webview/src/authedFetch';
import { createPersistence } from '../webview/src/persistence';
import { fetchPlanSnapshot } from '../webview/src/planSnapshot';
import { buildIdeSystemPrompt } from '../webview/src/systemPrompt';
import { buildTranscript } from '../webview/src/transcript';

export interface ProbeOptions {
  prompt: string;
  /** Gateway base. Defaults to `BF_BASE_URL`, then the extension's shipped default. */
  baseUrl?: string;
  /** Editor key (`bfk_…`). Defaults to `BF_EDITOR_KEY`. */
  editorKey?: string;
  /** Continue an existing chat instead of creating one. */
  chatId?: number;
  /** Attach the chat to a project (enables Evermind recall + the ticket backstops). */
  projectId?: number;
  /** Pin a model. Omit to let the gateway route per turn, as the VSIX ships. */
  model?: string;
  /** Workspace root the local file tools operate on. Defaults to the current directory. */
  root?: string;
  /** Skip the gateway MCP catalog — reproduces a chat that has only local file tools. */
  localToolsOnly?: boolean;
  /** Register no tools at all — reproduces a failed catalog fetch. */
  noTools?: boolean;
  /** Called with each streamed text delta, so a CLI can echo the answer live. */
  onDelta?: (delta: string) => void;
  /** Called when a tool is dispatched, so a CLI can show progress. */
  onTool?: (name: string, args: unknown) => void;
}

export interface ProbeResult {
  chatId: number;
  /** The full copy-diagnostics report — byte-identical to the chat's Copy button. */
  transcript: string;
  /** The structured verdict, for a script that wants to assert rather than read. */
  diagnostics: ReturnType<typeof computeBrainDiagnostics>;
  /** How many tools the model was actually offered, and why not more. */
  tools: { count: number; error: string | null };
}

const DEFAULT_BASE_URL = 'https://builderforce.ai/gateway';

/** Exchange the stored editor key for a tenant JWT — the same call `bfApi.exchangeJwt`
 *  makes in the extension host. The key alone only reaches `/llm/*`; `/api/*` needs this. */
async function exchangeTenantToken(baseUrl: string, editorKey: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/tenant-api-key-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: editorKey }),
  });
  if (!res.ok) {
    throw new Error(
      `could not exchange the editor key for a tenant token (HTTP ${res.status}). `
      + 'Check BF_EDITOR_KEY and BF_BASE_URL; generate a fresh key at <web app>/activate.',
    );
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('the token exchange returned no token');
  return body.token;
}

/** Decode a JWT's claims without verifying — identity for the report only. */
function tokenClaims(token: string): { tid?: number | string; sub?: string } {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { tid?: number | string; sub?: string };
  } catch {
    return {};
  }
}

/** The extension's local file tools, executed against a real directory on disk. */
function localFileActions(root: string, onTool?: ProbeOptions['onTool']): BrainAction[] {
  return TOOL_DEFS.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    mutates: def.mutating,
    run: async (args: unknown) => {
      onTool?.(def.name, args);
      try {
        return await def.execute((args ?? {}) as Record<string, unknown>, root);
      } catch (e) {
        // Hand the model a structured failure, exactly as the webview bridge does.
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  }));
}

/** Run the prompt and return the report. */
export async function probe(opts: ProbeOptions): Promise<ProbeResult> {
  const baseUrl = (opts.baseUrl || process.env.BF_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const editorKey = opts.editorKey || process.env.BF_EDITOR_KEY || '';
  if (!editorKey) {
    throw new Error(
      'no editor key. Set BF_EDITOR_KEY (or pass --key) to the `bfk_…` key the extension signs in with — '
      + 'generate one at <web app>/activate.',
    );
  }
  const root = path.resolve(opts.root ?? process.cwd());

  const token = await exchangeTenantToken(baseUrl, editorKey);
  const getToken = () => token;
  const apiReq = authedFetch(baseUrl, getToken, () => {});
  const persistence = createPersistence(baseUrl, getToken, () => {});

  // The gateway itself still authenticates with the EDITOR KEY, not the tenant JWT —
  // `/llm/*` is the key's scope. Mirrors `gateway.ts` in the extension host.
  const transport: BrainTransport = { baseUrl, getToken: () => editorKey };

  // Tools: the extension's real local file set, plus the tenant's real MCP catalog.
  let mcpError: string | null = null;
  let actions: BrainAction[] = opts.noTools ? [] : localFileActions(root, opts.onTool);
  if (!opts.noTools && !opts.localToolsOnly) {
    try {
      const entries = await fetchMcpToolEntries(transport);
      actions = [
        ...actions,
        ...mcpActionsFrom(entries, transport, (info) => opts.onTool?.(info.name, undefined)),
      ];
    } catch (e) {
      // Deliberately not fatal: a probe whose catalog failed to load is a REPRODUCTION
      // of the most common silent chat failure, and the report must say so rather than
      // refusing to run.
      mcpError = e instanceof Error ? e.message : String(e);
    }
  }

  const chat = opts.chatId != null
    ? await persistence.getChat(opts.chatId)
    : await persistence.createChat({
        title: `Probe: ${opts.prompt.slice(0, 60)}`,
        projectId: opts.projectId ?? null,
      });
  const chatId = chat.id;
  const projectId = opts.projectId ?? chat.projectId ?? null;

  // Prior turns, so `--chat <id>` continues a conversation rather than restarting it.
  const history = await persistence.getMessages(chatId).catch(() => []);
  const seed = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  await persistence.sendMessages(chatId, [{ role: 'user', content: opts.prompt }]);

  // The model surface the loop's tool-call failover draws from — the same shared
  // selector the webview passes, so a probe fails over exactly as the VSIX does.
  const modelSurface = await apiReq<{ data?: Array<{ id?: string }>; byo?: { providers?: string[]; models?: Array<{ id?: string; vendor?: string }> }; canUsePremiumModels?: boolean }>(
    '/llm/v1/models',
  ).catch(() => null);

  let lastDelta = 0;
  const unsubscribe = subscribeRun(chatId, () => {
    const snap = getRunSnapshot(chatId);
    if (snap.streamingText.length > lastDelta) {
      opts.onDelta?.(snap.streamingText.slice(lastDelta));
      lastDelta = snap.streamingText.length;
    } else if (snap.streamingText.length < lastDelta) {
      lastDelta = snap.streamingText.length; // a new turn reset the buffer
    }
  });

  try {
    await startRun(chatId, {
      resolvedSystemPrompt: buildIdeSystemPrompt({ hasWorkspace: true }),
      tools: toolSpecsFor(actions),
      ...(opts.model ? { model: opts.model } : {}),
      pickFallbackModel: (tried) => nextFallbackModel(modelSurface ?? null, tried),
      runTool: async (name, args) => {
        const action = actions.find((a) => a.name === name);
        if (!action) return { ok: false, error: `unknown tool: ${name}` };
        return action.run(args);
      },
      stream: (streamOpts, handlers) => streamChatCompletion({ ...streamOpts, transport }, handlers),
      persistence,
      seed,
      userTurn: opts.prompt,
      projectId,
    });
  } finally {
    unsubscribe();
  }

  const messages = await persistence.getMessages(chatId).catch(() => []);
  const live = getRunTrace(chatId);
  const events = traceWithPersistedSteps(messages, live);
  const snapshot = getRunSnapshot(chatId);

  // The same identity/plan/Evermind block the Copy button gathers — through the SAME
  // assembler, not a second one that resembles it. This block used to be assembled
  // here by hand and silently omitted `projectName`, `chatVisibility`, `modelFunding`
  // and `extensionVersion`, so a probe report was "equivalent" to a Copy click rather
  // than reproducing it. Every read is best-effort inside the assembler, so one
  // unavailable endpoint degrades a line instead of the report.
  const claims = tokenClaims(token);
  const diagnosticsData = await gatherChatDiagnostics({
    surface: 'VS Code (headless probe)',
    chatId,
    chatTitle: chat.title,
    // `visibility` rides the chat row on the wire but is not on `BrainChat`; the
    // webview reads it exactly this way, so both reports name the same field.
    chatVisibility: (chat as unknown as { visibility?: 'shared' | 'locked' }).visibility ?? null,
    projectId,
    selectedProjectId: opts.projectId ?? null,
    tenantId: claims.tid ?? null,
    userId: claims.sub ?? null,
    messages,
    tools: { count: actions.length, error: mcpError, loading: false },
    trace: live,
    model: opts.model ?? null,
    modelSurface,
    uiVersion: 'headless-probe',
    baseUrl,
    // The two UI surfaces hold the project name in loaded state; a CLI has none, so
    // it reads it — the field is part of the report either way.
    readProjectName: () =>
      projectId != null
        ? apiReq<{ name?: string }>(`/api/projects/${projectId}`).then((p) => p?.name ?? null)
        : Promise.resolve(null),
    readPlan: () => fetchPlanSnapshot(apiReq),
    readApiVersion: () => fetchApiVersionVia(() => apiReq<{ version?: string }>('/health').catch(() => null)),
    readEvermind: () =>
      projectId != null
        ? apiReq<{ version: number; mode: string; inferenceEnabled: boolean; teacherModel: string | null; contributions: number; pending: number; lastLearnedAt: string | null }>(
            `/api/projects/${projectId}/evermind/contributions`,
          )
        : Promise.resolve(null),
    readAgents: () =>
      apiReq<{ agents?: Array<{ agentRef: string; role: string }> }>(`/api/brain/chats/${chatId}/agents`).then((r) => r.agents ?? []),
    readTickets: () =>
      apiReq<{ tickets?: Array<{ kind: string; ref: string; label?: string; linkType?: string; status?: string }> }>(`/api/brain/chats/${chatId}/tickets`).then((r) => r.tickets ?? []),
  });

  return {
    chatId,
    transcript: buildTranscript({
      messages,
      trace: live,
      assistantName: 'BuilderForce',
      model: opts.model,
      error: snapshot.error,
      project: projectId != null ? { id: projectId, name: chat.title } : null,
      chatTitle: chat.title,
      chatId,
      diagnostics: diagnosticsData,
    }),
    diagnostics: computeBrainDiagnostics(events, opts.model, messages),
    tools: { count: actions.length, error: mcpError },
  };
}
