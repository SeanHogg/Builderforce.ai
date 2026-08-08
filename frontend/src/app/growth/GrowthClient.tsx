'use client';

/**
 * Growth — market the thing you just built.
 *
 * Five things, because a campaign needs all of them and showing them together
 * is what makes the missing one obvious:
 *   mailboxes  the Microsoft 365 / Gmail account you can read and send from
 *   audiences  who to send to  (fed automatically by site form submissions)
 *   senders    who it is from  (a domain you proved you own)
 *   brand      the logo and images an email can actually load
 *   campaigns  what to send, and through which of the three transports
 *
 * The send button's disabled state and the reason beside it BOTH come from
 * `campaignBlockers`, so they cannot disagree about why a campaign is not ready.
 * The composer lives in a SlideOutPanel rather than inline: a campaign has a
 * transport, a template, a subject and a body, and cramming that into a column
 * next to three other cards is how people send the wrong thing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  campaignBlockers,
  growthApi,
  type Audience,
  type Campaign,
  type CampaignTransport,
  type EmailTemplate,
  type MarketingAsset,
  type SenderIdentity,
} from '@/lib/growthApi';
import { mailboxApi, type MailboxConnection, type MailboxProviderInfo } from '@/lib/mailboxApi';
import { connectorsApi, type ConnectorConnection } from '@/lib/connectorsApi';

/** Twilio's email product. The campaign transport resolves against this key. */
const SENDGRID_CONNECTOR_KEY = 'sendgrid';

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

/** A native <select> renders its options in the OS popup, which does not inherit
 *  the page's colours — so both the control AND the options need an explicit
 *  opaque pair or the list is unreadable in dark mode. */
const selectStyle: React.CSSProperties = { ...input, appearance: 'auto' };
const optionStyle: React.CSSProperties = {
  background: 'var(--surface, #ffffff)',
  color: 'var(--text-primary, #111827)',
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
  color: 'var(--text-on-accent, #ffffff)',
};

const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted, #6b7280)' };
const listItem: React.CSSProperties = {
  padding: '8px 0',
  borderTop: '1px solid var(--border, #e5e7eb)',
};
const listReset: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '10px 0 0' };
const spread: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{children}</div>;
}

/** A draft campaign as the composer holds it before it becomes a row. */
interface Draft {
  name: string;
  subject: string;
  bodyHtml: string;
  audienceId: number | null;
  templateId: number | null;
  transport: CampaignTransport;
  senderIdentityId: number | null;
  mailboxConnectionId: number | null;
  connectorConnectionId: string | null;
  fromName: string;
}

const EMPTY_DRAFT: Draft = {
  name: '', subject: '', bodyHtml: '', audienceId: null, templateId: null,
  transport: 'platform', senderIdentityId: null, mailboxConnectionId: null,
  connectorConnectionId: null, fromName: '',
};

