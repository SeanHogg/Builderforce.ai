
/**
 * The details panel for an `email` object.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * An email on the canvas had NO inspector section at all, so the panel fell through to
 * the common header and showed one field: the name, holding the subject. Reported
 * 2026-08-14: "the details only have a section for Subject. It's also missing the TO,
 * FROM, etc." An email whose recipient and body cannot be seen or edited is not an
 * email — it is a title with an envelope icon.
 *
 * ── AND WHY IT NAMES THE CONNECTOR ───────────────────────────────────────────────
 * The same report: "if it's going to send the email, it should indicate a connector for
 * Email and the integration settings." A compose box with a Send button and no visible
 * mailbox implies the product will send from somewhere the user never chose. The
 * connector is therefore the FIRST section, before the message, and it states which
 * account this would leave from — or that none is connected, with the way to fix that.
 * Sending is offered only when a mailbox that is actually allowed to send is selected.
 *
 * A RECEIVED message (one pinned from an inbox, which carries `messageId`) is a record
 * of something that already happened. It renders the same fields read-only and links to
 * the provider instead of offering to send.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';
import {
  mailboxApi,
  htmlFromText,
  replyAddress,
  resolveMailboxConnection,
  type MailboxConnection,
  type MailboxProviderInfo,
} from '@/lib/mailboxApi';

/** Recipients as the object stores them (a list) and as the user edits them (a line). */
function recipientList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function CanvasEmailComposer({ data, editable, persistence, onChange }: {
  data: CreationNodeData;
  editable: boolean;
  persistence: 'local' | 'server';
  onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.email');
  const [providers, setProviders] = useState<MailboxProviderInfo[]>([]);
  const [connections, setConnections] = useState<MailboxConnection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // A local board has no tenant, so there is no mailbox to read and the fetch would
  // 401. Say so rather than showing an empty connector that looks broken.
  const anonymous = persistence !== 'server';
  useEffect(() => {
    if (anonymous) { setLoaded(true); return; }
    let live = true;
    mailboxApi.providers()
      .then((result) => { if (!live) return; setProviders(result.providers); setConnections(result.connections); })
      .catch(() => undefined)
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [anonymous]);

  const received = !!text(data.messageId).trim();
  const sendable = connections.filter((connection) => connection.allowSending && connection.status === 'connected');
  // The SAME resolution the canvas tools and the server use, so the mailbox named here
  // is the mailbox a send would actually leave from.
  const resolved = resolveMailboxConnection(
    connections,
    { connectionId: typeof data.connectionId === 'number' ? data.connectionId : null, accountEmail: text(data.accountEmail) || null },
    { forSending: !received },
  );
  const selectedId = resolved.ok ? resolved.connection.id : null;
  const to = recipientList(data.to);
  const subject = text(data.subject) || data.title;
  const body = text(data.bodyText);
  const canSend = !received && editable && selectedId != null && to.length > 0 && !!subject.trim() && !!body.trim();

  const connect = useCallback(async (provider: MailboxProviderInfo) => {
    setBusy(true);
    try {
      const { authUrl } = await mailboxApi.connect(provider.name, window.location.pathname);
      window.location.href = authUrl;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('connectFailed'));
      setBusy(false);
    }
  }, [t]);

  const send = async () => {
    if (!canSend || selectedId == null) return;
    setBusy(true); setNotice(t('sending'));
    try {
      const result = await mailboxApi.send(selectedId, {
        to: to.map(replyAddress).join(', '),
        subject: subject.trim(),
        html: htmlFromText(body),
      });
      // The object becomes the RECORD of what was sent. Without `messageId` it would
      // still read as an unsent draft after a successful send.
      onChange({
        messageId: result.id,
        connectionId: selectedId,
        accountEmail: result.accountEmail,
        from: result.accountEmail,
        status: t('sentStatus'),
      });
      setNotice(t('sent'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('sendFailed'));
    } finally {
      setBusy(false);
    }
  };

  const webUrl = text(data.webUrl);
  const configurable = providers.filter((provider) => provider.configured);

  return <>
    <section className={styles.inspectorSection} aria-label={t('mailbox')}>
      <div className={styles.inspectorSectionHeading}>
        <strong>{t('mailbox')}</strong>
        <span>{received ? t('receivedLabel') : selectedId != null ? t('readyToSend') : t('notConnected')}</span>
      </div>
      {!loaded ? <p className={styles.inspectorHint}>{t('loadingMailboxes')}</p>
        : anonymous ? <p className={styles.inspectorHint}>{t('anonymousHint')}</p>
        : sendable.length > 0 ? <>
          <label>{t('sendsFrom')}
            <select
              value={selectedId ?? ''}
              onChange={(event) => {
                const connection = sendable.find((candidate) => candidate.id === Number(event.target.value));
                onChange(connection
                  ? { connectionId: connection.id, accountEmail: connection.accountEmail, from: connection.accountEmail }
                  : { connectionId: undefined, accountEmail: undefined });
              }}
            >
              <option value="">{t('chooseMailbox')}</option>
              {sendable.map((connection) => <option key={connection.id} value={connection.id}>{connection.accountEmail}</option>)}
            </select>
          </label>
          {!resolved.ok && <p className={styles.inspectorHint}>{resolved.error}</p>}
        </> : <>
          <p className={styles.inspectorHint}>{connections.length ? t('noSendingMailbox') : t('noMailboxHint')}</p>
          <div className={styles.inspectorPills}>
            {configurable.map((provider) => <button key={provider.name} type="button" disabled={busy || !editable} onClick={() => void connect(provider)}>{t('connectProvider', { provider: provider.label })}</button>)}
          </div>
        </>}
      {/* Always reachable: choosing a different mailbox, or turning sending on for one
          already connected, both live in integration settings. */}
      {!anonymous && <Link className={styles.inspectorSettingsLink} href="/settings/integrations">{t('integrationSettings')}</Link>}
    </section>

    <label>{t('to')}
      <input
        value={to.join(', ')}
        disabled={received}
        placeholder={t('toPlaceholder')}
        onChange={(event) => onChange({ to: recipientList(event.target.value) })}
      />
    </label>
    <label>{t('from')}
      <input value={text(data.from) || text(data.accountEmail)} disabled placeholder={t('fromPlaceholder')} />
    </label>
    <label>{t('subject')}
      <input
        value={subject}
        disabled={received}
        placeholder={t('subjectPlaceholder')}
        // The card is titled by its subject, so an edit that changed one and not the
        // other would show two different subject lines for one message.
        onChange={(event) => onChange({ subject: event.target.value, title: event.target.value })}
      />
    </label>
    <label>{t('body')}
      <textarea
        rows={12}
        value={body}
        disabled={received}
        placeholder={t('bodyPlaceholder')}
        onChange={(event) => onChange({ bodyText: event.target.value })}
      />
    </label>

    {received
      ? webUrl && <a className={styles.inspectorSettingsLink} href={webUrl} target="_blank" rel="noreferrer noopener">{t('openInProvider')}</a>
      : <button type="button" className={styles.fullButton} disabled={!canSend || busy} onClick={() => void send()}>{busy ? t('sending') : t('send')}</button>}
    {notice && <p className={styles.inspectorHint} role="status">{notice}</p>}
  </>;
}
