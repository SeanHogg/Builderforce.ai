/**
 * Client-first producers for the web's typed API methods (PRD 42 · Part D2): each asks the
 * device (`browserClientFirst()`) for what the route would otherwise spend a server model call
 * on, and returns a `clientResult` payload — or `null`, meaning "send the request as before".
 * The try / attach / retry-once rule is the ONE `withClientResult`; nothing here retries.
 * Inputs are loaded lazily and only after the device reports it can run the task, so a browser
 * with no on-device model costs no extra request.
 *
 * Résumé rewrite / merge are in `resumeClientFirst.ts` (their brief and prompt builders are the
 * shared `@builderforce/resume-ai`). Replay summaries stay on the server: the server builds them
 * from events it holds and the client has no source text (out of PRD 42 scope).
 */

import { capturingServed, jsonClientResult, textClientResult, type ClientResultPayload } from '@seanhogg/builderforce-brain-embedded';
import { browserClientFirst } from './onDeviceTasks';

/** What the minutes must contain — the server's own shape, handed to the device as context. */
const MINUTES_CONTEXT =
  'Meeting minutes in Markdown: a one-paragraph **Summary**; a **Decisions** bullet list (omit if none); '
  + 'an **Action items** checklist as "- [ ] Owner — task" (omit if none).';

const DOCUMENT_CONTEXT =
  'GitHub-flavored Markdown for a company knowledge base: a top-level "# Title", a one-line purpose, then '
  + 'numbered steps or clear sections. Output only the document.';

export interface TranscriptLine { speakerName: string; text: string }

/** Meeting minutes written on the device from the transcript lines. */
export async function meetingMinutesResult(loadLines: () => Promise<readonly TranscriptLine[]>): Promise<ClientResultPayload | null> {
  const host = browserClientFirst();
  if (!(await host.tasks.available()).has('summarize')) return null;
  const lines = await loadLines();
  if (lines.length === 0) return null;
  const convo = lines.map((s) => `${s.speakerName}: ${s.text}`).join('\n');
  const capture = capturingServed();
  return textClientResult(await host.tasks.summarize(convo, { kind: 'transcript', context: MINUTES_CONTEXT, onServed: capture.onServed }), host, capture.served());
}

/** The metric key the device picks for a question, from the tenant's whitelisted keys. */
export async function dashboardIntentResult(question: string, loadKeys: () => Promise<readonly string[]>): Promise<ClientResultPayload | null> {
  const host = browserClientFirst();
  if (!(await host.tasks.available()).has('json')) return null;
  const keys = await loadKeys();
  if (keys.length === 0) return null;
  const capture = capturingServed();
  const out = await host.tasks.json<{ key: string }>({
    onServed: capture.onServed,
    system: 'Pick the ONE metric key that best answers the question. Reply with JSON only: {"key": <one of the allowed keys>}.',
    user: JSON.stringify({ question, allowedKeys: keys }),
    schema: { type: 'object', required: ['key'], properties: { key: { type: 'string', enum: [...keys] } } },
  });
  return jsonClientResult(out, host, capture.served());
}

/** An SOP / document drafted (or, with `existingContent`, rewritten) on the device. */
export async function documentDraftResult(
  input: { prompt: string; title?: string; existingContent?: string },
  signal?: AbortSignal,
): Promise<ClientResultPayload | null> {
  const host = browserClientFirst();
  const existing = input.existingContent?.trim();
  const kinds = await host.tasks.available();
  if (!kinds.has(existing ? 'rewrite' : 'write')) return null;
  const capture = capturingServed();
  const opts = { onServed: capture.onServed, ...(signal ? { signal } : {}) };
  const text = existing
    ? await host.tasks.rewrite(existing, { instruction: input.prompt, length: 'longer', ...opts })
    : await host.tasks.write(input.title ? `${input.title}\n${input.prompt}` : input.prompt, { context: DOCUMENT_CONTEXT, length: 'long', ...opts });
  return textClientResult(text, host, capture.served());
}