export function GrowthClient() {
  const t = useTranslations('growth');
  const confirm = useConfirm();
  const searchParams = useSearchParams();

  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [senders, setSenders] = useState<SenderIdentity[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxConnection[]>([]);
  const [providers, setProviders] = useState<MailboxProviderInfo[]>([]);
  const [sendgridConnections, setSendgridConnections] = useState<ConnectorConnection[]>([]);

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [audienceName, setAudienceName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [logoBrief, setLogoBrief] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const uploadRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [a, s, c, tpl, ast, mbx, sg] = await Promise.all([
      growthApi.listAudiences().catch(() => ({ audiences: [] })),
      growthApi.listSenders().catch(() => ({ senders: [] })),
      growthApi.listCampaigns().catch(() => ({ campaigns: [] })),
      growthApi.listTemplates().catch(() => ({ templates: [] })),
      growthApi.listAssets().catch(() => ({ assets: [] })),
      mailboxApi.providers().catch(() => ({ providers: [], connections: [] })),
      connectorsApi.listConnections(SENDGRID_CONNECTOR_KEY).catch(() => []),
    ]);
    setAudiences(a.audiences);
    setSenders(s.senders);
    setCampaigns(c.campaigns);
    setTemplates(tpl.templates);
    setAssets(ast.assets);
    setProviders(mbx.providers);
    setMailboxes(mbx.connections);
    setSendgridConnections(sg.filter((conn) => conn.enabled));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /**
   * Report the outcome of the OAuth round-trip.
   *
   * The connect flow leaves and re-enters the app, so without this the user
   * lands back on a page that looks exactly as they left it and has no way to
   * tell a successful grant from a declined one.
   */
  useEffect(() => {
    const outcome = searchParams.get('mailbox');
    if (!outcome) return;
    if (outcome === 'connected') setNotice(t('mailboxes.connected'));
    else setError(t(`mailboxes.error.${outcome === 'declined' ? 'declined' : 'failed'}`));
  }, [searchParams, t]);

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

  const connectMailbox = useCallback(async (provider: MailboxProviderInfo['name']) => {
    setError('');
    try {
      // A full-page navigation, not a fetch: the provider's consent screen
      // cannot be framed or XHR'd.
      const { authUrl } = await mailboxApi.connect(provider, '/growth');
      window.location.href = authUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    }
  }, [t]);

  const sendableMailboxes = useMemo(
    () => mailboxes.filter((m) => m.allowSending && m.status === 'connected'),
    [mailboxes],
  );
  const verifiedSenders = useMemo(() => senders.filter((s) => s.status === 'verified'), [senders]);

  /**
   * Why this draft cannot be created yet.
   *
   * The same shape as `campaignBlockers` and for the same reason: the create
   * button's disabled state and the sentence explaining it come from ONE list,
   * so a user is never left with a dead button and no explanation.
   */
  const draftBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!draft.name.trim()) blockers.push('name');
    if (!draft.subject.trim()) blockers.push('subject');
    if (draft.audienceId == null) blockers.push('audience');
    if (draft.transport === 'mailbox' && draft.mailboxConnectionId == null) blockers.push('mailbox');
    if (draft.transport !== 'mailbox' && draft.senderIdentityId == null) blockers.push('sender');
    // SendGrid enforces its own sender verification, so it needs BOTH a verified
    // identity (above) and the key to deliver through.
    if (draft.transport === 'sendgrid' && !draft.connectorConnectionId) blockers.push('connection');
    return blockers;
  }, [draft]);

  const applyTemplate = useCallback((templateId: number | null) => {
    const template = templates.find((tpl) => tpl.id === templateId);
    setDraft((prev) => ({
      ...prev,
      templateId,
      // Only fill fields the author has not already written into — re-picking a
      // template must not silently discard a subject they typed themselves.
      subject: prev.subject.trim() ? prev.subject : (template?.subject ?? ''),
      bodyHtml: prev.bodyHtml.trim() ? prev.bodyHtml : (template?.bodyHtml ?? ''),
    }));
  }, [templates]);

  const createCampaign = useCallback(() => run(async () => {
    await growthApi.createCampaign({
      name: draft.name,
      audienceId: draft.audienceId!,
      subject: draft.subject,
      bodyHtml: draft.bodyHtml,
      transport: draft.transport,
      ...(draft.templateId != null ? { templateId: draft.templateId } : {}),
      ...(draft.senderIdentityId != null ? { senderIdentityId: draft.senderIdentityId } : {}),
      ...(draft.mailboxConnectionId != null ? { mailboxConnectionId: draft.mailboxConnectionId } : {}),
      ...(draft.connectorConnectionId ? { connectorConnectionId: draft.connectorConnectionId } : {}),
      ...(draft.fromName.trim() ? { fromName: draft.fromName.trim() } : {}),
    });
    setDraft(EMPTY_DRAFT);
    setComposerOpen(false);
  }, t('campaigns.created')), [draft, run, t]);

  const sendCampaign = useCallback(async (campaign: Campaign) => {
    // A campaign reaches thousands of real strangers and cannot be recalled, so
    // it is one of the few things in the product that earns a modal.
    const ok = await confirm({
      title: t('campaigns.confirmSendTitle'),
      message: t('campaigns.confirmSend', { name: campaign.name }),
      confirmLabel: t('campaigns.send'),
      destructive: false,
    });
    if (!ok) return;
    await run(() => growthApi.send(campaign.id), t('campaigns.sent'));
  }, [confirm, run, t]);

  return (
    <main style={page}>
      <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 1.9rem)', margin: 0 }}>{t('title')}</h1>
      <p style={{ ...muted, marginTop: 6 }}>{t('description')}</p>

      {notice && <p role="status" style={{ ...muted, color: 'var(--success-text, #166534)' }}>{notice}</p>}
      {error && <p role="alert" style={{ ...muted, color: 'var(--danger-text, #991b1b)' }}>{error}</p>}

      <div style={{
        display: 'grid', gap: 16, marginTop: 20,
        gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
      }}>
        {/* ---- mailboxes ---- */}
        <section style={card} aria-labelledby="growth-mailboxes">
          <h2 id="growth-mailboxes" style={{ fontSize: 15, margin: 0 }}>{t('mailboxes.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('mailboxes.description')}</p>
          {mailboxes.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('mailboxes.empty')}</p>
          ) : (
            <ul style={listReset}>
              {mailboxes.map((mailbox) => (
                <li key={mailbox.id} style={listItem}>
                  <div style={spread}>
                    <span style={{ overflowWrap: 'anywhere' }}>{mailbox.accountEmail}</span>
                    <span style={{
                      ...muted,
                      color: mailbox.status === 'connected'
                        ? 'var(--success-text, #166534)'
                        : 'var(--danger-text, #991b1b)',
                    }}>
                      {t(`mailboxes.status.${mailbox.status === 'connected' ? 'connected' : 'reconnect'}`)}
                    </span>
                  </div>
                  <div style={{ ...muted, marginTop: 2 }}>
                    {t(`mailboxes.provider.${mailbox.provider}`)}
                  </div>
                  <Row>
                    <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={mailbox.allowSending}
                        disabled={busy || mailbox.status !== 'connected'}
                        onChange={(e) => run(
                          () => mailboxApi.setSending(mailbox.id, e.target.checked),
                          t('mailboxes.sendingUpdated'),
                        )}
                      />
                      {t('mailboxes.allowSending')}
                    </label>
                    <button type="button" style={button} disabled={busy}
                      onClick={async () => {
                        const ok = await confirm({
                          message: t('mailboxes.confirmDisconnect', { email: mailbox.accountEmail }),
                        });
                        if (!ok) return;
                        await run(() => mailboxApi.disconnect(mailbox.id), t('mailboxes.disconnected'));
                      }}>
                      {t('mailboxes.disconnect')}
                    </button>
                  </Row>
                </li>
              ))}
            </ul>
          )}
          <Row>
            {providers.map((provider) => (
              <button key={provider.name} type="button" style={button}
                disabled={busy || !provider.configured}
                title={provider.configured ? undefined : t('mailboxes.notConfigured')}
                onClick={() => connectMailbox(provider.name)}>
                {t('mailboxes.connect', { provider: provider.label })}
              </button>
            ))}
          </Row>
        </section>

        {/* ---- audiences ---- */}
        <section style={card} aria-labelledby="growth-audiences">
          <h2 id="growth-audiences" style={{ fontSize: 15, margin: 0 }}>{t('audiences.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('audiences.description')}</p>
          {audiences.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('audiences.empty')}</p>
          ) : (
            <ul style={listReset}>
              {audiences.map((audience) => (
                <li key={audience.id} style={{ ...listItem, ...spread }}>
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
            <ul style={listReset}>
              {senders.map((sender) => (
                <li key={sender.id} style={listItem}>
                  <div style={spread}>
                    <span style={{ overflowWrap: 'anywhere' }}>{sender.fromEmail}</span>
                    <span style={{
                      ...muted,
                      color: sender.status === 'verified'
                        ? 'var(--success-text, #166534)'
                        : 'var(--warning-text, #92400e)',
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

        {/* ---- brand: logos and images ---- */}
        <section style={card} aria-labelledby="growth-brand">
          <h2 id="growth-brand" style={{ fontSize: 15, margin: 0 }}>{t('brand.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('brand.description')}</p>
          {assets.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('brand.empty')}</p>
          ) : (
            <ul style={{ ...listReset, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {assets.map((asset) => (
                <li key={asset.id} style={{
                  display: 'grid', gap: 4, justifyItems: 'center', width: '6.5rem',
                  padding: 8, borderRadius: 8, border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--surface-2, #f9fafb)',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- an asset
                      URL is an absolute, session-less R2-backed URL on an origin
                      the Next image optimizer is not configured for. */}
                  <img src={asset.url} alt={asset.name} style={{ maxWidth: '100%', maxHeight: 44, objectFit: 'contain' }} />
                  <span style={{ ...muted, fontSize: 11, textAlign: 'center', overflowWrap: 'anywhere' }}>{asset.name}</span>
                  <button type="button" style={{ ...button, padding: '2px 8px', minHeight: 0, fontSize: 11 }}
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm({ message: t('brand.confirmDelete', { name: asset.name }) });
                      if (!ok) return;
                      await run(() => growthApi.deleteAsset(asset.id), t('brand.deleted'));
                    }}>
                    {t('brand.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Row>
            <input ref={uploadRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Reset the input so re-picking the same file fires `change` again.
                e.target.value = '';
                if (file) void run(() => growthApi.uploadAsset(file, 'logo'), t('brand.uploaded'));
              }} />
            <button type="button" style={button} disabled={busy} onClick={() => uploadRef.current?.click()}>
              {t('brand.upload')}
            </button>
          </Row>
          <Row>
            <input style={input} value={logoBrief} disabled={busy}
              onChange={(e) => setLogoBrief(e.target.value)}
              placeholder={t('brand.generatePlaceholder')} aria-label={t('brand.generateLabel')} />
            <button type="button" style={button} disabled={busy || !logoBrief.trim()}
              onClick={() => run(
                () => growthApi.generateLogo({ description: logoBrief }).then(() => setLogoBrief('')),
                t('brand.generated'),
              )}>
              {t('brand.generate')}
            </button>
          </Row>
        </section>

        {/* ---- templates ---- */}
        <section style={card} aria-labelledby="growth-templates">
          <h2 id="growth-templates" style={{ fontSize: 15, margin: 0 }}>{t('templates.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('templates.description')}</p>
          {templates.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('templates.empty')}</p>
          ) : (
            <ul style={listReset}>
              {templates.map((template) => (
                <li key={template.id} style={listItem}>
                  <div style={spread}>
                    <strong style={{ fontSize: 14 }}>{template.name}</strong>
                    <span style={muted}>{t(`templates.source.${
                      ['builtin', 'imported', 'generated'].includes(template.source) ? template.source : 'custom'
                    }`)}</span>
                  </div>
                  {template.mergeFields.length > 0 && (
                    <div style={{ ...muted, marginTop: 2 }}>
                      {t('templates.mergeFields', { fields: template.mergeFields.join(', ') })}
                    </div>
                  )}
                  <Row>
                    <button type="button" style={button} disabled={busy}
                      onClick={() => {
                        setDraft({ ...EMPTY_DRAFT, templateId: template.id, subject: template.subject, bodyHtml: template.bodyHtml });
                        setComposerOpen(true);
                      }}>
                      {t('templates.use')}
                    </button>
                    <button type="button" style={button} disabled={busy}
                      onClick={async () => {
                        const ok = await confirm({ message: t('templates.confirmDelete', { name: template.name }) });
                        if (!ok) return;
                        await run(() => growthApi.deleteTemplate(template.id), t('templates.deleted'));
                      }}>
                      {t('templates.delete')}
                    </button>
                  </Row>
                </li>
              ))}
            </ul>
          )}
          <Row>
            <ImportTemplateButton busy={busy} onImport={(name, bodyHtml) => run(
              () => growthApi.createTemplate({ name, bodyHtml, source: 'imported' }),
              t('templates.imported'),
            )} label={t('templates.import')} />
          </Row>
        </section>

        {/* ---- campaigns ---- */}
        <section style={card} aria-labelledby="growth-campaigns">
          <h2 id="growth-campaigns" style={{ fontSize: 15, margin: 0 }}>{t('campaigns.title')}</h2>
          <p style={{ ...muted, marginTop: 4 }}>{t('campaigns.description')}</p>
          {campaigns.length === 0 ? (
            <p style={{ ...muted, marginTop: 10 }}>{t('campaigns.empty')}</p>
          ) : (
            <ul style={listReset}>
              {campaigns.map((campaign) => {
                const blockers = campaignBlockers(campaign, senders, audiences, mailboxes);
                return (
                  <li key={campaign.id} style={{ ...listItem, padding: '10px 0' }}>
                    <div style={spread}>
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
                    <div style={{ ...muted, marginTop: 2 }}>
                      {t(`campaigns.transport.${
                        ['mailbox', 'sendgrid'].includes(campaign.transport) ? campaign.transport : 'platform'
                      }`)}
                    </div>
                    <button type="button" style={{ ...primary, marginTop: 8 }}
                      disabled={busy || blockers.length > 0}
                      onClick={() => sendCampaign(campaign)}>
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
            <button type="button" style={primary} disabled={busy || audiences.length === 0}
              onClick={() => { setDraft(EMPTY_DRAFT); setComposerOpen(true); }}>
              {t('campaigns.compose')}
            </button>
            {audiences.length === 0 && <span style={muted}>{t('campaigns.blocker.audience')}</span>}
          </Row>
        </section>
      </div>

      <SlideOutPanel open={composerOpen} onClose={() => setComposerOpen(false)} title={t('composer.title')}>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={muted}>{t('campaigns.nameLabel')}</span>
            <input style={input} value={draft.name} disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t('campaigns.namePlaceholder')} />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={muted}>{t('composer.audience')}</span>
            <select style={selectStyle} value={draft.audienceId ?? ''} disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, audienceId: e.target.value ? Number(e.target.value) : null }))}>
              <option value="" style={optionStyle}>{t('composer.choose')}</option>
              {audiences.map((audience) => (
                <option key={audience.id} value={audience.id} style={optionStyle}>
                  {t('composer.audienceOption', { name: audience.name, count: audience.memberCount })}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={muted}>{t('composer.template')}</span>
            <select style={selectStyle} value={draft.templateId ?? ''} disabled={busy}
              onChange={(e) => applyTemplate(e.target.value ? Number(e.target.value) : null)}>
              <option value="" style={optionStyle}>{t('composer.noTemplate')}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id} style={optionStyle}>{template.name}</option>
              ))}
            </select>
          </label>

          <fieldset style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: 12 }}>
            <legend style={{ ...muted, padding: '0 4px' }}>{t('composer.transport')}</legend>
            {(['platform', 'mailbox', 'sendgrid'] as const).map((transport) => (
              <label key={transport} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
                <input type="radio" name="transport" value={transport} disabled={busy}
                  checked={draft.transport === transport}
                  onChange={() => setDraft((d) => ({ ...d, transport }))} />
                <span>
                  <span>{t(`campaigns.transport.${transport}`)}</span>
                  <span style={{ ...muted, display: 'block' }}>{t(`composer.transportHint.${transport}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {draft.transport === 'mailbox' ? (
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={muted}>{t('composer.mailbox')}</span>
              <select style={selectStyle} value={draft.mailboxConnectionId ?? ''} disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, mailboxConnectionId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="" style={optionStyle}>{t('composer.choose')}</option>
                {sendableMailboxes.map((mailbox) => (
                  <option key={mailbox.id} value={mailbox.id} style={optionStyle}>{mailbox.accountEmail}</option>
                ))}
              </select>
              {sendableMailboxes.length === 0 && <span style={muted}>{t('composer.noMailboxes')}</span>}
            </label>
          ) : (
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={muted}>{t('composer.sender')}</span>
              <select style={selectStyle} value={draft.senderIdentityId ?? ''} disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, senderIdentityId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="" style={optionStyle}>{t('composer.choose')}</option>
                {verifiedSenders.map((sender) => (
                  <option key={sender.id} value={sender.id} style={optionStyle}>{sender.fromEmail}</option>
                ))}
              </select>
              {verifiedSenders.length === 0 && <span style={muted}>{t('composer.noSenders')}</span>}
            </label>
          )}

          {draft.transport === 'sendgrid' && (
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={muted}>{t('composer.connection')}</span>
              <select style={selectStyle} value={draft.connectorConnectionId ?? ''} disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, connectorConnectionId: e.target.value || null }))}>
                <option value="" style={optionStyle}>{t('composer.choose')}</option>
                {sendgridConnections.map((connection) => (
                  <option key={connection.id} value={connection.id} style={optionStyle}>{connection.name}</option>
                ))}
              </select>
              {sendgridConnections.length === 0 && <span style={muted}>{t('composer.noConnections')}</span>}
            </label>
          )}

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={muted}>{t('composer.fromName')}</span>
            <input style={input} value={draft.fromName} disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, fromName: e.target.value }))}
              placeholder={t('composer.fromNamePlaceholder')} />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={muted}>{t('campaigns.subjectLabel')}</span>
            <input style={input} value={draft.subject} disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              placeholder={t('campaigns.subjectPlaceholder')} />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={muted}>{t('campaigns.bodyLabel')}</span>
            <textarea style={{ ...input, minHeight: 180, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
              value={draft.bodyHtml} disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, bodyHtml: e.target.value }))}
              placeholder={t('campaigns.bodyPlaceholder')} />
            <span style={muted}>{t('composer.mergeHelp')}</span>
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={primary} disabled={busy || draftBlockers.length > 0}
              onClick={createCampaign}>
              {t('campaigns.add')}
            </button>
            <button type="button" style={button} disabled={busy} onClick={() => setComposerOpen(false)}>
              {t('composer.cancel')}
            </button>
          </div>
          {draftBlockers.length > 0 && (
            <span style={muted}>{draftBlockers.map((b) => t(`campaigns.blocker.${b}`)).join(' · ')}</span>
          )}
        </div>
      </SlideOutPanel>
    </main>
  );
}

/**
 * Import an .html file as a template.
 *
 * A file picker rather than a paste box: a real template is hundreds of lines of
 * table markup that someone exported from a design tool, and pasting it into a
 * textarea is where it gets truncated. The name comes from the filename, which
 * is what the author already called it.
 */
function ImportTemplateButton({
  busy, onImport, label,
}: { busy: boolean; onImport: (name: string, bodyHtml: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept=".html,.htm,text/html" style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          onImport(file.name.replace(/\.html?$/i, ''), await file.text());
        }} />
      <button type="button" style={button} disabled={busy} onClick={() => ref.current?.click()}>{label}</button>
    </>
  );
}
