import type { TimelineNode } from '../timelineModel';
import { commandOf } from '../toolStepView';

export type ToolNode = Extract<TimelineNode, { kind: 'tool' }>;
export interface ToolGroup {
  kind: 'toolGroup';
  key: string;
  tools: ToolNode[];
}

/** Group only adjacent calls; narration, questions and runtime notices stay in order.
 * Applied after windowing so a collapsed group cannot bypass the transcript's DOM limit. */
export function groupToolNodes(nodes: readonly TimelineNode[]): (Exclude<TimelineNode, ToolNode> | ToolGroup)[] {
  const rows: (Exclude<TimelineNode, ToolNode> | ToolGroup)[] = [];
  for (const node of nodes) {
    const last = rows[rows.length - 1];
    if (node.kind !== 'tool') rows.push(node);
    else if (last?.kind === 'toolGroup') last.tools.push(node);
    else rows.push({ kind: 'toolGroup', key: `tools:${node.key}`, tools: [node] });
  }
  return rows;
}

export interface ToolGroupLabels {
  toolGroupCommands: string;
  toolGroupUsed: string;
  toolGroupFailed: string;
}

export function toolGroupSummary(tools: readonly ToolNode[], labels: ToolGroupLabels): string {
  const commands = tools.filter((node) => commandOf(node.args) !== null).length;
  const others = tools.filter((node) => commandOf(node.args) === null);
  const parts: string[] = [];
  if (others.length) parts.push(labels.toolGroupUsed
    .replace('{tools}', [...new Set(others.map((node) => node.label))].join(', '))
    .replace('{count}', String(others.length)));
  if (commands) parts.push(labels.toolGroupCommands.replace('{count}', String(commands)));
  return parts.join(' · ');
}
