/**
 * businessValueAI — the LLM half of the manager's business-value scoring.
 *
 * Asks a FREE-pool model (same `ideProxy` the task classifier uses, so it spends
 * nothing on paid vendors) for a ticket's RICE components under a strict JSON
 * schema, then folds them into a bounded 0-100 score via the pure
 * {@link deriveRiceScore}. Best-effort by contract: ANY failure returns null so the
 * caller falls back to the deterministic {@link heuristicBusinessValue} — value
 * backfill must always complete and never block the sweep on model availability.
 */
import type { Env } from '../../env';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { deriveRiceScore, type ScoredValue } from './businessValue';

const SYSTEM_PROMPT =
  'You are a delivery manager scoring the BUSINESS VALUE of a backlog ticket via RICE. ' +
  'Estimate reach (1-10 = how many users / how often), impact (1-5 = value per user), ' +
  'confidence (0-1 = certainty), effort (1-10 = relative build cost), and a <=12-word rationale. ' +
  'Reply with JSON only.';

const RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'ticket_business_value',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reach', 'impact', 'confidence', 'effort', 'rationale'],
      properties: {
        reach: { type: 'number', minimum: 0, maximum: 10 },
        impact: { type: 'number', minimum: 0, maximum: 5 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        effort: { type: 'number', minimum: 1, maximum: 10 },
        rationale: { type: 'string' },
      },
    },
  },
};

/**
 * RICE-score one ticket with the model. Returns a {@link ScoredValue} (source 'ai')
 * or null on the kill switch / any failure. Never throws.
 *
 * `personaDirective` lets the DESIGNATED manager agent value the backlog AS ITSELF:
 * its persona (compiled from the agent's psychometric profile) steers the judgement
 * so a risk-averse, methodical manager scores conservatively. Omit for the system
 * manager (no persona) — the historical behaviour. Scoring always runs on the free
 * pool regardless of the agent's model, so grooming stays cost-free.
 */
export async function scoreBusinessValueAI(
  env: Env,
  task: { title: string; description?: string | null },
  personaDirective?: string | null,
): Promise<ScoredValue | null> {
  try {
    const userPrompt =
      `Title: ${task.title}\n` +
      (task.description ? `Description: ${String(task.description).slice(0, 2000)}\n` : '') +
      '\nScore this ticket.';

    const systemContent = personaDirective?.trim()
      ? `${SYSTEM_PROMPT}\n\nYou are scoring AS this manager — let your persona shape the estimate:\n${personaDirective.trim()}`
      : SYSTEM_PROMPT;

    const result = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: RESPONSE_SCHEMA,
      useCase: 'business_value_scoring',
    });

    if (result.response.status >= 400) return null;
    const { content } = await readProxyChoice(result);
    if (!content) return null;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
    const num = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const reach = num(obj.reach);
    const impact = num(obj.impact);
    const confidence = num(obj.confidence);
    const effort = num(obj.effort);
    if (reach == null || impact == null || confidence == null || effort == null) return null;

    const score = deriveRiceScore({ reach, impact, confidence, effort });
    const rationale = typeof obj.rationale === 'string' && obj.rationale.trim()
      ? obj.rationale.trim().slice(0, 160)
      : `RICE-scored (R${reach}·I${impact}·C${confidence}÷E${effort}).`;
    return { score, rationale, source: 'ai' };
  } catch {
    return null;
  }
}
