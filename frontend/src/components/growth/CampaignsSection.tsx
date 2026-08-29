'use client';

/**
 * What to send, and through which transport. Owns the composer: a campaign
 * needs an audience, a sender/mailbox and a transport all at once, which is why
 * those reference lists are fetched here rather than duplicated per tab.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  campaignBlockers,
  growthApi,
  type Audience,
  type Campaign,
  type EmailTemplate,
  type SenderIdentity,
} from '@/lib/growthApi';
import { mailboxApi, type MailboxConnection } from '@/lib/mailboxApi';
import { connectorsApi, type ConnectorConnection } from '@/lib/connectorsApi';
import { CampaignComposer, type CampaignDraftBody } from './CampaignComposer';
import { button, listItem, listReset, muted, primary, spread, Row } from './growthStyles';

/** Twilio's email product. The campaign transport resolves against this key. */
const SENDGRID_CONNECTOR_KEY = 'sendgrid';

export function CampaignsSection() {
  const t = useTranslations('growth');
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [senders, setSenders] = useState<SenderIdentity[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxConnection[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [sendgridConnections, setSendgridConnections] = useState<ConnectorConnection[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [initialTemplateId, setInitialTemplateId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const [c, a, s, mbx, tpl, sg] = await Promise.all([
      growthApi.listCampaigns().catch(() => ({ campaigns: [] })),
      growthApi.listAudiences().catch(() => ({ audiences: [] })),
      growthApi.listSenders().catch(() => ({ senders: [] })),
      mailboxApi.providers().catch(() => ({ providers: [], connections: [] })),
      growthApi.listTemplates().catch(() => ({ templates: [] })),
      connectorsApi.listConnections(SENDGRID_CONNECTOR_KEY).catch(() => []),
    ]);
    setCampaigns(c.campaigns);
    setAudiences(a.audiences);
    setSenders(s.senders);
    setMailboxes(mbx.connections);
    setTemplates(tpl.templates);
    setSendgridConnections(sg.filter((conn) => conn.enabled));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // A template's "Use" button on the Templates tab lands here with `?template=`
  // so the pick survives the tab switch; clear it once consumed so a refresh
  // doesn't reopen the composer.
  useEffect(() => {
    const templateParam = searchParams.get('template');
    if (!templateParam) return;
    setInitialTemplateId(Number(templateParam));
    setComposerOpen(true);
    router.replace('/growth?tab=campaigns');
  }, [searchParams, router]);

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

  const createCampaign = useCallback((body: CampaignDraftBody) => run(async () => {
    await growthApi.createCampaign(body);
    setComposerOpen(false);
    setInitialTemplateId(null);
  }, t('campaigns.created')), [run, t]);

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    setInitialTemplateId(null);
  }, []);

  return (
    <section>
      {notice && <p role="status" style={{ ...muted, color: 'var(--success-text)' }}>{notice}</p>}
      {error && <p role="alert" style={{ ...muted, color: 'var(--danger-text)' }}>{error}</p>}
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
                  // Same source as the disabled state above — the button and its
                  // explanation can never disagree.
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
          onClick={() => { setInitialTemplateId(null); setComposerOpen(true); }}>
          {t('campaigns.compose')}
        </button>
        {audiences.length === 0 && <span style={muted}>{t('campaigns.blocker.audience')}</span>}
      </Row>

      <CampaignComposer
        open={composerOpen}
        onClose={closeComposer}
        busy={busy}
        templates={templates}
        audiences={audiences}
        senders={senders}
        mailboxes={mailboxes}
        sendgridConnections={sendgridConnections}
        initialTemplateId={initialTemplateId}
        onCreate={createCampaign}
      />
    </section>
  );
}
