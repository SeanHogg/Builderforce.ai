/**
 * Sensitive regions for session replay (PRD 33 D9, S3). The recorder never
 * captures inside `[data-bf-block]` (a placeholder box is recorded instead) and
 * masks every text node inside `[data-bf-mask]`. Spread one onto the ROOT
 * element of a component that shows secrets, keys, payment or what a person is
 * typing to the Brain — one spelling, so a grep finds every protected region.
 */
export const REPLAY_BLOCK = { 'data-bf-block': '' } as const;
export const REPLAY_MASK = { 'data-bf-mask': '' } as const;

export type ReplayPrivacy = 'block' | 'mask';

export const REPLAY_PRIVACY_ATTRS: Readonly<Record<ReplayPrivacy, Readonly<Record<string, string>>>> = {
  block: REPLAY_BLOCK,
  mask: REPLAY_MASK,
};
