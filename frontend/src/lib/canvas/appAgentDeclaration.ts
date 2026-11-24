/**
 * DECLARING AN APP AGENT from the canvas (W12) — the three calls the declaration form
 * needs, over the built-in tool client. No React here, and no rule either: whether a
 * declaration is acceptable is decided by `app_manifest.add_agent` running the runtime's
 * own validator, and whether the caller may touch the project is decided by the server.
 *
 * The manifest file is the only store. Nothing here caches what an agent is.
 */
import { MANIFEST_READ_PATHS } from '@builderforce/app-detect/manifest';
import { toAgentDeclaration, type AgentDraft } from '@builderforce/creation-canvas-contract';
import { TOOL_KEY_PATTERN } from '@seanhogg/builderforce-webcontainers-core/manifest';
import { ApiRequestError } from '@/lib/apiClient';
import { callBuiltinTool, listBuiltinToolKeys } from '@/lib/builtinTools';

/** A refused declaration: the tool's sentence, and each typed issue's own one-line message. */
export interface AgentDeclarationRefusal {
  error: string;
  issues: ReadonlyArray<{ code: string; path: string; message: string }>;
}

export type AgentDeclarationResult = { ok: true; agentId: string } | { ok: false; refusal: AgentDeclarationRefusal };

/**
 * The tool keys an agent may be granted: the runtime's environment tools and the built-in
 * catalog this caller may run, each a key the manifest accepts (`TOOL_KEY_PATTERN`, the
 * runtime's own rule). Loaded, never listed: a new tool reaches the form by existing.
 */
export async function loadAgentToolOptions(): Promise<string[]> {
  const [{ ENV_TOOL_KEYS }, catalog] = await Promise.all([
    import('@seanhogg/builderforce-webcontainers/agents'),
    listBuiltinToolKeys(),
  ]);
  return [...new Set<string>([...ENV_TOOL_KEYS, ...catalog])].filter((key) => TOOL_KEY_PATTERN.test(key));
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
