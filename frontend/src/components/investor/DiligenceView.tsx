/**
 * Diligence — the gap, and the seat that closes it.
 *
 * ── THIS IS THE RETENTION MECHANIC, RENDERED ────────────────────────────────
 * A REQUIRED `due_diligence_documents` row sitting at `requested` is a hole in
 * the raise. Its checklist's `category` — financial · legal · technical ·
 * commercial · people — names the SEAT that closes it, and the whole buyer
 * framing turns on that: the founder meets the CFO seat because an investor
 * asked for a P&L, not because a menu offered a feature.
 *
 * So a gap is drawn as a gap, with the seat named and a way into that seat's own
 * destination. The category is NOT re-mapped here — `domain` and `seat` arrive
 * resolved from the server's `SEAT_FOR_CATEGORY`, because two mappings is how a
 * panel and a document come to disagree about who owns "commercial".
 *
 * ── WHY GAPS ARE GROUPED BY SEAT AND NOT BY CHECKLIST ───────────────────────
 * A checklist is how the investor organised their ask. A seat is how the founder
 * can act on it: four financial gaps are one afternoon with the CFO seat, and
 * four gaps spread across four checklists are four context switches. The
 * checklist is still named on each row, so nothing is lost.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CompanyDetail, DiligenceGap } from '@/lib/investorApi';
import {
  cardStyle, emptyStyle, gapChipStyle, listRowStyle, listStyle, mutedStyle, rowStyle, sectionStyle,
} from './investorStyles';

/** Where a seat's own work happens. `/seat/<domain>` is the ONE route for the
 *  seventeen domain surfaces (PRD 20 §7.1), so this is an address rather than a
 *  second per-seat routing table. */
const seatHref = (domain: string | null): string | null => (domain ? `/seat/${domain}` : null);

export function DiligenceView({ detail }: { detail: CompanyDetail | null }) {
  const t = useTranslations('investor');

  const bySeat = useMemo(() => {
    const groups = new Map<string, { seat: string | null; domain: string | null; gaps: DiligenceGap[] }>();
    for (const gap of detail?.gaps ?? []) {
      const key = gap.seat ?? '—';
      const group = groups.get(key) ?? { seat: gap.seat, domain: gap.domain, gaps: [] };
      group.gaps.push(gap);
      groups.set(key, group);
    }
    // Most gaps first: the seat with the biggest hole is the one to open next.
    return [...groups.values()].sort((a, b) => b.gaps.length - a.gaps.length);
  }, [detail]);

  if (!detail) return <p style={mutedStyle}>{t('common.pickCompany')}</p>;

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('diligence.title', { name: detail.name })}</h2>
        <span style={gapChipStyle}>{t('diligence.readiness', { percent: detail.readiness })}</span>
      </div>
      <p style={mutedStyle}>{t('diligence.blurb')}</p>

      {detail.gaps.length === 0 ? (
        <p style={emptyStyle}>{t('diligence.empty')}</p>
      ) : (
        bySeat.map((group) => {
          const href = seatHref(group.domain);
          return (
            <div key={group.seat ?? 'unowned'} style={cardStyle}>
              <div style={rowStyle}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="check" size={18} />
                  <b>
                    {group.seat
                      ? t('diligence.seatHeading', { seat: group.seat, count: group.gaps.length })
                      : t('diligence.unownedHeading', { count: group.gaps.length })}
                  </b>
                </span>
                {/* The invitation into the seat. A gap that names its owner and
                    offers no way to reach them is a label, not a mechanic. */}
                {href && (
                  <Link href={href} style={{ ...gapChipStyle, textDecoration: 'none', color: 'var(--seat-ceo)' }}>
                    {t('diligence.openSeat', { seat: group.seat ?? '' })}
                  </Link>
                )}
              </div>
              <ul style={{ ...listStyle, marginTop: 10 }}>
                {group.gaps.map((gap) => (
                  <li key={gap.documentId} style={listRowStyle}>
                    <span style={{ minWidth: 0 }}>
                      <b style={{ display: 'block' }}>{gap.label}</b>
                      <small style={mutedStyle}>
                        {gap.checklistName} · {gap.category}
                        {gap.dueAt ? ` · ${t('diligence.due', { date: gap.dueAt.slice(0, 10) })}` : ''}
                      </small>
                      {gap.note && <small style={mutedStyle}>{gap.note}</small>}
                    </span>
                    <span style={gapChipStyle}>{t('diligence.requested')}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      {/* Said once, plainly: this list is what an investor has ASKED for and not
          received. A room that showed only the files that exist would hide the
          gap it was built to close. */}
      <p style={mutedStyle}>{t('diligence.notice')}</p>
    </div>
  );
}
