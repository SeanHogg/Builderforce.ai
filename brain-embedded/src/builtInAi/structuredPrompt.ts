/**
 * The Prompt API as a TASK adapter (PRD 42 · B2): `json` with `responseConstraint` (the
 * schema is enforced by the browser), and the generic fallback for summarize / rewrite /
 * write / proofread when the dedicated API is absent. Reads the Prompt API only through
 * `promptApi.ts` — the one detection of it.
 */

import { jsonPrompt, parseJsonReply, proofreadPrompt, rewritePrompt, summarizePrompt, writePrompt, type PromptPair } from '../onDevice/taskPrompts';
import {
  promptApiAvailability, promptApiFactory, promptApiInputQuota, promptApiMeasure,
  type PromptApiFactory, type PromptApiSession,
} from './promptApi';
import { nullOnFailure, sessionBudget, type BuiltInAdapter, type InputBudget } from './taskSession';

/** Fixed sampling for utility work: deterministic enough to validate. */
const SAMPLING = { temperature: 0.2, topK: 3 } as const;

/** Open a session seeded with `system`, or null when the Prompt API is absent / not `available`. */
async function open(system: string, signal?: AbortSignal): Promise<PromptApiSession | null> {
  const factory: PromptApiFactory | null = promptApiFactory();
  if (!factory || (await promptApiAvailability(factory)) !== 'available') return null;
  return factory.create({ ...SAMPLING, initialPrompts: [{ role: 'system', content: system }], ...(signal ? { signal } : {}) });
}

/** One prompt in, the reply out; the session is gone before this returns. */
function ask(pair: PromptPair, signal?: AbortSignal, schema?: object): Promise<string | null> {
  return nullOnFailure(async () => {
    const session = await open(pair.system, signal);
    if (!session) return null;
    try {
      // A prompt over the window is not attempted — the caller chunks or falls through.
      const quota = promptApiInputQuota(session);
      const used = await promptApiMeasure(session, pair.user, signal);
      if (quota !== undefined && used !== undefined && used + (session.inputUsage ?? 0) > quota) return null;
      const reply = await session.prompt(pair.user, {
        ...(signal ? { signal } : {}),
        ...(schema ? { responseConstraint: schema } : {}),
      } as { signal?: AbortSignal });
      return reply.trim() ? reply.trim() : null;
    } finally {
      session.destroy();
    }
  }, signal);
}

export const structuredPromptAdapter: BuiltInAdapter = {
  id: 'prompt',
  kinds: ['summarize', 'rewrite', 'write', 'proofread', 'json'],
  ready: async () => (await promptApiAvailability()) === 'available',
  budget: (signal): Promise<InputBudget | null> =>
    nullOnFailure(async () => {
      const session = await open('Summarize.', signal);
      const quota = session ? promptApiInputQuota(session) : undefined;
      const budget = session ? sessionBudget({
        ...(quota !== undefined ? { inputQuota: quota } : {}),
        measureInputUsage: (text, o) => promptApiMeasure(session, text, o?.signal).then((n) => n ?? Math.ceil(text.length / 4)),
        destroy: () => session.destroy(),
      }) : null;
      if (session && !budget) session.destroy();
      return budget;
    }, signal),
  summarize: (text, o) => ask(summarizePrompt(text, o), o.signal),
  rewrite: (text, o) => ask(rewritePrompt(text, o), o.signal),
  write: (task, o) => ask(writePrompt(task, o), o?.signal),
  proofread: (text, o) => ask(proofreadPrompt(text), o?.signal),
  json: async (o) => {
    const reply = await ask(jsonPrompt(o, false), o.signal, o.schema);
    return reply === null ? null : parseJsonReply(reply);
  },
};
