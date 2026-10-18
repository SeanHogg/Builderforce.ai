/**
 * The `/` menu's Status tab — ONE component, identical on every surface: the plan and
 * meters, and the project's Evermind. What AI cost and what memory saved is the Spend
 * tab (`WorkSpendPanel`). Self-contained: it reads the shared consumption snapshot
 * and the Evermind head through the host's request port; the host supplies only its
 * navigation (`onUpgrade`) and copy.
 */
import type { JsonRequest } from './consumptionSnapshot';
import { invalidateConsumptionSnapshot } from './consumptionSnapshot';
import { useConsumptionSnapshot } from './useConsumptionSnapshot';
import { AccountStatus, type UpgradeTarget } from './AccountStatus';
import { EvermindStatus } from './EvermindStatus';
import { workStatusLabels, type WorkStatusLabels } from './labels';

export interface WorkStatusPanelProps {
  request: JsonRequest;
  projectId: number | null;
  labels?: Partial<WorkStatusLabels>;
  locale?: string;
  onUpgrade?: (target: UpgradeTarget) => void;
}

export function WorkStatusPanel({ request, projectId, labels: overrides, locale, onUpgrade }: WorkStatusPanelProps) {
  const labels = workStatusLabels(overrides);
  const snapshot = useConsumptionSnapshot(request);
  if (!snapshot) return <div className="bf-pmenu__desc">{labels.loading}</div>;
  const upgrade = onUpgrade
    ? (target: UpgradeTarget) => { invalidateConsumptionSnapshot(); onUpgrade(target); }
    : undefined;
  return (
    <>
      <AccountStatus snapshot={snapshot} labels={labels} locale={locale} onUpgrade={upgrade} />
      <EvermindStatus request={request} projectId={projectId} labels={labels} />
    </>
  );
}
