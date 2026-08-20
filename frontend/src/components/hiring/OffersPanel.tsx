/**
 * Every offer in the workspace, in one list.
 *
 * The drawer is where an offer is DRAFTED and SENT, because an offer is about one
 * candidate and that is where the candidate is. This is the other question — "what is
 * outstanding" — which the drawer cannot answer because it only ever shows one person.
 *
 * Nothing here re-derives whether an offer is signed. `signatureRequestId` is the pointer
 * to the platform's one signature engine, and the status beside it is the offer's own
 * lifecycle; a second "is it signed" computed in a component is exactly the drift the
 * engine exists to prevent.
 */
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle } from '@/components/dataTableStyles';
import type { AtsOffer } from '@/lib/hiringApi';
import { cardStyle, chipStyle, mutedStyle } from './hiringStyles';

export interface OffersPanelProps {
  offers: AtsOffer[];
  loading: boolean;
  onOpenCandidate: (applicationId: number) => void;
}

export function OffersPanel({ offers, loading, onOpenCandidate }: OffersPanelProps) {
  const t = useTranslations('ats');
  const fmt = useFormat();

  if (loading) return <p style={mutedStyle}>{t('offers.loading')}</p>;

  if (offers.length === 0) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 32 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t('offers.emptyTitle')}</p>
        <p style={{ ...mutedStyle, marginTop: 6 }}>{t('offers.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>{t('offers.role')}</th>
            <th style={thStyle}>{t('offers.candidate')}</th>
            <th style={thStyle}>{t('offers.compensation')}</th>
            <th style={thStyle}>{t('offers.statusColumn')}</th>
            <th style={thStyle}>{t('offers.sent')}</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.id} style={trStyle}>
              <td style={tdStyle}>
                {offer.applicationId === null ? offer.title : (
                  <button
                    type="button"
                    onClick={() => onOpenCandidate(offer.applicationId as number)}
                    style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)' }}
                  >
                    {offer.title}
                  </button>
                )}
              </td>
              <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{offer.candidateRef.slice(0, 8)}…</td>
              <td style={tdStyle}>{offer.baseSalary ? `${offer.currency} ${offer.baseSalary}` : t('offer.noSalary')}</td>
              <td style={tdStyle}>
                <span style={chipStyle}>{t(`offer.status.${offer.status}` as never)}</span>
              </td>
              <td style={tdStyle}>{offer.sentAt ? fmt.date(offer.sentAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
