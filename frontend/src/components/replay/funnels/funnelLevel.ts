/**
 * The `funnel` panel kind's level id (PRD 33 §4.1): a small query string, so a
 * funnel — or a smart-event rule being defined — is a shareable address like
 * every other level (`?panel=funnel:<id>:<tab>`), the same convention the
 * `issues` kind uses for its narrowing filter.
 *
 *   funnel=<funnelId>                   the Steps tab opens on that funnel
 *   rule=click&match=<sel>&mode=equals  the Events tab opens its editor prefilled
 */

import type {
  ReplayFunnelStepKind,
  ReplayMatchMode,
  ReplaySmartEventRuleKind,
} from '@builderforce/interaction-contract';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';

export interface SmartEventDraft {
  ruleKind: ReplaySmartEventRuleKind;
  match: string;
  matchMode: ReplayMatchMode;
}

export interface FunnelLevelAddress {
  funnelId?: string;
  draft?: SmartEventDraft;
}

export const RULE_KINDS: readonly ReplaySmartEventRuleKind[] = ['page', 'click', 'custom'];
export const MATCH_MODES: readonly ReplayMatchMode[] = ['equals', 'prefix', 'contains'];
export const FUNNEL_STEP_KINDS: readonly ReplayFunnelStepKind[] = ['page', 'click', 'event'];

/** The smart-event rule kind a funnel step of each kind is previewed as. */
export const STEP_RULE_KIND: Readonly<Record<ReplayFunnelStepKind, ReplaySmartEventRuleKind>> = {
  page: 'page',
  click: 'click',
  event: 'custom',
};

export function funnelLevelId(address: FunnelLevelAddress): string {
  const params = new URLSearchParams();
  if (address.funnelId) params.set('funnel', address.funnelId);
  if (address.draft) {
    params.set('rule', address.draft.ruleKind);
    params.set('match', address.draft.match);
    params.set('mode', address.draft.matchMode);
  }
  return params.toString();
}

export function parseFunnelLevelId(id: string): FunnelLevelAddress {
  const params = new URLSearchParams(id);
  const address: FunnelLevelAddress = {};
  const funnelId = params.get('funnel');
  if (funnelId) address.funnelId = funnelId;
  const rule = params.get('rule');
  const match = params.get('match');
  const mode = params.get('mode');
  const ruleKind = RULE_KINDS.find((kind) => kind === rule);
  const matchMode = MATCH_MODES.find((m) => m === mode) ?? 'equals';
  if (ruleKind && match) address.draft = { ruleKind, match, matchMode };
  return address;
}

/** The panel level that creates (no `funnelId`) or edits a funnel — the `funnel_edit` kind (D16: a level, not an overlay). */
export function funnelEditLevel(funnelId?: string): InsightPanelLevel {
  return { kind: 'funnel_edit', id: funnelLevelId(funnelId ? { funnelId } : {}) };
}
