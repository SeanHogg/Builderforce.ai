/**
 * cloudAdapterTools — the cloud run's own tools and the host's containment of them (PRD 35 WS3).
 *
 *   • {@link platformTools}  — the curated platform tools (create a follow-up task, update an OKR,
 *     read what remains) the run advertises beside the registry's, dispatched in-process under the
 *     MANAGER role, plus the saved-analysis shaping of `analyze_codebase`. The agent advertises and
 *     gates them like any other tool; this is only what each one DOES on this surface.
 *   • {@link containProvider} — the run's declared footprint limits and outbound-content inspection,
 *     enforced where the effect happens: a write that would exceed `max_files` is refused with the
 *     named reason, and a question or message carrying credential material never leaves the run.
 * Governance owners (`domain/containment`, `trust/`) are unchanged; this only routes the call through them.
 */
import type { ToolExtension } from '@builderforce/agent-run';
import type { CapabilityProvider } from '@builderforce/agent-tools';
import type { Env } from '../../env';
import { checkFootprintLimits, type RunLimits } from '../../domain/containment/runLimits';
import { isHumanOrExternalOutputTool } from '../../domain/trust/contentTrust';
import type { Db } from '../../infrastructure/database/connection';
import { callBuiltinTool, cloudAgentPlatformToolSchemas, resolveCloudAgentPlatformTool } from '../llm/builtinMcpService';
import { inspectOutboundContent } from '../trust/trustService';
import { ANALYZE_CODEBASE_TOOL, withSavedAnalysis } from './cloudAgent/auditAnalysis';
import { CLOUD_RUN_TENANT_ROLE } from './cloudAgentTools';
import { recordCloudToolEvent } from './cloudToolEvents';

export interface PlatformToolsArgs {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  /** Where this run's tokens bill — a child's are its parent's; also the provenance of a remembered fact. */
  meterExecutionId: number;
  executionId: number;
  cloudAgentRef?: string;
  originatingChatId?: number;
}

const BLOCKED = (reasons: string[], what: string): { ok: false; error: string } =>
  ({ ok: false, error: `Outbound content blocked: ${reasons.join(', ')}. Remove credential material before ${what}.` });

export function platformTools(a: PlatformToolsArgs): ToolExtension {
  const chat = a.originatingChatId;
  const schemas = cloudAgentPlatformToolSchemas(chat);
  return {
    schemas: () => schemas,
    handles: (name) => resolveCloudAgentPlatformTool(name, chat) != null,
    async dispatch(name, args) {
      const tool = resolveCloudAgentPlatformTool(name, chat);
      if (!tool) return { data: { ok: false, error: `unknown platform tool '${name}'` }, isError: true };
      if (isHumanOrExternalOutputTool(name)) {
        const inspection = await inspectOutboundContent(a.db, { tenantId: a.tenantId, executionId: a.executionId, seam: 'tool_output', target: name, content: JSON.stringify(args) });
        if (!inspection.ok) return { data: BLOCKED(inspection.reasons, 'contacting a human or external system'), isError: true };
      }
      // Run in-process, tenant-scoped, defaulting the project to THIS run's so a follow-up task lands on the
      // right project unless the model names another. MANAGER role so the OKR/task writes the user asked for are
      // permitted; the curated subset is admin/destructive-free so this can't reach keys/security/etc.
      try {
        const data = await callBuiltinTool(a.db, {
          tenantId: a.tenantId, tool,
          arguments: { projectId: a.projectId, ...args, ...(chat != null ? { chatId: chat } : {}) },
          env: a.env, userId: a.cloudAgentRef ?? null, agentRef: a.cloudAgentRef ?? null,
          role: CLOUD_RUN_TENANT_ROLE,
          // Provenance (ticket 5301): this run formed the belief, so a project_facts.remember from here carries the execution id.
          executionId: a.meterExecutionId,
        });
        return { data: data && typeof data === 'object' ? (data as Record<string, unknown>) : { ok: true, result: data } };
      } catch (e) {
        return { data: { ok: false, error: e instanceof Error ? e.message : String(e) }, isError: true };
      }
    },
    // `analyze_codebase` (over the sandbox's shell): the full snapshot is saved for the visualizer and the model reads a bounded summary.
    shape: async (name, data) =>
      name === ANALYZE_CODEBASE_TOOL && data && typeof data === 'object'
        ? withSavedAnalysis(a.db, { tenantId: a.tenantId, projectId: a.projectId, executionId: a.executionId }, data as Record<string, unknown>)
        : data,
  };
}

export interface ContainArgs {
  db: Db;
  tenantId: number;
  executionId: number;
  cloudAgentRef?: string;
  declared: Pick<RunLimits, 'maxFiles' | 'maxRepositories' | 'maxSpendMillicents'> | undefined;
  /** The live set of paths the run has written. */
  writtenPaths: ReadonlySet<string>;
  /** Whether a repository is bound (the footprint counts it). */
  repositories: number;
}

/** The provider, with the declared footprint enforced on every write and outbound content inspected on every ask. */
export function containProvider(provider: CapabilityProvider, a: ContainArgs): CapabilityProvider {
  const write = provider.repoWrite;
  const human = provider.human;
  const refuse = async (tool: string, path: string, reason: string) => {
    await recordCloudToolEvent(a.db, { tenantId: a.tenantId, cloudAgentRef: a.cloudAgentRef, executionId: a.executionId, toolName: 'containment.blocked', category: 'tool', detail: { tool, path, limits: a.declared }, result: reason });
    return { ok: false as const, error: `Blocked by the run's declared containment policy: ${reason}.` };
  };
  const footprint = (path: string): string | null => {
    if (!a.declared) return null;
    const files = a.writtenPaths.has(path) ? a.writtenPaths.size : a.writtenPaths.size + 1;
    return checkFootprintLimits(a.declared, { files, repositories: a.repositories });
  };
  return {
    ...provider,
    ...(write ? {
      repoWrite: {
        ...write,
        writeFile: async (path, content, summary) => { const why = footprint(path); return why ? refuse('write_file', path, why) : write.writeFile(path, content, summary); },
        editFile: async (path, oldString, newString, replaceAll) => { const why = footprint(path); return why ? refuse('edit_file', path, why) : write.editFile(path, oldString, newString, replaceAll); },
        deleteFile: async (path, reason) => { const why = footprint(path); return why ? refuse('delete_file', path, why) : write.deleteFile(path, reason); },
      },
    } : {}),
    ...(human ? {
      human: {
        ...human,
        ask: async (question, context) => {
          const inspection = await inspectOutboundContent(a.db, { tenantId: a.tenantId, executionId: a.executionId, seam: 'tool_output', target: 'ask_human', content: JSON.stringify({ question, context }) });
          if (!inspection.ok) return { paused: false, error: `Outbound content blocked: ${inspection.reasons.join(', ')}. Remove credential material before contacting a human or external system.` };
          return human.ask(question, context);
        },
      },
    } : {}),
  };
}
