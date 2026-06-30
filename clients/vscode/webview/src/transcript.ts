/**
 * Plain-text transcript serializer for triage.
 *
 * Re-uses the SHARED timeline view-model (`buildTimeline`) so the copied text
 * matches exactly what the <BrainTimeline> renders — user/assistant turns plus
 * the execution trace (thinking, tool input/output, errors). That lets a user
 * copy a "No response" turn together with the underlying tool errors and system
 * output it carried, and paste it somewhere to triage.
 */

import { buildTimeline, formatPayload, formatDuration } from '@seanhogg/builderforce-brain-ui';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';

export interface TranscriptInput {
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  assistantName: string;
  model?: string;
  error?: string | null;
}

/** True when there is something worth copying (any turn, trace step, or error). */
export function hasTranscriptContent(input: { messages: unknown[]; trace: unknown[]; error?: string | null }): boolean {
  return input.messages.length > 0 || input.trace.length > 0 || !!input.error;
}

function fenced(label: string, payload: string, lines: string[]): void {
  if (!payload) return;
  lines.push(`${label}:`, '```', payload, '```');
}

/** Serialize the live conversation into a Markdown transcript. */
export function buildTranscript(input: TranscriptInput): string {
  const nodes = buildTimeline({ messages: input.messages, trace: input.trace, streamingText: '', isRunning: false });
  const lines: string[] = ['# BuilderForce chat transcript'];
  if (input.model) lines.push(`Model: ${input.model}`);
  lines.push('');

  for (const node of nodes) {
    switch (node.kind) {
      case 'user':
        lines.push('## You');
        if (node.text) lines.push(node.text);
        for (const img of node.images) lines.push(`[image: ${img.name ?? img.url}]`);
        break;
      case 'assistant':
        lines.push(`## ${input.assistantName}`);
        lines.push(node.text || '(no response)');
        break;
      case 'thinking':
        lines.push(`_thought for ${formatDuration(node.durationMs)}_`);
        break;
      case 'tool':
        lines.push(`### Tool: ${node.label}${node.isError ? ' — ERROR' : ''}`);
        fenced('Input', formatPayload(node.args), lines);
        fenced('Output', formatPayload(node.result), lines);
        break;
      case 'error':
        lines.push(`### Error: ${node.label}`, node.message);
        break;
    }
    lines.push('');
  }

  if (input.error) lines.push('### Conversation error', input.error, '');

  return `${lines.join('\n').trim()}\n`;
}
