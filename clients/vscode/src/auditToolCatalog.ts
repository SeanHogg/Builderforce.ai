import type * as vscode from 'vscode';
import type { ToolDef } from './fileTools';
import { authed } from './bfApi';
import type { CodeAnalysisSnapshot } from '@builderforce/agent-tools';

/** Audits can inspect source and request command approval, but cannot edit source or dispatch more work. */
export function auditToolCatalog(secrets: vscode.SecretStorage, tools: readonly ToolDef[], projectId: number,
  audit: { auditId: string; runId: string }): ToolDef[] {
  const readable = tools.filter((t) => !t.mutating && !/spawn|delegate/i.test(t.name));
  let analysis: CodeAnalysisSnapshot | undefined;
  const commands = tools.filter((t) => !t.remote && /^(run_command|run_tests|analyze_codebase)$/.test(t.name)).map((tool) => tool.name !== 'analyze_codebase' ? tool : {
    ...tool, execute: async (args: Record<string, unknown>, root: string) => {
      const text = await tool.execute(args, root);
      analysis = (JSON.parse(text) as { snapshot?: CodeAnalysisSnapshot }).snapshot;
      return text;
    },
  });
  return [...readable, ...commands.filter((t) => !readable.includes(t)), {
    name: 'save_audit_findings', description: 'Save every audit finding, including source locations and evidence. The platform creates remediation tickets. Submit an empty array for a clean pass. Call this before finishing.',
    parameters: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, detail: { type: 'string' }, location: { type: 'string' },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] }, recommendation: { type: 'string' },
    }, required: ['title', 'severity'] } } }, required: ['findings'] },
    // This write is the output explicitly authorized by starting the audit, scoped by the host.
    mutating: false, remote: true,
    execute: async (args) => JSON.stringify(await authed(secrets, `/api/tools/audits/${encodeURIComponent(audit.auditId)}/findings`, {
      method: 'POST', body: JSON.stringify({ projectId, runId: audit.runId, findings: args.findings, ...(analysis ? { analysis } : {}) }),
    })),
  }];
}
