import { Suspense } from 'react';
import { LensPage } from '@/components/insights/LensShell';
import { AiInsightsDashboard } from '@/components/insights/AiInsightsDashboard';

/**
 * `/insights/ai` — the combined AI Insights hub. Replaces the three separate
 * report pages (AI Impact, AI Effectiveness, Recommendations) with one dashboard
 * whose sections drill into each lens via a slide-out. The open panel mirrors to
 * `?panel=<id>` so drawers are deep-linkable (the retired sub-routes redirect
 * here with the matching panel). Each panel gates itself, so the hub is gate=false.
 */
/**
 * A SERVER component: nothing on this page is interactive — the hub shell and the
 * dashboard below it are the client leaves, and this file only names which ones.
 */
export default function AiInsightsPage() {
  return (
    <LensPage capability="insights.aiImpact" titleKey="aihub.title" subtitleKey="aihub.subtitle" gate={false}>
      {/* useSearchParams (the ?panel= deep-link) requires a Suspense boundary. */}
      <Suspense fallback={null}>
        <AiInsightsDashboard />
      </Suspense>
    </LensPage>
  );
}
