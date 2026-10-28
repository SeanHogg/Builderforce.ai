/**
 * The confirm CHIP's wire shape (docs/design/deterministic-prefetch.md: "write actions
 * never auto-run"). A write action is confirmed through the run's ONE human-in-the-loop
 * channel — the run cell's `pendingConfirm`, answered by `resolveRunConfirm` and declined
 * by Stop — not a second channel of its own. This is the request it raises there, and
 * the reading every surface uses to render it as the PreFetch confirm chip (brain-ui's
 * `PrefetchConfirmChip`) instead of the generic tool bar.
 *
 * The request names the action (`name` = its id) so a surface that predates the chip still
 * shows a readable "Run lint.fix?" rather than nothing. Pure.
 */

import type { PrefetchAction } from './types.js';

/** What `pendingConfirm.args` carries for a PreFetch write action. */
export interface PrefetchConfirmArgs {
  prefetch: true;
  /** The action's i18n key (`prefetch.action.<id>`). */
  labelKey: string;
  /** The person's request the action would answer. */
  request: string;
  /** What running it would touch (the executor's `preview`), when it said. */
  detail?: string;
}

/** A pending PreFetch confirmation, as a surface renders it. */
export interface PrefetchConfirm {
  actionId: string;
  labelKey: string;
  request: string;
  detail?: string;
}

/** The longest request echoed on the chip. */
const REQUEST_ECHO_MAX = 240;

/** The confirmation a write action raises on the run's confirm channel. */
export function prefetchConfirmRequest(action: Pick<PrefetchAction, 'id' | 'labelKey'>, request: string, detail?: string): { name: string; args: PrefetchConfirmArgs } {
  const echo = request.trim();
  const said = detail?.trim();
  return {
    name: action.id,
    args: {
      prefetch: true,
      labelKey: action.labelKey,
      request: echo.length > REQUEST_ECHO_MAX ? `${echo.slice(0, REQUEST_ECHO_MAX)}…` : echo,
      ...(said ? { detail: said.length > REQUEST_ECHO_MAX ? `${said.slice(0, REQUEST_ECHO_MAX)}…` : said } : {}),
    },
  };
}

/** The PreFetch confirmation a pending confirm is, or null for any other (a tool call). */
export function prefetchConfirmOf(pending: { name: string; args: unknown } | null | undefined): PrefetchConfirm | null {
  if (!pending) return null;
  const args = pending.args as Partial<PrefetchConfirmArgs> | null | undefined;
  if (!args || args.prefetch !== true || typeof args.labelKey !== 'string') return null;
  return {
    actionId: pending.name,
    labelKey: args.labelKey,
    request: typeof args.request === 'string' ? args.request : '',
    ...(typeof args.detail === 'string' && args.detail ? { detail: args.detail } : {}),
  };
}
