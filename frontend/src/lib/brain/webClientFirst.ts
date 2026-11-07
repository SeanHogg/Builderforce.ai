/**
 * The web host's client-first wiring for the typed API client (PRD 42 · Part D), kept out of
 * `builderforceApi.ts` and out of the root bundle: the on-device port (`./onDeviceTasks`) and
 * the producers (`./clientFirstTasks`) load on the FIRST call that reaches the device, never
 * with the shell's first paint.
 */

import { pageClientFirst, withClientResult, type ClientFirstHost, type ClientResultPayload, type OnDeviceTasks } from '@seanhogg/builderforce-brain-embedded';

import type { RequestOptions } from '../apiClient';

const port = async (): Promise<OnDeviceTasks> => (await import('./onDeviceTasks')).browserOnDeviceTasks();

/** An `OnDeviceTasks` whose every method resolves the real port on first use. */
const lazyTasks: OnDeviceTasks = {
  available: async () => (await port()).available(),
  summarize: async (text, o) => (await port()).summarize(text, o),
  rewrite: async (text, o) => (await port()).rewrite(text, o),
  write: async (task, o) => (await port()).write(task, o),
  proofread: async (text, o) => (await port()).proofread(text, o),
  detectLanguage: async (text, o) => (await port()).detectLanguage(text, o),
  translate: async (text, o) => (await port()).translate(text, o),
  json: async (o) => (await port()).json(o),
};

/** Consolidate / Fork summarize on the device first (PRD 42 · D2); a decline ⇒ the server path. */
export function lazyBrowserClientFirst(): ClientFirstHost {
  return pageClientFirst(lazyTasks);
}

/** Meeting minutes: the device writes them first, the server writes them when it declines. */
export function summarizeMeetingClientFirst<T>(
  meetingPath: string,
  request: <R>(path: string, init?: RequestOptions) => Promise<R>,
): Promise<T> {
  const loadLines = async () => (await request<{ segments: readonly { speakerName: string; text: string }[] }>(`${meetingPath}/transcript`)).segments;
  return withClientResult<T>(
    async () => (await import('./clientFirstTasks')).meetingMinutesResult(loadLines),
    (clientResult?: ClientResultPayload) => request<T>(`${meetingPath}/summarize`, {
      method: 'POST',
      ...(clientResult ? { body: JSON.stringify({ clientResult }), expectedErrors: [400] } : {}),
    }),
  );
}
