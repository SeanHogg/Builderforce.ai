/** The Reviews panel's tab strip: `role=tablist`, arrow keys (and Home / End) move between tabs, a badge counts what is behind a tab. Tokens only; scrolls sideways rather than wrapping at 360px. */

import { useRef, type KeyboardEvent } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { TYPE } from '../ui/type';
import { REVIEWS_TABS, type ReviewsTab } from './useReviewsTab';

export interface TabBadge { count: number; tone?: ThemeTone }

export interface ReviewsTabsProps {
    labels: KnowledgeGraphLabels;
    tab: ReviewsTab;
    onTab(tab: ReviewsTab): void;
    /** A count beside a tab's name (Runs: how many; Server: how many files are not stored, amber). Absent or 0 ⇒ none. */
    badges?: Partial<Record<ReviewsTab, TabBadge>>;
    /** The id of the panel the open tab controls. */
    panelId: string;
}

export const tabId = (panelId: string, tab: ReviewsTab): string => `${panelId}-tab-${tab}`;

export function ReviewsTabs({ labels, tab, onTab, badges = {}, panelId }: ReviewsTabsProps) {
    const r = labels.surface.run.review;
    const names: Record<ReviewsTab, string> = { review: r.tabReview, runs: r.tabRuns, server: r.tabServer, diagnostics: r.tabDiagnostics };
    const refs = useRef<Partial<Record<ReviewsTab, HTMLButtonElement | null>>>({});
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const at = REVIEWS_TABS.indexOf(tab);
        const next = e.key === 'ArrowRight' ? REVIEWS_TABS[(at + 1) % REVIEWS_TABS.length]
            : e.key === 'ArrowLeft' ? REVIEWS_TABS[(at - 1 + REVIEWS_TABS.length) % REVIEWS_TABS.length]
                : e.key === 'Home' ? REVIEWS_TABS[0] : e.key === 'End' ? REVIEWS_TABS[REVIEWS_TABS.length - 1] : undefined;
        if (!next) return;
        e.preventDefault();
        onTab(next);
        refs.current[next]?.focus();
    };
    return (
        <div role="tablist" aria-label={r.tabsLabel} onKeyDown={onKeyDown} style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: `1px solid ${cssVar('border')}` }}>
            {REVIEWS_TABS.map((id) => {
                const on = id === tab;
                const badge = badges[id];
                return (
                    <button
                        key={id} ref={(el) => { refs.current[id] = el; }} type="button" role="tab" id={tabId(panelId, id)} aria-selected={on} aria-controls={panelId}
                        tabIndex={on ? 0 : -1} onClick={() => onTab(id)}
                        style={{
                            ...(on ? TYPE.pillOn : TYPE.pill), flex: 'none', minHeight: 40, padding: '0 12px', cursor: 'pointer', background: 'transparent', color: cssVar('text'),
                            border: 'none', borderBottom: `2px solid ${on ? cssVar('accent') : 'transparent'}`, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                        }}
                    >
                        {names[id]}
                        {badge && badge.count > 0 && (
                            <span data-testid={`kg-tab-badge-${id}`} style={{ ...TYPE.tag, padding: '1px 6px', borderRadius: 999, color: cssVar('text'), background: cssVar(badge.tone === 'cycle' ? 'warnBg' : 'plane') }}>{badge.count.toLocaleString()}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
