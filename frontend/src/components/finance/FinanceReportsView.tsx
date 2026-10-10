/**
 * /finance?tab=reports — what the finance destination SENDS, and the evidence
 * it reads from.
 *
 * Two self-loading pieces side by side: the report schedules (board packs and
 * the computed reports, delivered on a cadence) and the validation engagements
 * card. Neither waits on the runway report the Runway and Cashflow tabs share.
 */

import { ReportSchedulesPanel } from '@/components/reports/ReportSchedulesPanel';
import { ValidationEngagementsCard } from './ValidationEngagementsCard';

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  gap: 24,
  alignItems: 'start',
};

export function FinanceReportsView() {
  return (
    <div style={layoutStyle}>
      <ReportSchedulesPanel />
      <ValidationEngagementsCard />
    </div>
  );
}
