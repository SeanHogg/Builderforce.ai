/**
 * `?panel=<kind>:<id>[:<tab>]` (+ `&t=<seconds>`, `&follow=1`) — the shareable
 * address of the Insights panel's top level (PRD 33 §4.1).
 *
 * Pure string work, no registry import, so the player can build a link without
 * pulling the panel kinds (and itself) into a cycle. The id is URI-encoded
 * inside the value because route templates carry colons (`/p/:id`).
 * Validation against `INSIGHT_PANEL_KINDS` is the panel's job.
 */

import type { InsightPanelLevel } from './panelKinds';

export const PANEL_PARAM = 'panel';
export const TIME_PARAM = 't';
export const FOLLOW_PARAM = 'follow';

export interface ParsedPanelParam {
  kind: string;
  id: string;
  tab?: string;
  t?: number;
  follow?: boolean;
}

export function formatPanelValue(level: Pick<InsightPanelLevel, 'kind' | 'id' | 'tab'>): string {
  const base = `${level.kind}:${encodeURIComponent(level.id)}`;
  return level.tab ? `${base}:${level.tab}` : base;
}

export function parsePanelParams(search: string | URLSearchParams): ParsedPanelParam | null {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  const raw = params.get(PANEL_PARAM);
  if (!raw) return null;
  const [kind = '', encodedId = '', tab] = raw.split(':');
  if (!/^[a-z_]+$/.test(kind)) return null;
  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch (error) {
    void error;
    return null;
  }
  const parsed: ParsedPanelParam = { kind, id };
  if (tab) parsed.tab = tab;
  const seconds = Number(params.get(TIME_PARAM));
  if (params.has(TIME_PARAM) && Number.isFinite(seconds) && seconds >= 0) parsed.t = seconds;
  if (params.get(FOLLOW_PARAM) === '1') parsed.follow = true;
  return parsed;
}

/** A copy of `params` addressing `level` (or no panel at all). Other params — the filter, the site — are kept. */
export function withPanelParams(params: URLSearchParams, level: InsightPanelLevel | null): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(PANEL_PARAM);
  next.delete(TIME_PARAM);
  next.delete(FOLLOW_PARAM);
  if (!level) return next;
  next.set(PANEL_PARAM, formatPanelValue(level));
  if (level.t != null) next.set(TIME_PARAM, String(Math.floor(level.t)));
  if (level.follow) next.set(FOLLOW_PARAM, '1');
  return next;
}

/** Absolute, shareable URL of the current page addressing `level`. */
export function panelHref(level: InsightPanelLevel, at: Pick<Location, 'origin' | 'pathname' | 'search'> = window.location): string {
  const query = withPanelParams(new URLSearchParams(at.search), level).toString();
  return `${at.origin}${at.pathname}${query ? `?${query}` : ''}`;
}
