'use client';

/**
 * Growth — market the thing you just built.
 *
 * Three columns because a campaign needs all three before it can send, and
 * showing them together is what makes the missing one obvious:
 *   audiences  who to send to  (fed automatically by site form submissions)
 *   senders    who it is from  (a domain you proved you own)
 *   campaigns  what to send
 *
 * The send button's disabled state and the reason beside it BOTH come from
 * `campaignBlockers`, so they cannot disagree about why a campaign is not ready.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  campaignBlockers,
  growthApi,
  type Audience,
  type Campaign,
  type SenderIdentity,
} from '@/lib/growthApi';

const page: React.CSSProperties = {
  padding: 'clamp(16px, 4vw, 32px)',
  maxWidth: '80rem',
  margin: '0 auto',
  color: 'var(--text-primary, #111827)',
};

const card: React.CSSProperties = {
  background: 'var(--surface, #ffffff)',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 12,
  padding: 'clamp(12px, 3vw, 20px)',
};

const input: React.CSSProperties = {
  flex: '1 1 10rem',
  minWidth: 0,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border, #e5e7eb)',
  background: 'var(--surface-2, #f9fafb)',
  color: 'var(--text-primary, #111827)',
  fontSize: 14,
};

const button: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--border, #e5e7eb)',
  background: 'var(--surface-2, #f9fafb)',
  color: 'var(--text-primary, #111827)',
  fontSize: 14,
  cursor: 'pointer',
  minHeight: 36,
};

const primary: React.CSSProperties = {
  ...button,
  background: 'var(--accent, #2563eb)',
  borderColor: 'var(--accent, #2563eb)',
  color: 'var(--accent-contrast, #ffffff)',
};

const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted, #6b7280)' };

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{children}</div>;
}

export function GrowthClient() {
  const t = useTranslations('growth');
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [senders, setSenders] = useState<SenderIdentity[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [audienceName, setAudienceName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignBody, setCampaignBody] = useState('');

  const reload = useCallback(async () => {
    const [a, s, c] = await Promise.all([
      growthApi.listAudiences().catch(() => ({ audiences: [] })),
      growthApi.listSenders().catch(() => ({ senders: [] })),
      growthApi.listCampaigns().catch(() => ({ campaigns: [] })),
    ]);
    setAudiences(a.audiences);
    setSenders(s.senders);
    setCampaigns(c.campaigns);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (op: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await op();
      setNotice(successMessage);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }, [reload, t]);

  return (
    <main style={page}>
      <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 1.9rem)', margin: 0 }}>{t('title')}</h1>
      <p style={{ ...muted, marginTop: 6 }}>{t('description')}</p>

      {notice && (
        <p role="status" style={{ ...muted, color: 'var(--success-fg, #166534)' }}>{notice}</p>
      )}
      {error && (
        <p role="alert" style={{ ...muted, color: 'var(--danger-fg, #991b1b)' }}>{error}</p>
      )}

      <div style={{
        display: 'grid', gap: 16, marginTop: 20,
        gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
      }}>
        {/* ---- audiences ---- */}
        <section style={card} aria-labelledby="growth-audiences">
          <h2 id="growth-audiences" style={{ fontSize: 15, margin: 0 }}>{t('audiences.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('audiences.description')}</p>
          {audiences.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('audiences.empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
              {audiences.map((audience) => (
                <li key={audience.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
                  padding: '8px 0', borderTop: '1px solid var(--border, #e5e7eb)',
                }}>
                  <span>{audience.name}</span>
                  <span style={muted}>{t('audiences.memberCount', { count: audience.memberCount })}</span>
                </li>
              ))}
            </ul>
          )}
          <Row>
            <input style={input} value={audienceName} disabled={busy}
              onChange={(e) => setAudienceName(e.target.value)}
              placeholder={t('audiences.namePlaceholder')} aria-label={t('audiences.nameLabel')} />
            <button type="button" style={button} disabled={busy || !audienceName.trim()}
              onClick={() => run(
                () => growthApi.createAudience({ name: audienceName }).then(() => setAudienceName('')),
                t('audiences.created'),
              )}>
              {t('audiences.add')}
            </button>
          </Row>
        </section>

        {/* ---- senders ---- */}
        <section style={card} aria-labelledby="growth-senders">
          <h2 id="growth-senders" style={{ fontSize: 15, margin: 0 }}>{t('senders.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('senders.description')}</p>
          {senders.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('senders.empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
              {senders.map((sender) => (
                <li key={sender.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border, #e5e7eb)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span>{sender.fromEmail}</span>
                    <span style={{
                      ...muted,
                      color: sender.status === 'verified'
                        ? 'var(--success-fg, #166534)'
                        : 'var(--warning-fg, #92400e)',
                    }}>
                      {t(`senders.status.${sender.status === 'verified' ? 'verified' : 'pending'}`)}
                    </span>
                  </div>
                  {sender.status !== 'verified' && (
                    <>
                      <code style={{
                        display: 'block', overflowX: 'auto', whiteSpace: 'nowrap', marginTop: 6,
                        padding: '6px 8px', borderRadius: 6, fontSize: 12,
                        background: 'var(--surface-2, #f3f4f6)',
                        border: '1px solid var(--border, #e5e7eb)',
                      }}>
                        {`TXT  ${sender.recordName}  →  ${sender.verifyToken}`}
                      </code>
                      <button type="button" style={{ ...button, marginTop: 8 }} disabled={busy}
                        onClick={() => run(() => growthApi.verifySender(sender.id), t('senders.checked'))}>
                        {t('senders.verify')}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Row>
            <input style={input} value={senderEmail} disabled={busy} type="email"
              onChange={(e) => setSenderEmail(e.target.value)}
              placeholder={t('senders.emailPlaceholder')} aria-label={t('senders.emailLabel')} />
            <button type="button" style={button} disabled={busy || !senderEmail.trim()}
              onClick={() => run(
                () => growthApi.createSender({ fromEmail: senderEmail }).then(() => setSenderEmail('')),
                t('senders.created'),
              )}>
              {t('senders.add')}
            </button>
          </Row>
        </section>

        {/* ---- campaigns ---- */}
        <section style={card} aria-labelledby="growth-campaigns">
          <h2 id="growth-campaigns" style={{ fontSize: 15, margin: 0 }}>{t('campaigns.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('campaigns.description')}</p>
          {campaigns.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('campaigns.empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
              {campaigns.map((campaign) => {
                const blockers = campaignBlockers(campaign, senders, audiences);
                return (
                  <li key={campaign.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border, #e5e7eb)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{campaign.name}</strong>
                      <span style={muted}>{t(`campaigns.status.${campaign.status}`)}</span>
                    </div>
                    <div style={{ ...muted, marginTop: 4 }}>
                      {t('campaigns.stats', {
                        sent: campaign.sent,
                        recipients: campaign.recipients,
                        opened: campaign.opened,
                        clicked: campaign.clicked,
                      })}
                    </div>
                    <button type="button" style={{ ...primary, marginTop: 8 }}
                      disabled={busy || blockers.length > 0}
                      onClick={() => run(() => growthApi.send(campaign.id), t('campaigns.sent'))}>
                      {t('campaigns.send')}
                    </button>
                    {blockers.length > 0 && (
                      // Same source as the disabled state above — the button and
                      // its explanation can never disagree.
                      <span style={{ ...muted, marginLeft: 8 }}>
                        {blockers.map((b) => t(`campaigns.blocker.${b}`)).join(' · ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Row>
            <input style={input} value={campaignName} disabled={busy}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder={t('campaigns.namePlaceholder')} aria-label={t('campaigns.nameLabel')} />
          </Row>
          <Row>
            <input style={input} value={campaignSubject} disabled={busy}
              onChange={(e) => setCampaignSubject(e.target.value)}
              placeholder={t('campaigns.subjectPlaceholder')} aria-label={t('campaigns.subjectLabel')} />
          </Row>
          <Row>
            <textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={campaignBody} disabled={busy}
              onChange={(e) => setCampaignBody(e.target.value)}
              placeholder={t('campaigns.bodyPlaceholder')} aria-label={t('campaigns.bodyLabel')} />
          </Row>
          <Row>
            <button type="button" style={button}
              disabled={busy || !campaignName.trim() || audiences.length === 0}
              onClick={() => run(
                () => growthApi.createCampaign({
                  name: campaignName,
                  audienceId: audiences[0]!.id,
                  subject: campaignSubject,
                  bodyHtml: campaignBody,
                  senderIdentityId: senders.find((s) => s.status === 'verified')?.id,
                }).then(() => { setCampaignName(''); setCampaignSubject(''); setCampaignBody(''); }),
                t('campaigns.created'),
              )}>
              {t('campaigns.add')}
            </button>
          </Row>
        </section>
      </div>
    </main>
  );
}
