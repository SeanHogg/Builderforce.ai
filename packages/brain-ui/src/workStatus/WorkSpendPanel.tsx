/**
 * The `/` menu's Spend tab — ONE component, identical on every surface: what AI cost the
 * workspace over the last 30 days and what memory saved it. Reads the same shared
 * consumption snapshot as the Status tab (one cached request feeds both); the host
 * supplies only its copy.
 */
import type { JsonRequest } from './consumptionSnapshot';
import { useConsumptionSnapshot } from './useConsumptionSnapshot';
import { SpendBreakdown } from '../spend/SpendBreakdown';
import { fill, formatUsd } from '../spend/format';
import { spendLabels, type SpendLabels } from '../spend/labels';

/** The window the consumption snapshot's spend figure covers (server: `SPEND_PERIOD_DAYS`). */
const SPEND_PERIOD_DAYS = 30;

export interface WorkSpendPanelProps {
  request: JsonRequest;
  labels?: Partial<SpendLabels>;
  /** Shown while the snapshot loads. */
  loadingLabel: string;
  locale?: string;
}

export function WorkSpendPanel({ request, labels: overrides, loadingLabel, locale }: WorkSpendPanelProps) {
  const labels = spendLabels(overrides);
  const snapshot = useConsumptionSnapshot(request);
  if (!snapshot) return <div className="bf-pmenu__desc">{loadingLabel}</div>;
  return (
    <>
      <div className="bf-pmenu__group">{fill(labels.periodHeading, { days: String(SPEND_PERIOD_DAYS) })}</div>
      {snapshot.spendSavings
        ? <SpendBreakdown summary={snapshot.spendSavings} labels={labels} locale={locale} />
        : <div className="bf-pmenu__desc">{fill(labels.spent, { amount: formatUsd(0, locale) })}</div>}
    </>
  );
}
