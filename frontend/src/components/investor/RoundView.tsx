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
  cardStyle, emptyStyle, gapChipStyle, listRowStyle, listStyle, mutedStyle, rowStyle, sectionStyle,
} from './investorStyles';

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
        <Stat label={t('round.readiness')} value={`${detail.readiness}%`} hint={t('round.readinessHint')} />
        <Stat label={t('round.openGaps')} value={String(detail.gaps.length)} hint={t('round.openGapsHint')} />
        <Stat label={t('round.investors')} value={String(live.length)} hint={t('round.investorsHint', { signed: signed.length })} />
        <Stat label={t('round.projects')} value={String(detail.projects.length)} hint={t('round.projectsHint')} />
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

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <span style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      <small style={mutedStyle}>{hint}</small>
    </div>
  );
}
