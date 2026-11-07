/**
 * A chat transcript summarized on the device, as a `clientResult` (PRD 42 · D2:
 * `POST /api/brain/chats/:id/summarize`, Consolidate and Fork).
 *
 * It is the ONE transcript summarizer (`summarizeTranscript`: the prompt, the rendering and
 * the budget are the memory package's — the same call a fold and a local Consolidate make)
 * over the host's `OnDeviceTasks.summarize`, chunked by the port. A decline is `null`, and
 * the caller sends the request without a result, exactly as before.
 */

import { summarizeTranscript, type SummaryCompletion } from '@seanhogg/builderforce-memory/working';
import { capturingServed, textClientResult, type ClientFirstHost, type ClientResultPayload } from './clientFirst';
import { transcriptSummaryOptions } from './utilitySummary';
import type { ChatCompletionMessage } from '../streamChatCompletion';

export async function onDeviceTranscriptSummary(
  host: ClientFirstHost,
  seed: ChatCompletionMessage[],
  signal?: AbortSignal,
): Promise<ClientResultPayload | null> {
  // Under two turns there is nothing to consolidate: leave the verdict to the server.
  if (seed.length < 2 || !(await host.tasks.available()).has('summarize')) return null;
  // Who served THIS request's calls (a long transcript is several; the last one wrote the result).
  const capture = capturingServed();
  const completion: SummaryCompletion = async (req) =>
    (await host.tasks.summarize(req.user, transcriptSummaryOptions(
      req.signal || !signal ? req : { ...req, signal },
      { onServed: capture.onServed },
    ))) ?? '';
  return textClientResult(await summarizeTranscript(completion, seed, signal), host, capture.served());
}
