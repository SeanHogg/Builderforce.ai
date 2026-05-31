/**
 * FrameValidator — the VLM ("Frame Validator") layer.
 *
 * After a frame is generated, send it to a VISION-capable gateway model and ask
 * whether it matches the shot description + character bible. This is the
 * feedback's consistency/continuity check: catch character drift (wrong hair,
 * wardrobe), prompt mismatch, and obvious diffusion artifacts before they ship
 * in the final clip.
 *
 * No second runtime: the Builderforce gateway accepts OpenAI-style `image_url`
 * content blocks (data URIs), so we pass the decoded frame as a `data:image/...`
 * URL alongside the question — exactly like a multimodal chat turn. Same
 * gateway-failover + budget story as prompt expansion and scene planning.
 *
 * The model is asked for a structured verdict (json_schema) so we get a numeric
 * score + typed issues, not prose. `ok` is derived from the score vs a
 * threshold so the caller has one boolean to gate on.
 */

import { BuilderforceClient } from '@seanhogg/builderforce-sdk';
import type { FrameValidation, FrameIssueKind, ValidateFrameOptions } from '../types';

/** Default validator model — must be vision-capable. The gateway reorders to a
 *  multimodal model when content blocks are present, but we name one explicitly
 *  to avoid relying on undocumented behaviour. Override via `validatorModel`. */
const DEFAULT_VALIDATOR_MODEL = 'googleai/gemini-2.5-flash';
const DEFAULT_PASS_THRESHOLD = 0.6;

const ISSUE_KINDS: readonly FrameIssueKind[] = [
  'character-drift',
  'continuity',
  'prompt-mismatch',
  'artifact',
  'other',
];

const VALIDATOR_SYSTEM =
  'You are a strict continuity supervisor for AI-generated video frames. You are shown one ' +
  'frame plus the description of what it should depict and the locked appearance of any ' +
  'characters. Judge how well the frame matches. Report a score from 0 (wrong) to 1 (perfect) ' +
  'and list concrete issues: character-drift (a character looks different from their locked ' +
  'description), continuity, prompt-mismatch (frame ignores the described subject/action), ' +
  'artifact (melted faces, extra limbs, garbled text), or other. Output only JSON.';

const VALIDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'issues'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 1 },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'detail'],
        properties: {
          kind: { type: 'string', enum: [...ISSUE_KINDS] },
          detail: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * Validate one frame against its shot. Returns a verdict with `ok` derived from
 * `score >= passThreshold`. On any gateway/parse failure returns a permissive
 * `ok: true` verdict (score 1) — the validator is an ADVISORY quality gate, not
 * a hard dependency; a validator outage must not block video generation.
 * Inject `client` in tests; production constructs its own.
 */
export async function validateFrame(
  opts: ValidateFrameOptions,
  client?: BuilderforceClient,
): Promise<FrameValidation> {
  const threshold = opts.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const characterBlock =
    opts.characters && opts.characters.length > 0
      ? `Characters that must appear exactly as described:\n` +
        opts.characters.map((c) => `- ${c.name}: ${c.appearance}`).join('\n')
      : 'No specific characters to verify.';

  try {
    const c =
      client ?? new BuilderforceClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    const completion = await c.chat.completions.create({
      model: opts.validatorModel ?? DEFAULT_VALIDATOR_MODEL,
      messages: [
        { role: 'system', content: VALIDATOR_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Shot description: ${opts.shotDescription}\n\n${characterBlock}`,
            },
            { type: 'image_url', image_url: { url: opts.frameDataUrl, detail: 'low' } },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'frame_validation', schema: VALIDATION_SCHEMA, strict: true },
      },
      temperature: 0,
      max_tokens: 600,
      signal: opts.signal,
    });

    const text = completion.choices?.[0]?.message?.content;
    const verdict = parseVerdict(typeof text === 'string' ? text : null);
    if (!verdict) return permissive();
    return { ok: verdict.score >= threshold, score: verdict.score, issues: verdict.issues };
  } catch {
    // Advisory gate — never let a validator failure abort generation.
    return permissive();
  }
}

/** Permissive default — used when the validator can't produce a verdict. */
function permissive(): FrameValidation {
  return { ok: true, score: 1, issues: [] };
}

interface RawVerdict {
  score: number;
  issues: { kind: FrameIssueKind; detail: string }[];
}

function parseVerdict(text: string | null): RawVerdict | null {
  if (!text) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const score = typeof rec.score === 'number' ? clamp01(rec.score) : null;
  if (score === null) return null;
  const issues = Array.isArray(rec.issues)
    ? rec.issues
        .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object')
        .map((i) => ({
          kind: (ISSUE_KINDS as readonly string[]).includes(i.kind as string)
            ? (i.kind as FrameIssueKind)
            : 'other',
          detail: typeof i.detail === 'string' ? i.detail : '',
        }))
    : [];
  return { score, issues };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
