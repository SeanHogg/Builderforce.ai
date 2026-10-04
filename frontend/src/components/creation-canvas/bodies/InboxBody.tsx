import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { mailboxFilterParts, type MailboxFilter } from '@/lib/mailboxApi';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { textValue, asRecord } from './shared';

/**
 * A live inbox tile.
 *
 * Two things are non-negotiable here and both are honesty about what is on
 * screen: the FILTER is shown (a tile reading "3 messages" with no visible
 * filter tells the reader they have three emails, which is false), and the read
 * TIME is shown (a live view with no freshness marker is a screenshot claiming
 * to be live).
 */
export function InboxBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const fmt = useFormat();
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const account = textValue(data.accountEmail);
  const fetchedAt = typeof data.fetchedAt === 'string' ? new Date(data.fetchedAt) : null;
  const unread = Number(data.unreadCount) || 0;
  // The filter, worded in the READER's language from the persisted `filter`. A
  // legacy tile also carries an English `subtitle` written at creation; it is read
  // only when there is no filter to word, so it never shows beside (or instead of)
  // the translated line.
  const filter = data.filter && typeof data.filter === 'object' && !Array.isArray(data.filter) ? data.filter as MailboxFilter : null;
  const day = (value: string) => Number.isNaN(Date.parse(value)) ? value : fmt.dateWith(value, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const filterParts = filter ? mailboxFilterParts(filter).map((part) => {
    switch (part.kind) {
      case 'unread': return t('inboxFilterUnread');
      case 'attachments': return t('inboxFilterAttachments');
      case 'from': return t('inboxFilterFrom', { value: part.value });
      case 'subject': return t('inboxFilterSubject', { value: part.value });
      case 'matching': return t('inboxFilterMatching', { value: part.value });
      case 'since': return t('inboxFilterSince', { date: day(part.value) });
      case 'before': return t('inboxFilterBefore', { date: day(part.value) });
    }
  }) : [];
  const filterText = filterParts.length ? fmt.list(filterParts) : '';
  const filterLabel = !filter ? textValue(data.subtitle)
    : filterText ? filterText.charAt(0).toLocaleUpperCase(fmt.locale) + filterText.slice(1)
    : t('inboxFilterAll');

  if (!account) {
    return <div className={styles.taskContext}><p className={styles.taskEmpty}>{t('inboxNotConnected')}</p></div>;
  }
  return <div className={styles.inboxBody}>
    <div className={styles.inboxMeta}>
      <span title={account}>{account}</span>
      {filterLabel && <small title={filterLabel}>{filterLabel}</small>}
      {unread > 0 && <b className={styles.inboxUnreadBadge}>{t('inboxUnread', { count: unread })}</b>}
      {fetchedAt && <small>{t('inboxReadAt', { time: fmt.time(fetchedAt) })}</small>}
    </div>
    {messages.length === 0
      ? <p className={styles.taskEmpty}>{t('inboxEmpty')}</p>
      : <ul className={styles.inboxList}>
        {messages.slice(0, 12).map((raw, index) => {
          const message = asRecord(raw, {});
          const isUnread = message.unread === true;
          return <li key={String(message.id ?? index)} className={isUnread ? styles.inboxUnread : undefined}>
            <div className={styles.inboxRowTop}>
              <b>{String(message.fromName || message.from || t('inboxUnknownSender'))}</b>
              <small>{message.receivedAtISO
                ? fmt.dateWith(String(message.receivedAtISO), { month: 'short', day: 'numeric' })
                : ''}</small>
            </div>
            <span className={styles.inboxSubject}>{String(message.subject || t('inboxNoSubject'))}</span>
            <p>{String(message.excerpt || '')}</p>
          </li>;
        })}
      </ul>}
    {messages.length > 12 && <small className={styles.inboxMore}>{t('inboxMore', { count: messages.length - 12 })}</small>}
  </div>;
}
