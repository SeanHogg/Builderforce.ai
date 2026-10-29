/**
 * The Round — the `investment_opportunities` row this company is raising.
 *
 * A READ, deliberately. The row is a registered kind (`opportunity`,
 * `registers: true`), so creating and editing one already reaches the generic
 * entity path; a second editor here would be a second writer of the same fact,
 * which is exactly what `companies` having both a table viewer and this
 * destination is NOT supposed to become.
 *
 * What the founder cannot get from the table is the round beside the things that
 * decide it: how ready the diligence is, how many investors hold access, and how
 * much of the company's work is attached. That is the whole content of this view.
 *
 * Every amount is shown as STORED — the numeric string and the row's own
 * currency — and never reformatted into a locale-guessed figure. A pre-money
 * quietly rounded on the way to the screen is a number the founder cannot
 * reconcile against the term sheet.
 */

import { useTranslations } from 'next-intl';
import type { CompanyDetail, InvestorGrantSummary } from '@/lib/investorApi';
import {
  emptyStyle, gapChipStyle, listRowStyle, listStyle, mutedStyle, sectionStyle,
} from './investorStyles';
import { StatTile } from '@/components/admin/adminShared';

export function RoundView({
  detail,
  investors,
}: {
  detail: CompanyDetail | null;
  investors: InvestorGrantSummary[];
}) {
  const t = useTranslations('investor');
  if (!detail) return <p style={mutedStyle}>{t('common.pickCompany')}</p>;

  const live = investors.filter((investor) => investor.state === 'active');
  const signed = live.filter((investor) => investor.ndaState === 'signed' || investor.ndaState === 'not-required');

  return (
    <div style={sectionStyle}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('round.title', { name: detail.name })}</h2>
      <p style={mutedStyle}>{t('round.blurb')}</p>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <StatTile label={t('round.readiness')} value={`${detail.readiness}%`} hint={t('round.readinessHint')} />
        <StatTile label={t('round.openGaps')} value={String(detail.gaps.length)} hint={t('round.openGapsHint')} />
        <StatTile label={t('round.investors')} value={String(live.length)} hint={t('round.investorsHint', { signed: signed.length })} />
        <StatTile label={t('round.projects')} value={String(detail.projects.length)} hint={t('round.projectsHint')} />
      </div>

      {detail.rounds.length === 0 ? (
        <p style={emptyStyle}>{t('round.empty')}</p>
      ) : (
        <ul style={listStyle}>
          {detail.rounds.map((round) => (
            <li key={round.id} style={listRowStyle}>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block' }}>{round.name}</b>
                <small style={mutedStyle}>
                  {[round.round, round.leadRef].filter(Boolean).join(' · ') || t('round.noTerms')}
                </small>
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {round.askAmount && (
                  <span style={gapChipStyle}>{t('round.ask', { currency: round.currency, amount: round.askAmount })}</span>
                )}
                {round.preMoney && (
                  <span style={gapChipStyle}>{t('round.preMoney', { currency: round.currency, amount: round.preMoney })}</span>
                )}
                <span style={gapChipStyle}>{round.status}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Every figure above is a DECLARED value off the company or the
          opportunity row. Saying so beside them, rather than in a footnote, is
          what stops a reader treating a typed valuation as a computed one. */}
      <p style={mutedStyle}>{t('round.declaredNotice')}</p>
    </div>
  );
}

