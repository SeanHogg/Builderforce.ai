/**
 * The `/` menu's Status tab — ONE component, identical on every surface: the plan and
 * meters, what AI cost the workspace over the last 30 days and what memory saved it,
 * and the project's Evermind. Self-contained: it reads the shared consumption snapshot
 * and the Evermind head through the host's request port; the host supplies only its
 * navigation (`onUpgrade`) and copy.
 */
import type { JsonRequest } from './consumptionSnapshot';
import { invalidateConsumptionSnapshot } from './consumptionSnapshot';
import { useConsumptionSnapshot } from './useConsumptionSnapshot';
import { AccountStatus, type UpgradeTarget } from './AccountStatus';
import { EvermindStatus } from './EvermindStatus';
import { workStatusLabels, type WorkStatusLabels } from './labels';
import { SpendBreakdown } from '../spend/SpendBreakdown';
import { fill } from '../spend/format';
import { spendLabels, type SpendLabels } from '../spend/labels';

/** The window the consumption snapshot's spend figure covers (server: `SPEND_PERIOD_DAYS`). */
const SPEND_PERIOD_DAYS = 30;

export interface WorkStatusPanelProps {
  request: JsonRequest;
  projectId: number | null;
  labels?: Partial<WorkStatusLabels>;
  spendLabels?: Partial<SpendLabels>;
  locale?: string;
  onUpgrade?: (target: UpgradeTarget) => void;
}

export function WorkStatusPanel({ request, projectId, labels: overrides, spendLabels: spendOverrides, locale, onUpgrade }: WorkStatusPanelProps) {
  const labels = workStatusLabels(overrides);
  const sLabels = spendLabels(spendOverrides);
  const snapshot = useConsumptionSnapshot(request);
  if (!snapshot) return <div className="bf-pmenu__desc">{labels.loading}</div>;
  const upgrade = onUpgrade
    ? (target: UpgradeTarget) => { invalidateConsumptionSnapshot(); onUpgrade(target); }
    : undefined;
  return (
    <>
      <AccountStatus snapshot={snapshot} labels={labels} locale={locale} onUpgrade={upgrade} />
      {snapshot.spendSavings && (
        <>
          <div className="bf-pmenu__group">{fill(sLabels.periodHeading, { days: String(SPEND_PERIOD_DAYS) })}</div>
          <SpendBreakdown summary={snapshot.spendSavings} labels={sLabels} locale={locale} />
        </>
      )}
      <EvermindStatus request={request} projectId={projectId} labels={labels} />
    </>
  );
}
