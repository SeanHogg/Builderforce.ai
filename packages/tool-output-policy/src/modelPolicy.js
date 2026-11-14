/**
 * The codec seam. `@builderforce/agent-loop`'s `openAiChatCodec({ toolResultPolicy })`
 * takes a plain `(toolName, data) => string` so the kernel stays dependency-free; this
 * builds that function from the shared policy for a surface that has no advisory of its
 * own (the cloud durable loop, the container image loop).
 */
import { shapeToolResult } from './policy.js';
export function modelToolResultPolicy(opts) {
    return (toolName, data) => shapeToolResult(toolName, data ?? null, { summarize: opts.summarize, caps: opts.caps }).content;
}
//# sourceMappingURL=modelPolicy.js.map