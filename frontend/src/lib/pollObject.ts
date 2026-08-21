/**
 * THE one mapping from a poll CARD to a published poll.
 *
 * Two surfaces publish the same card: the facilitation surface (a person pressing
 * Publish) and the canvas action dispatch (Brain calling `canvas_invoke_object_action`
 * with `publish`). Two readings of "what does this card's `options` field mean" is two
 * polls out of one card — and the one that drifts is the one nobody tested, because it
 * is reached through a model.
 *
 * So the reading lives here once, and it is DEFENSIVE for a reason this module cannot
 * avoid: these fields are authored by a person AND written by a model, so `options` can
 * be an array of the right rows, an array of strings, or something else entirely, and a
 * malformed row must not take a surface down in front of a room.
 */

import {
  POLL_SCALE_DEFAULT, POLL_SCALE_MAX, POLL_SCALE_MIN, isPollFormat,
  type PollFormat, type PollGridAxes, type PollOption,
} from '@builderforce/creation-canvas-contract';
import type { PublishPollBody } from './pollApi';

/** The fields a poll card carries. Structural rather than importing `CreationNodeData`,
 *  so the API client layer does not depend on the canvas component tree. */
export interface PollCardData {
  title?: unknown;
  prompt?: unknown;
  pollFormat?: unknown;
  options?: unknown;
  scaleMax?: unknown;
  gridXLabel?: unknown;
  gridYLabel?: unknown;
  anonymous?: unknown;
  showResultsLive?: unknown;
  closesAt?: unknown;
  questionSetId?: unknown;
  joinUrl?: unknown;
}

export function pollFormatOf(data: PollCardData): PollFormat {
  return isPollFormat(data.pollFormat) ? data.pollFormat : 'choice';
}

/**
 * The ballot, out of whatever the card holds.
 *
 * A bare string is accepted as an option and given a positional id, because that is what
 * a model writes when asked for "options: red, green, blue" and refusing it would make
 * the most common authoring path fail for a formatting reason. A row with no label is
 * dropped — an unlabelled option is one nobody can choose.
 */
export function readPollOptions(raw: unknown): PollOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index): PollOption[] => {
    if (typeof item === 'string') {
      const label = item.trim();
      return label ? [{ id: `o${index + 1}`, label }] : [];
    }
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) return [];
    return [{
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `o${index + 1}`,
      label,
      // `'true'` as well as `true`: the card's `rows` editor writes cell values as
      // strings, so a correct answer marked in the inspector arrives as text.
      ...(row.correct === true || row.correct === 'true' ? { correct: true } : {}),
    }];
  });
}

/** The 2x2's axes, or null when this poll has none. */
export function pollGridOf(data: PollCardData): PollGridAxes | null {
  const xLabel = typeof data.gridXLabel === 'string' ? data.gridXLabel.trim() : '';
  const yLabel = typeof data.gridYLabel === 'string' ? data.gridYLabel.trim() : '';
  return xLabel || yLabel ? { xLabel, yLabel } : null;
}

/** The top of a scale poll's range, clamped to what the contract allows. */
export function pollScaleMaxOf(data: PollCardData): number {
  const value = Number(data.scaleMax);
  return Number.isFinite(value)
    ? Math.min(POLL_SCALE_MAX, Math.max(POLL_SCALE_MIN, Math.round(value)))
    : POLL_SCALE_DEFAULT;
}

/**
 * The publish request this card describes.
 *
 * `anonymous` and `showResultsLive` default to TRUE on absence, matching the seed and
 * the server: a room asked to vote where each other can see votes differently, and a
 * poll whose result nobody sees is a survey.
 */
export function pollPublishBody(data: PollCardData, objectId: string): PublishPollBody {
  const grid = pollGridOf(data);
  return {
    ...(typeof data.questionSetId === 'string' && data.questionSetId ? { questionSetId: data.questionSetId } : {}),
    title: String(data.title ?? '').trim(),
    prompt: typeof data.prompt === 'string' ? data.prompt : null,
    format: pollFormatOf(data),
    options: readPollOptions(data.options),
    scaleMax: pollScaleMaxOf(data),
    gridXLabel: grid?.xLabel ?? null,
    gridYLabel: grid?.yLabel ?? null,
    anonymous: data.anonymous !== false,
    showResultsLive: data.showResultsLive !== false,
    closesAt: typeof data.closesAt === 'string' && data.closesAt ? data.closesAt : null,
    objectId,
  };
}

/**
 * The address a phone joins at.
 *
 * Built from the ORIGIN the facilitator is actually on rather than a configured base
 * URL: this is read aloud in the room the board is open in, and a canned production host
 * would be wrong on a preview deploy and on localhost — which is where it gets
 * demonstrated.
 */
export function pollJoinUrl(slug: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/p/${slug}`;
}
