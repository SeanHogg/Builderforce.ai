/**
 * Client-first résumé rewrite / merge (PRD 42 · Part D2).
 *
 * The device builds the SAME brief and prompt the server would (`@builderforce/resume-ai`,
 * the one shared source), asks its own model for the JSON reply, and sends that reply as
 * `clientResult.json`. The server takes it in place of its model call and runs the SAME
 * parse + invented-number verification on it, so a figure the résumé does not contain is
 * refused no matter who wrote it. Returns `null` (send as before) when the device cannot
 * run a JSON task or there is nothing for a model to do — the server answers that case
 * without a model anyway.
 */

import { capturingServed, jsonClientResult, type ClientResultPayload } from '@seanhogg/builderforce-brain-embedded';
import { buildBulletMergePrompt, buildXyzRewritePrompt, planBulletMerge, planXyzRewrite } from '@builderforce/resume-ai';
import { browserClientFirst } from './onDeviceTasks';

const XYZ_REPLY_SCHEMA = {
  type: 'object',
  required: ['rewrites'],
  properties: {
    rewrites: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'rewritten'],
        properties: {
          id: { type: 'number' },
          rewritten: { type: 'string' },
          missing: { type: 'array', items: { type: 'string', enum: ['X', 'Y', 'Z'] } },
          ask: { type: 'string' },
        },
      },
    },
  },
} as const;

const MERGE_REPLY_SCHEMA = {
  type: 'object',
  required: ['merged'],
  properties: {
    merged: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'merged'],
        properties: { id: { type: 'number' }, merged: { type: 'string' } },
      },
    },
  },
} as const;

/** Ask the device's JSON task for `prompt`'s reply, shaped by `schema`. */
async function deviceJson(
  prompt: { system: string; user: string },
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ClientResultPayload | null> {
  const host = browserClientFirst();
  const capture = capturingServed();
  const out = await host.tasks.json<Record<string, unknown>>({
    onServed: capture.onServed,
    system: prompt.system,
    user: prompt.user,
    schema,
    ...(signal ? { signal } : {}),
  });
  return jsonClientResult(out, host, capture.served());
}

const deviceCanRunJson = async (): Promise<boolean> => (await browserClientFirst().tasks.available()).has('json');

/** The XYZ rewrite reply, produced on the device for the bullets the brief flags. */
export async function resumeRewriteResult(resumeText: string, limit?: number, signal?: AbortSignal): Promise<ClientResultPayload | null> {
  if (!(await deviceCanRunJson())) return null;
  const brief = planXyzRewrite(resumeText, limit == null ? undefined : { limit });
  if (brief.candidates.length === 0) return null;
  return deviceJson(buildXyzRewritePrompt(brief), XYZ_REPLY_SCHEMA, signal);
}

/** The bullet-merge reply, produced on the device for the duplicate groups across the résumés. */
export async function resumeMergeResult(resumeTexts: readonly string[], signal?: AbortSignal): Promise<ClientResultPayload | null> {
  if (!(await deviceCanRunJson())) return null;
  const brief = planBulletMerge(resumeTexts);
  if (brief.groups.length === 0) return null;
  return deviceJson(buildBulletMergePrompt(brief), MERGE_REPLY_SCHEMA, signal);
}
