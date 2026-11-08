/** The Reviews panel's open tab, remembered per root for as long as the view lives (local state: the panel unmounts when it closes, the tab must not). */

import { useCallback, useState } from 'react';

export type ReviewsTab = 'review' | 'runs' | 'server' | 'diagnostics';

export const REVIEWS_TABS: readonly ReviewsTab[] = ['review', 'runs', 'server', 'diagnostics'];

/** What the panel is handed: the tab in effect and how to change it. */
export interface ReviewsTabState {
    tab: ReviewsTab;
    setTab(tab: ReviewsTab): void;
}

export function useReviewsTab(rootId: string | null): ReviewsTabState {
    const [byRoot, setByRoot] = useState<Record<string, ReviewsTab>>({});
    const key = rootId ?? '';
    const setTab = useCallback((tab: ReviewsTab) => setByRoot((cur) => (cur[key] === tab ? cur : { ...cur, [key]: tab })), [key]);
    return { tab: byRoot[key] ?? 'review', setTab };
}
