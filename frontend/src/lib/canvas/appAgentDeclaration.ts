/**
 * DECLARING AN APP AGENT from the canvas (W12) — the three calls the declaration form
 * needs, over the built-in tool client, and the hints it shows before sending. No React
 * here, and no verdict either: whether a declaration is acceptable is decided by
 * `app_manifest.add_agent` running the runtime's own validator, and whether the caller may
 * touch the project is decided by the server.
 *
 * The manifest file is the only store. Nothing here caches what an agent is.
 */
import { MANIFEST_READ_PATHS } from '@builderforce/app-detect/manifest';
import { toAgentDeclaration, type AgentDraft } from '@builderforce/creation-canvas-contract';
import { ApiRequestError } from '@/lib/apiClient';
import { callBuiltinTool, listBuiltinToolKeys } from '@/lib/builtinTools';
import { ENV_TOOL_KEYS, readManifestAgent, TOOL_KEY_PATTERN, type ManifestAgent } from './manifestAgents';

/** A refused declaration: the tool's sentence, and each typed issue's own one-line message. */
export interface AgentDeclarationRefusal {
  error: string;
  issues: ReadonlyArray<{ code: string; path: string; message: string }>;
}

export type AgentDeclarationResult = { ok: true; agentId: string } | { ok: false; refusal: AgentDeclarationRefusal };

/**
 * The tool keys an agent may be granted: the runtime's environment tools and the built-in
 * catalog this caller may run, each a key the manifest accepts (`TOOL_KEY_PATTERN`, the
 * runtime's own rule, mirrored in `manifestAgents`). The catalog is loaded, never listed:
 * a new tool reaches the form by existing.
 */
export async function loadAgentToolOptions(): Promise<string[]> {
  const catalog = await listBuiltinToolKeys();
  return [...new Set<string>([...ENV_TOOL_KEYS, ...catalog])].filter((key) => TOOL_KEY_PATTERN.test(key));
}

/**
 * What the form can see BEFORE it sends — for the reader's sake only. These are hints, not
 * verdicts: whether a declaration is acceptable is the runtime's validator's to say, run by
 * `app_manifest.add_agent`, and its typed issues come back as the refusal. A missing role is
 * asked as a question; a granted tool outside the catalog the caller may run is pointed at.
 */
export interface AgentDraftGaps {
  missingId: boolean;
  missingRole: boolean;
  /** Granted tools not among `toolOptions`; empty while the options load. */
  unknownTools: string[];
}

export function agentDraftGaps(draft: AgentDraft, toolOptions: readonly string[] | null): AgentDraftGaps {
  return {
    missingId: !draft.id.trim(),
    missingRole: !draft.role.key.trim(),
    unknownTools: toolOptions ? draft.tools.filter((tool) => !toolOptions.includes(tool)) : [],
  };
}

/** Whether the draft is worth sending: an id and a role. Everything else is the validator's call. */
export function agentDraftSendable(gaps: AgentDraftGaps): boolean {
  return !gaps.missingId && !gaps.missingRole;
}

/** The draft as the room's agent station will read it once declared — the form's preview. */
export function agentDraftPreview(draft: AgentDraft): ManifestAgent {
  return readManifestAgent(draft.id, { ...toAgentDeclaration(draft) });
}

/** Whether the project holds an app manifest, read where `add_agent` reads it. */
export async function projectHasAppManifest(projectId: number): Promise<boolean> {
  for (const path of MANIFEST_READ_PATHS) {
    try {
      await callBuiltinTool('project_files.read', { projectId, path }, { expectedErrors: [404] });
      return true;
    } catch (error) {
      // Absent at this path is the next path's turn; anything else is a real failure.
      if (error instanceof ApiRequestError && error.status === 404) continue;
      throw error;
    }
  }
  return false;
}

interface AddAgentReply {
  ok?: boolean;
  agentId?: unknown;
  error?: unknown;
  errors?: Array<{ code?: unknown; path?: unknown; message?: unknown }>;
}

/** Declare `draft` in the project's manifest. A refusal is a result; a relay failure throws. */
export async function declareAppAgent(projectId: number, draft: AgentDraft): Promise<AgentDeclarationResult> {
  const reply = (await callBuiltinTool('app_manifest.add_agent', {
    projectId,
    id: draft.id,
    agent: toAgentDeclaration(draft),
  })) as AddAgentReply | null;
  if (reply?.ok === true) return { ok: true, agentId: String(reply.agentId ?? draft.id) };
  return {
    ok: false,
    refusal: {
      error: typeof reply?.error === 'string' ? reply.error : '',
      issues: (reply?.errors ?? []).map((issue) => ({
        code: String(issue.code ?? ''),
        path: String(issue.path ?? ''),
        message: String(issue.message ?? ''),
      })),
    },
  };
}
