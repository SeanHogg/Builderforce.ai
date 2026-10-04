/**
 * Media billing products — the `llm_product` labels image and video generation
 * are logged under, and the unit each one is metered in.
 *
 * Media never consumes the TEXT token cap: each kind has its own daily credit
 * budget (images per day, video seconds per day). Both the chat cap's exclusion
 * (`tokenUsage.ts`) and each media gate's own sum read these lists, so a new
 * media kind added here is excluded from chat and metered on its own in one edit.
 *
 * Every media row carries `total_tokens = units × unitTokens`. That keeps media
 * rows in the cost rollups that already sum `total_tokens`, while each credit
 * gate divides by the SAME constant to recover units — charge and count agree.
 */

export const IMAGE_PRODUCT_NAMES = ['builderforceImage', 'builderforceImagePro'] as const;
export const VIDEO_PRODUCT_NAMES = ['builderforceVideo', 'builderforceVideoPro'] as const;

export type ImageProductName = (typeof IMAGE_PRODUCT_NAMES)[number];
export type VideoProductName = (typeof VIDEO_PRODUCT_NAMES)[number];

/** Every media product — what the text-token cap excludes. */
export const MEDIA_PRODUCT_NAMES: readonly string[] = [...IMAGE_PRODUCT_NAMES, ...VIDEO_PRODUCT_NAMES];

/** Tokens logged per returned image (one image = one image credit). */
export const IMAGE_TOKEN_COST = 1000;

/** Tokens logged per generated SECOND of video (one second = one video credit). */
export const VIDEO_SECOND_TOKEN_COST = 1000;

/** The free-plan product vs. the paid-plan one — same rule for every media kind. */
export function mediaProductForPlan<T extends readonly [string, string]>(names: T, paid: boolean): T[number] {
  return paid ? names[1] : names[0];
}
