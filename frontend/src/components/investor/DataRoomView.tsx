/**
 * The Data room — the rooms this company holds, and how ready each one is.
 *
 * ── WHAT THIS DOES NOT REBUILD ──────────────────────────────────────────────
 * `dataRoomSharing.ts` already mints NDA-gated, watermarked, expiring room links
 * with per-file analytics, and `founderOpsApi` already has the client for it. So
 * this view READS `listDataRooms` and filters to the selected company; the
 * per-room mint is deliberately still available here because a founder sometimes
 * does want one link to one room for one person who is not an investor in the
 * round — a lawyer, an acquirer's analyst.
 *
 * The COMPANY-level grant is the other tab, and this view says so: inviting an
 * investor to the company is the answer to "they should see all of this", and a
 * per-room link is the answer to "they should see exactly this one".
 *
 * Readiness is the server's computed number and is never re-derived here. A room
 * with no required documents reads 0 rather than 100 — "nothing is required" is
 * an unprepared room, not a complete one — and repeating that rule in the
 * browser is how a card and a share link come to disagree.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { shareDataRoom, type DataRoomShareResult, type DataRoomSummary } from '@/lib/founderOpsApi';
import type { CompanyDetail } from '@/lib/investorApi';
import {
  buttonStyle, cardStyle, emptyStyle, errorStyle, gapChipStyle, inputStyle, labelStyle,
  listRowStyle, listStyle, message, mutedStyle, primaryButtonStyle, rowStyle, sectionStyle, tokenStyle,
} from './investorStyles';

export function DataRoomView({
  detail,
  rooms,
  onChanged,
}: {
  detail: CompanyDetail | null;
  rooms: DataRoomSummary[];
  onChanged: () => void;
}) {
  const t = useTranslations('investor');
  const [openShareFor, setOpenShareFor] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<DataRoomShareResult | null>(null);

  const share = useCallback((dataRoomId: number) => {
    if (!name.trim() || !email.includes('@')) return;
    setBusy(true);
    setError(null);
    shareDataRoom(dataRoomId, { recipientName: name.trim(), recipientEmail: email.trim() })
      .then((result) => {
        setMinted(result);
        setOpenShareFor(null);
        setName('');
        setEmail('');
        onChanged();
      })
      .catch((cause: unknown) => setError(message(cause, t('error.shareRoom'))))
      .finally(() => setBusy(false));
  }, [email, name, onChanged, t]);

  if (!detail) return <p style={mutedStyle}>{t('common.pickCompany')}</p>;

  // The rooms bound to this company. `data_rooms.company_id` has always existed,
  // so this is a filter rather than a new edge.
  const ids = new Set(detail.rooms.map((room) => room.id));
  const mine = rooms.filter((room) => ids.has(room.id));

  return (
    <div style={sectionStyle}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('dataRoom.title', { name: detail.name })}</h2>
      <p style={mutedStyle}>{t('dataRoom.blurb')}</p>

      {error && <p style={errorStyle} role="alert">{error}</p>}

      {minted && (
        <div style={cardStyle} role="status">
          <b>{t('dataRoom.mintedTitle')}</b>
          <p style={mutedStyle}>{t('dataRoom.mintedOnce')}</p>
          <code style={tokenStyle}>{minted.token}</code>
          {minted.downloadRefusedByWatermark && <p style={mutedStyle}>{t('dataRoom.mintedWatermarkRefusedDownload')}</p>}
          <button type="button" style={buttonStyle} onClick={() => setMinted(null)}>{t('common.dismiss')}</button>
        </div>
      )}

      {mine.length === 0 ? (
        <p style={emptyStyle}>{t('dataRoom.empty')}</p>
      ) : (
        <ul style={listStyle}>
          {mine.map((room) => (
            <li key={room.id} style={{ ...cardStyle, padding: 12 }}>
              <div style={rowStyle}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                  <Icon name="folder" size={18} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ display: 'block' }}>{room.name}</b>
                    <small style={mutedStyle}>{room.purpose || t('dataRoom.noPurpose')}</small>
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={gapChipStyle}>{t('dataRoom.readiness', { percent: room.readiness })}</span>
                  {room.ndaRequired && <span style={gapChipStyle}>{t('dataRoom.nda')}</span>}
                  {room.watermark && <span style={gapChipStyle}>{t('dataRoom.watermark')}</span>}
                  <span style={gapChipStyle}>{t('dataRoom.links', { count: room.activeShares })}</span>
                  <button type="button" style={buttonStyle} onClick={() => setOpenShareFor((open) => (open === room.id ? null : room.id))}>
                    {t('dataRoom.share')}
                  </button>
                </span>
              </div>

              {/* Stated on the ROW, where the founder is deciding, rather than in
                  a banner they have already scrolled past: a watermarked room can
                  only ever serve these formats view-only. */}
              {room.watermark && room.unstampable > 0 && (
                <p style={mutedStyle}>{t('dataRoom.unstampable', { count: room.unstampable })}</p>
              )}

              {openShareFor === room.id && (
                <div style={{ marginTop: 10, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                  <div>
                    <label style={labelStyle} htmlFor={`share-name-${room.id}`}>{t('dataRoom.recipientName')}</label>
                    <input id={`share-name-${room.id}`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle} htmlFor={`share-email-${room.id}`}>{t('dataRoom.recipientEmail')}</label>
                    <input id={`share-email-${room.id}`} type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button type="button" style={primaryButtonStyle} onClick={() => share(room.id)} disabled={busy || !name.trim() || !email.includes('@')}>
                      {busy ? t('common.saving') : t('dataRoom.sendLink')}
                    </button>
                  </div>
                </div>
              )}

              {openShareFor === room.id && <p style={mutedStyle}>{t('dataRoom.oneRoomOnly')}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
