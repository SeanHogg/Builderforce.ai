'use client';

/**
 * The campaign draft form, in a SlideOutPanel rather than inline: a campaign has
 * a transport, a template, a subject and a body, and cramming that into a column
 * next to a list of sent campaigns is how people send the wrong thing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  type Audience,
  type CampaignBlocker,
  type CampaignTransport,
  type EmailTemplate,
  type SenderIdentity,
} from '@/lib/growthApi';
import type { MailboxConnection } from '@/lib/mailboxApi';
import type { ConnectorConnection } from '@/lib/connectorsApi';
import { button, input, muted, optionStyle, primary, selectStyle } from './growthStyles';

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

export interface CampaignDraftBody {
  name: string;
  audienceId: number;
  subject?: string;
  bodyHtml?: string;
  senderIdentityId?: number;
  templateId?: number;
  transport?: CampaignTransport;
  mailboxConnectionId?: number;
  connectorConnectionId?: string;
  fromName?: string;
}

interface CampaignComposerProps {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  templates: EmailTemplate[];
  audiences: Audience[];
  senders: SenderIdentity[];
  mailboxes: MailboxConnection[];
  sendgridConnections: ConnectorConnection[];
  /** A template picked from the Templates tab, carried over via `?template=`. */
  initialTemplateId: number | null;
  onCreate: (body: CampaignDraftBody) => void;
}

export function CampaignComposer({
  open, onClose, busy, templates, audiences, senders, mailboxes, sendgridConnections,
  initialTemplateId, onCreate,
}: CampaignComposerProps) {
  const t = useTranslations('growth');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // A fresh open starts a clean draft, pre-filled from `initialTemplateId` when
  // one arrived from the Templates tab.
  useEffect(() => {
    if (!open) return;
    if (initialTemplateId != null) {
      const template = templates.find((tpl) => tpl.id === initialTemplateId);
      setDraft({
        ...EMPTY_DRAFT,
        templateId: initialTemplateId,
        subject: template?.subject ?? '',
        bodyHtml: template?.bodyHtml ?? '',
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
  }, [open, initialTemplateId, templates]);

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

  const sendableMailboxes = mailboxes.filter((m) => m.allowSending && m.status === 'connected');
  const verifiedSenders = senders.filter((s) => s.status === 'verified');

  /**
   * Why this draft cannot be created yet.
   *
   * The same shape as `campaignBlockers` and for the same reason: the create
   * button's disabled state and the sentence explaining it come from ONE list,
   * so a user is never left with a dead button and no explanation.
   */
  const draftBlockers = (() => {
    const blockers: CampaignBlocker[] = [];
    if (!draft.name.trim()) blockers.push('name');
    if (!draft.subject.trim()) blockers.push('subject');
    if (draft.audienceId == null) blockers.push('audience');
    if (draft.transport === 'mailbox' && draft.mailboxConnectionId == null) blockers.push('mailbox');
    if (draft.transport !== 'mailbox' && draft.senderIdentityId == null) blockers.push('sender');
    // SendGrid enforces its own sender verification, so it needs BOTH a verified
    // identity (above) and the key to deliver through.
    if (draft.transport === 'sendgrid' && !draft.connectorConnectionId) blockers.push('connection');
    return blockers;
  })();

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('composer.title')} widthStorageKey="growth-composer">
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

        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
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
            onClick={() => onCreate({
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
            })}>
            {t('campaigns.add')}
          </button>
          <button type="button" style={button} disabled={busy} onClick={onClose}>
            {t('composer.cancel')}
          </button>
        </div>
        {draftBlockers.length > 0 && (
          <span style={muted}>{draftBlockers.map((b) => t(`campaigns.blocker.${b}`)).join(' · ')}</span>
        )}
      </div>
    </SlideOutPanel>
  );
}
