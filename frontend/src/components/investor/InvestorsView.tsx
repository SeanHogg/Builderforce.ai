/**
 * Investors — the COMPANY-level grant (IN-2).
 *
 * ── WHAT THIS SURFACE IS SAYING ─────────────────────────────────────────────
 * An investor is invited to the COMPANY, not to a room. One grant carries one
 * NDA, one watermark identity, one expiry and one revocation, and it reaches
 * every room this company has — including rooms built after the invitation went
 * out. That is why this is a top-level sub-view rather than a panel inside the
 * data room: filing it under a room would restate the exact defect it fixes.
 *
 * ── THE TOKEN IS SHOWN ONCE ─────────────────────────────────────────────────
 * Only the hash is stored, so the link cannot be read back. It is rendered
 * verbatim once, with that fact stated — a surface that offered "copy link
 * again" would be promising something the server cannot do.
 *
 * ── REVOKING IS A TERMINAL, DESTRUCTIVE ACT ─────────────────────────────────
 * …and the one place the app convention allows a centred confirm. It is kept as
 * an in-row confirm step here rather than a modal because it is reversible in
 * the only sense that matters — the founder can invite the same fund again — and
 * because a modal over a panel over a board is a third layer for a two-word
 * decision. What it does say plainly is the SCOPE: revoking ends access to every
 * room, not to one.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import {
  investorApi,
  type CompanyDetail,
  type CompanyInvestorAnalytics,
  type CreatedInvestorGrant,
  type InvestorGrantSummary,
} from '@/lib/investorApi';
import {
  buttonStyle, cardStyle, emptyStyle, errorStyle, gapChipStyle, inputStyle, labelStyle,
  listRowStyle, listStyle, message, mutedStyle, primaryButtonStyle, rowStyle, sectionStyle, tokenStyle,
} from './investorStyles';

export function InvestorsView({
  detail,
  investors,
  analytics,
  onChanged,
}: {
  detail: CompanyDetail | null;
  investors: InvestorGrantSummary[];
  analytics: CompanyInvestorAnalytics | null;
  onChanged: () => void;
}) {
  const t = useTranslations('investor');
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<CreatedInvestorGrant | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const companyId = detail?.id ?? null;

  const invite = useCallback(() => {
    if (companyId == null || !name.trim() || !email.includes('@')) return;
    setBusy(true);
    setError(null);
    investorApi.investors
      .invite(companyId, {
        recipientName: name.trim(),
        recipientEmail: email.trim(),
        expiresAt: expiresAt || null,
        purpose: purpose.trim() || null,
      })
      .then((grant) => {
        setMinted(grant);
        setInviting(false);
        setName('');
        setEmail('');
        setExpiresAt('');
        setPurpose('');
        onChanged();
      })
      .catch((cause: unknown) => setError(message(cause, t('error.invite'))))
      .finally(() => setBusy(false));
  }, [companyId, email, expiresAt, name, onChanged, purpose, t]);

  const revoke = useCallback((grantId: string) => {
    if (companyId == null) return;
    setBusy(true);
    setError(null);
    investorApi.investors
      .revoke(companyId, grantId)
      .then(() => { setConfirming(null); onChanged(); })
      .catch((cause: unknown) => setError(message(cause, t('error.revoke'))))
      .finally(() => setBusy(false));
  }, [companyId, onChanged, t]);

  if (!detail) return <p style={mutedStyle}>{t('common.pickCompany')}</p>;

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('investors.title', { name: detail.name })}</h2>
        <button type="button" style={primaryButtonStyle} onClick={() => setInviting((open) => !open)}>
          {inviting ? t('common.cancel') : t('investors.invite')}
        </button>
      </div>
      <p style={mutedStyle}>{t('investors.blurb')}</p>

      {error && <p style={errorStyle} role="alert">{error}</p>}

      {inviting && (
        <div style={cardStyle}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div>
              <label style={labelStyle} htmlFor="investor-name">{t('investors.name')}</label>
              <input id="investor-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="investor-email">{t('investors.email')}</label>
              <input id="investor-email" type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="investor-expires">{t('investors.expires')}</label>
              <input id="investor-expires" type="date" style={inputStyle} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="investor-purpose">{t('investors.purpose')}</label>
              <input id="investor-purpose" style={inputStyle} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>
          </div>
          <p style={mutedStyle}>{t('investors.ndaNotice')}</p>
          <button type="button" style={primaryButtonStyle} onClick={invite} disabled={busy || !name.trim() || !email.includes('@')}>
            {busy ? t('common.saving') : t('investors.send')}
          </button>
        </div>
      )}

      {minted && (
        <div style={cardStyle} role="status">
          <b>{t('investors.mintedTitle', { email: minted.recipientEmail })}</b>
          <p style={mutedStyle}>{t('investors.mintedOnce')}</p>
          <code style={tokenStyle}>{minted.token}</code>
          <p style={mutedStyle}>
            {minted.ndaState === 'pending' ? t('investors.mintedNdaPending') : t('investors.mintedNdaNone')}
            {minted.downloadRefusedByWatermark ? ` ${t('investors.mintedWatermarkRefusedDownload')}` : ''}
          </p>
          <button type="button" style={buttonStyle} onClick={() => setMinted(null)}>{t('common.dismiss')}</button>
        </div>
      )}

      {investors.length === 0 ? (
        <p style={emptyStyle}>{t('investors.empty')}</p>
      ) : (
        <ul style={listStyle}>
          {investors.map((investor) => (
            <li key={investor.grantId} style={listRowStyle}>
              <span style={{ minWidth: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
                <Icon name="person" size={18} />
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block' }}>{investor.recipientName || investor.recipientEmail}</b>
                  <small style={mutedStyle}>
                    {investor.recipientEmail}
                    {investor.expiresAt ? ` · ${t('investors.expiresOn', { date: investor.expiresAt.slice(0, 10) })}` : ''}
                  </small>
                </span>
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={gapChipStyle}>{t(`investors.state.${investor.state}`)}</span>
                <span style={gapChipStyle}>{t(`investors.nda.${investor.ndaState}`)}</span>
                {/* Read across EVERY room of the company, which a per-room share
                    list cannot answer: this is the person, not the file. */}
                <span style={gapChipStyle}>{t('investors.activity', { opens: investor.roomsOpened, views: investor.documentViews })}</span>
                {investor.state === 'active' && (
                  confirming === investor.grantId ? (
                    <>
                      <span style={mutedStyle}>{t('investors.revokeScope')}</span>
                      <button type="button" style={buttonStyle} onClick={() => revoke(investor.grantId)} disabled={busy}>
                        {t('investors.revokeConfirm')}
                      </button>
                      <button type="button" style={buttonStyle} onClick={() => setConfirming(null)}>{t('common.cancel')}</button>
                    </>
                  ) : (
                    <button type="button" style={buttonStyle} onClick={() => setConfirming(investor.grantId)}>
                      {t('investors.revoke')}
                    </button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {analytics && analytics.documents.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{t('investors.readTitle')}</h3>
          <p style={mutedStyle}>{t('investors.readBlurb')}</p>
          <ul style={{ ...listStyle, marginTop: 10 }}>
            {analytics.documents.slice(0, 12).map((document) => (
              <li key={document.documentId} style={listRowStyle}>
                <span style={{ minWidth: 0 }}>{document.label || document.documentId}</span>
                <span style={gapChipStyle}>{t('investors.views', { count: document.views })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
