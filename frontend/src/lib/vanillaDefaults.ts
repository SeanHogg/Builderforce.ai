/**
 * Run-only fallback files for a missing/empty scaffold — used by Run and by the
 * publish build.
 *
 * The scaffolds themselves now live in `@builderforce/ide-templates`, shared with the
 * API that seeds them into R2, so "matched to the server-side templates" is a fact of
 * the build rather than something a parity test has to keep checking. This module is
 * the frontend's naming of that contract and nothing else.
 *
 * The `*_DEFAULTS` aliases are kept because the Run and publish call sites read in
 * terms of "defaults", not "templates" — the seeding side is the API's concern.
 */
export {
  VANILLA_TEMPLATE as VANILLA_DEFAULTS,
  MOBILE_TEMPLATE as MOBILE_DEFAULTS,
} from '@builderforce/ide-templates';

import { templateForModality, VANILLA_TEMPLATE } from '@builderforce/ide-templates';

/**
 * The fallback files for a modality.
 *
 * Delegates to the shared `templateForModality`, so the modality→scaffold decision is
 * made in ONE place. It used to be made twice — here and in the API's
 * `TEMPLATE_BY_MODALITY` — and a modality added to one and not the other is exactly how
 * `webmobile` (Web + Mobile) came to be created with no files at all.
 *
 * Falls back to the vanilla scaffold rather than null: this is the RUN path, and a
 * modality with no scaffold still has to boot something rather than mount an empty
 * WebContainer.
 */
export function defaultsForModality(modality: string): Record<string, string> {
  return templateForModality(modality) ?? VANILLA_TEMPLATE;
}
