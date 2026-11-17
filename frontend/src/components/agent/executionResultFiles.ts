import type { ExecutionTraceToolEvent } from '@/lib/builderforceApi';
import type { ExecutionFileChange } from './useExecutionStream';

/** The JSON result blob a settled execution persists (or its raw text output). */
export interface AgentResult {
  summary?: string;
  output?: string;
  files?: Array<{ path: string; status?: string }>;
  changedFiles?: string[];
}

export function parseResult(raw: unknown): AgentResult | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try { return JSON.parse(raw) as AgentResult; } catch { return { output: raw }; }
}

/** File paths an agent touched, merged from the result blob and tool-call args. */
export function filesFromResult(result: AgentResult | null, toolEvents: ExecutionTraceToolEvent[]): ExecutionFileChange[] {
  const map = new Map<string, ExecutionFileChange>();
  const add = (path: string, change: ExecutionFileChange['change']) => {
    if (path) map.set(path, { path, change, ts: '' });
  };
  result?.files?.forEach((f) => f.path && add(f.path, (f.status as ExecutionFileChange['change']) ?? 'modified'));
  result?.changedFiles?.forEach((p) => add(p, 'modified'));
  for (const ev of toolEvents) {
    if (!/write|create_file|edit|apply|patch|save|delete|remove|rm/i.test(ev.toolName)) continue;
    try {
      const args = ev.args ? JSON.parse(ev.args) as Record<string, unknown> : {};
      const path = (args.path ?? args.file ?? args.filename) as string | undefined;
      if (path) add(path, /delete|remove|rm/i.test(ev.toolName) ? 'deleted' : 'modified');
    } catch { /* ignore unparseable args */ }
  }
  return [...map.values()];
}
