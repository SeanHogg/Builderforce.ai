/**
 * Input-capability gate — keeps a request off a model that cannot read what it carries.
 *
 * `direct/minimax/MiniMax-M1` served 61 calls and refused 31 with `invalid params,
 * MiniMax-M1 not support img (2013)` (2026-10-03..10): image parts were dispatched to a
 * text-only model. `reorderPoolByShape` already floats vision models to the front, but
 * that is a SOFT preference — a strict pin, or a chain whose vision models had cooled,
 * still walked onto a text-only model and spent an attempt learning the answer.
 *
 * The rule is catalog DATA, read per candidate inside the cascade walk, and honours
 * the `VendorModelEntry.capabilities` contract ("absent = unknown"):
 *   - a candidate whose catalog entry DECLARES `capabilities` without `vision` is
 *     text-only, and is skipped for an image-bearing request;
 *   - an entry with no `capabilities` declared, or a model the catalog does not know at
 *     all (an OpenRouter long-tail id, a BYO model a tenant selected that we do not
 *     list), is unknown — not text-only — and is still tried.
 *
 * When every candidate is skipped for this reason the request is refused with a typed
 * {@link ModelInputUnsupportedError} (a 400 request error) instead of a misleading
 * "cascade exhausted" — a strict pin then fails with a message that names the model and
 * the missing capability.
 */

import { VendorFatalError, type VendorModelEntry } from './types';

/** Content-part types that carry an image, across the wire shapes the gateway accepts
 *  (chat-completions `image_url`, Responses `input_image`, Anthropic-native `image`). */
const IMAGE_PART_TYPES: ReadonlySet<string> = new Set(['image_url', 'input_image', 'image']);

/** Does any message carry an image content part? */
export function requestCarriesImages(messages: ReadonlyArray<unknown> | undefined): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    const content = (m as { content?: unknown } | null)?.content;
    return Array.isArray(content) && content.some(
      (part) => IMAGE_PART_TYPES.has(String((part as { type?: unknown } | null)?.type ?? '')),
    );
  });
}

/**
 * True when the catalog DECLARES this model's capabilities and `vision` is not among
 * them. An uncatalogued model, or an entry that declares nothing, is unknown and is
 * never refused on this ground.
 */
export function entryRefusesImages(entry: Pick<VendorModelEntry, 'capabilities'> | undefined): boolean {
  if (!entry?.capabilities) return false;
  return !entry.capabilities.includes('vision');
}

/**
 * The request carries an input the candidate models cannot accept. A request error
 * (400): no amount of failover onto the same models fixes it, and nothing is cooled.
 */
export class ModelInputUnsupportedError extends VendorFatalError {
  public readonly capability: 'vision';
  public readonly models: ReadonlyArray<string>;
  constructor(vendorId: string, models: ReadonlyArray<string>, capability: 'vision' = 'vision') {
    super(
      vendorId,
      400,
      `model_input_unsupported: the request contains image input but ${models.join(', ')} `
      + `${models.length === 1 ? 'does' : 'do'} not accept images (no '${capability}' capability). `
      + 'Pin a vision-capable model or remove the image parts.',
    );
    this.name = 'ModelInputUnsupportedError';
    this.capability = capability;
    this.models = models;
  }
}
