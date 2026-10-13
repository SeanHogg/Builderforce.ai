/**
 * `condenseTranscript` — moved here unchanged from `meetings/meetingIntelligence.ts`
 * (PRD 33 §6 "one condense primitive"): meetings, the sell motion and the Insights
 * summaries all condense a transcript-shaped text through this ONE seam, so the
 * plan-aware proxy resolution and the grounding refusal exist once.
 */
import type { Env } from '../../env';
import { readProxyChoice } from './LlmProxyService';
import { tenantProxyForPlan } from './tenantProxy';

/**
 * THE transcript-condensing primitive. One model call, two consumers.
 *
 * ── WHY THIS WAS EXTRACTED ───────────────────────────────────────────────────
 * Meetings have condensed a transcript into minutes since 0330. The sell motion needs
 * exactly the same act for a `call` card — take what was said, produce a faithful
 * structured reading of it — and the sales half needs a DIFFERENT structure out
 * (objections and a commitment, not decisions and action items).
 *
 * The two things that must not be duplicated are the parts that are easy to get subtly
 * wrong and impossible to notice: the plan-aware proxy resolution, the temperature, the
 * token bound, and — above all — the refusal. `Only use what is in the transcript` is the
 * sentence that stops a model inventing a decision somebody is then held to, and a second
 * copy of it is a second place it can be softened. What each caller supplies is the SHAPE
 * it wants back; what neither caller gets to restate is the grounding rule.
 *
 * Returns the model's text, or an error. Never a fabricated fallback — a summary of a
 * conversation that did not happen is worse than no summary.
 */
export async function condenseTranscript(
  env: Env,
  tenantId: number,
  input: { transcript: string; header: string; shape: string; maxTokens?: number },
): Promise<{ text: string } | { error: string }> {
  const transcript = input.transcript.trim();
  if (!transcript) return { error: 'No transcript to summarize yet.' };

  // The one sentence neither caller may restate, followed by the shape each one wants.
  const system = `${input.shape}\n\nOnly use what is in the transcript — never invent decisions, owners, quotations, commitments or tasks. If the transcript does not support a section, omit it rather than filling it.`;
  const user = `${input.header}\n\nTranscript:\n${transcript}`;

  const { proxy } = await tenantProxyForPlan(env, tenantId, { codingOnly: true });
  const result = await proxy.complete({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }] as never,
    temperature: 0.3,
    max_tokens: input.maxTokens ?? 800,
  });
  const { content } = await readProxyChoice(result);
  const text = (content ?? '').trim();
  return text ? { text } : { error: 'The model produced nothing to record.' };
}
