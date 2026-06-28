'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — survey management is now the "Surveys" panel of the combined
 *  /insights/devex hub. The old URL stays alive (bookmarks, deep links) by
 *  redirecting straight into the matching drill-down. */
export default function SurveysPage() {
  return <InsightsRedirect to="/insights/devex?panel=surveys" />;
}
