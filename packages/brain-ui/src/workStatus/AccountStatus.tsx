/**
 * Account + usage, as the `/` menu's Status tab shows it on every surface: the plan
 * (and, for a superadmin operator, that every limit is lifted for THEM rather than by
 * the plan), when the period resets, one bar per metered resource, and the action that
 * changes the tier. Presentational over the shared consumption snapshot.
 */
import type { ConsumptionSnapshot } from './consumptionSnapshot';
import { fill } from '../spend/format';
import { planIsPaid } from '../evermind/restAdapter';
import { labelForKey, type WorkStatusLabels } from './labels';
import { relativeFuture } from './relativeTime';

export type UpgradeTarget = 'pricing' | 'billing';

export interface AccountStatusProps {
  snapshot: ConsumptionSnapshot;
  labels: WorkStatusLabels;
  locale?: string;
  /** Open the page that changes the tier — each host owns its own navigation. */
  onUpgrade?: (target: UpgradeTarget) => void;
}

export function AccountStatus({ snapshot, labels, locale, onUpgrade }: AccountStatusProps) {
  // The shared paid-plan rule (the Evermind teacher picker reads it too).
  const free = !planIsPaid(snapshot);
  const billing = snapshot.plan.billingStatus;
  const reset = relativeFuture(snapshot.period?.resetsAt, locale);
  const num = (n: number) => n.toLocaleString(locale);
  return (
    <div className="bf-acct">
      <div className="bf-pmenu__group">{labels.account}</div>
      <div className="bf-acct__row">
        <span className="bf-acct__k">{labels.plan}</span>
        <span className="bf-acct__v">
          {labelForKey(labels.plans, snapshot.plan.effective)}
          {billing && billing !== 'active' && billing !== 'none' ? ` · ${labelForKey(labels.billing, billing)}` : ''}
          {snapshot.limitsLiftedBySuperadmin && (
            <span className="bf-acct__note" title={labels.limitsLiftedHint}> · {labels.limitsLifted}</span>
          )}
        </span>
      </div>
      {reset && (
        <div className="bf-acct__row">
          <span className="bf-acct__k">{labels.resets}</span>
          <span className="bf-acct__v">{reset}</span>
        </div>
      )}

      <div className="bf-pmenu__group">{labels.usage}</div>
      {snapshot.meters.length === 0 && <div className="bf-pmenu__desc">{labels.usageEmpty}</div>}
      {snapshot.meters.map((m) => {
        const pct = m.unlimited ? null : Math.max(0, Math.min(100, Math.round(m.percentUsed)));
        return (
          <div key={m.key} className="bf-acct__meter">
            <div className="bf-acct__row bf-acct__row--flush">
              <span className="bf-acct__k">{labelForKey(labels.meters, m.key)}</span>
              <span className="bf-acct__v">{pct == null ? labels.unlimited : `${pct}%`}</span>
            </div>
            {pct != null && (
              <>
                <div className="bf-acct__bar" aria-hidden="true">
                  <div className="bf-acct__bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="bf-acct__meta">
                  {fill(labels.meterOf, { used: num(m.used), limit: num(m.limit), unit: labelForKey(labels.units, m.unit) })}
                </div>
              </>
            )}
          </div>
        );
      })}

      {onUpgrade && (
        <button type="button" className="bf-pmenu__item" onClick={() => onUpgrade(free ? 'pricing' : 'billing')}>
          <span className="bf-pmenu__lbl">{free ? labels.upgrade : labels.managePlan}</span>
        </button>
      )}
    </div>
  );
}
