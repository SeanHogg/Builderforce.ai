/**
 * The codec seam. `@builderforce/agent-loop`'s `openAiChatCodec({ toolResultPolicy })`
 * takes a plain `(toolName, data) => string` so the kernel stays dependency-free; this
 * builds that function from the shared policy for a surface that has no advisory of its
 * own (the cloud durable loop, the container image loop).
 */

import { shapeToolResult } from './policy.js';

export type ToolResultPolicyFn = (toolName: string, data: unknown) => string;

export interface ModelToolResultPolicyOptions {
  /** The C7 lever decision. */
  summarize: boolean;
  caps?: Readonly<Record<string, number>>;
}

export function modelToolResultPolicy(opts: ModelToolResultPolicyOptions): ToolResultPolicyFn {
  return (toolName, data) => shapeToolResult(toolName, data ?? null, { summarize: opts.summarize, caps: opts.caps }).content;
}
