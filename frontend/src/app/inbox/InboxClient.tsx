'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createCloudAgent, listMyAgents } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';
import { llmChat } from '@/lib/builderforceApi';
import {
  mailboxApi,
  type MailboxAutomationRule,
  type MailboxAutomationRuleInput,
  type MailboxAutomationExecution,
  type MailboxConnection,
  type MailboxFilter,
  type MailboxMessage,
} from '@/lib/mailboxApi';
import styles from './InboxClient.module.css';

type Folder = 'all' | 'unread' | 'attachments';
const EMPTY_RULE: MailboxAutomationRuleInput = {
  name: '', enabled: true, fromContains: '', subjectContains: '', agentRef: null,
  responseMode: 'draft', instructions: '',
};

function htmlFromText(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)).replace(/\n/g, '<br>');
}

function replyAddress(from: string): string {
  return from.match(/<([^<>]+)>/)?.[1]?.trim() || from.trim();
}

export function InboxClient() {
  const t = useTranslations('inboxApp');
  const [connections, setConnections] = useState<MailboxConnection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MailboxMessage[]>([]);
  const [selected, setSelected] = useState<MailboxMessage | null>(null);
  const [folder, setFolder] = useState<Folder>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reply, setReply] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<MailboxAutomationRule[]>([]);
  const [executions, setExecutions] = useState<MailboxAutomationExecution[]>([]);
  const [ruleDraft, setRuleDraft] = useState<MailboxAutomationRuleInput>(EMPTY_RULE);
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [newAgentName, setNewAgentName] = useState('');

  const connection = connections.find((item) => item.id === connectionId) ?? null;
  const activeAgent = agents.find((agent) => String(agent.id) === ruleDraft.agentRef) ?? null;

  useEffect(() => {
    Promise.all([mailboxApi.providers(), listMyAgents().catch(() => [])])
      .then(([mailbox, ownedAgents]) => {
        setConnections(mailbox.connections);
        setConnectionId(mailbox.connections.find((item) => item.status === 'connected')?.id ?? mailbox.connections[0]?.id ?? null);
        setAgents(ownedAgents);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  const loadMessages = useCallback(async () => {
    if (connectionId == null) return;
    setLoading(true); setError('');
    const filter: MailboxFilter = {
      q: query || undefined,
      unread: folder === 'unread',
      hasAttachments: folder === 'attachments',
      limit: 50,
    };
    try {
      const result = await mailboxApi.listMessages(connectionId, filter);
      setMessages(result.messages);
      setSelected((current) => result.messages.find((message) => message.id === current?.id) ?? result.messages[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'));
    } finally { setLoading(false); }
  }, [connectionId, folder, query, t]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (connectionId == null) { setRules([]); setExecutions([]); return; }
    void Promise.all([mailboxApi.listRules(connectionId), mailboxApi.listAutomation(connectionId)])
      .then(([ruleResult, executionResult]) => { setRules(ruleResult.rules); setExecutions(executionResult.executions); })
      .catch(() => { setRules([]); setExecutions([]); });
  }, [connectionId]);

  const openMessage = async (message: MailboxMessage) => {
    setSelected(message); setReply(''); setError('');
    if (message.unread && connectionId != null) {
      void mailboxApi.setUnread(connectionId, message.id, false).then(() => {
        setMessages((current) => current.map((item) => item.id === message.id ? { ...item, unread: false } : item));
        setSelected((current) => current?.id === message.id ? { ...current, unread: false } : current);
      }).catch(() => undefined);
    }
    if (!message.bodyText && connectionId != null) {
      try { setSelected(await mailboxApi.getMessage(connectionId, message.id)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t('loadFailed')); }
    }
  };

  const matchingRule = useMemo(() => selected ? rules.find((rule) => rule.enabled
    && (!rule.fromContains || selected.from.toLowerCase().includes(rule.fromContains.toLowerCase()))
    && (!rule.subjectContains || selected.subject.toLowerCase().includes(rule.subjectContains.toLowerCase()))) : undefined, [rules, selected]);

  const generateReply = async () => {
    if (!selected) return;
    const agent = agents.find((item) => String(item.id) === (matchingRule?.agentRef ?? ruleDraft.agentRef)) ?? activeAgent;
    setBusy(true); setError('');
    try {
      const result = await llmChat([
        { role: 'system', content: `${t('draftSystem')}\n${agent ? `${t('actingAs')}: ${agent.name}${agent.title ? ` — ${agent.title}` : ''}. ${agent.bio ?? ''}` : ''}\n${matchingRule?.instructions ?? ''}` },
        { role: 'user', content: `${t('from')}: ${selected.from}\n${t('subject')}: ${selected.subject}\n\n${selected.bodyText || selected.snippet}` },
      ], { temperature: 0.3, maxTokens: 900 });
      setReply(result.content);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('draftFailed')); }
    finally { setBusy(false); }
  };

  const sendReply = async () => {
    if (!selected || connectionId == null || !reply.trim()) return;
    setBusy(true); setError('');
    try {
      await mailboxApi.send(connectionId, {
        to: replyAddress(selected.from),
        subject: /^re:/i.test(selected.subject) ? selected.subject : `Re: ${selected.subject}`,
        html: htmlFromText(reply),
      });
      setReply(''); setNotice(t('sent')); window.setTimeout(() => setNotice(''), 3500);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('sendFailed')); }
    finally { setBusy(false); }
  };

  const saveRule = async () => {
    if (connectionId == null || !ruleDraft.name.trim()) return;
    setBusy(true); setError('');
    try {
      const created = await mailboxApi.createRule(connectionId, ruleDraft);
      setRules((current) => [...current, created]); setRuleDraft(EMPTY_RULE); setNotice(t('ruleSaved'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('ruleFailed')); }
    finally { setBusy(false); }
  };

  const createAgent = async () => {
    if (!newAgentName.trim()) return;
    setBusy(true); setError('');
    try {
      const agent = await createCloudAgent({ name: newAgentName.trim(), title: t('emailAgentTitle'), skills: ['email', 'customer-communication'], published: false });
      setAgents((current) => [...current, agent]);
      setRuleDraft((current) => ({ ...current, agentRef: String(agent.id) }));
      setNewAgentName(''); setNotice(t('agentCreated'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('agentFailed')); }
    finally { setBusy(false); }
  };

  const runAutomation = async () => {
    setBusy(true); setError('');
    try {
      const result = await mailboxApi.runAutomation();
      if (connectionId != null) setExecutions((await mailboxApi.listAutomation(connectionId)).executions);
      setNotice(t('automationResult', result));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('automationFailed')); }
    finally { setBusy(false); }
  };

  if (!loading && connections.length === 0) return <main className={styles.shell}>
    <div className={styles.empty}><div><h2>{t('connectTitle')}</h2><p>{t('connectBody')}</p><Link className={styles.primary} href="/growth">{t('connectAction')}</Link></div></div>
  </main>;

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <h1 className={styles.brand}>{t('title')}</h1>
      <select className={styles.account} value={connectionId ?? ''} aria-label={t('account')}
        onChange={(event) => { setConnectionId(Number(event.target.value)); setSelected(null); }}>
        {connections.map((item) => <option key={item.id} value={item.id}>{item.accountEmail}</option>)}
      </select>
      <input className={styles.search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
      <button className={styles.button} type="button" onClick={() => setRulesOpen(true)}>{t('rules')}</button>
      <button className={styles.button} type="button" disabled={loading} onClick={() => void loadMessages()}>{t('refresh')}</button>
    </header>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.main}>
      <nav className={styles.folders} aria-label={t('folders')}>
        {(['all', 'unread', 'attachments'] as const).map((id) => <button key={id} className={styles.folder} data-active={folder === id} onClick={() => setFolder(id)}>
          <span aria-hidden>{id === 'all' ? '✉' : id === 'unread' ? '●' : '📎'}</span><span>{t(`folder.${id}`)}</span>
        </button>)}
        <div className={styles.folderSection}>{t('marketing')}</div>
        <Link className={styles.folder} href="/growth"><span aria-hidden>📣</span><span>{t('campaigns')}</span></Link>
        {connection && <div className={styles.connectionCard}>{t('connectedAs')}<br /><strong>{connection.accountEmail}</strong><br />{connection.provider === 'google' ? 'Gmail' : 'Microsoft 365'}</div>}
      </nav>
      <section className={styles.messages} aria-label={t('messageList')}>
        <div className={styles.listToolbar}><h2>{t(`folder.${folder}`)}</h2><span className={styles.meta}>{t('messageCount', { count: messages.length })}</span></div>
        {loading ? <div className={styles.empty}>{t('loading')}</div> : messages.length === 0 ? <div className={styles.empty}>{t('empty')}</div> : <ul className={styles.messageList}>
          {messages.map((message) => <li key={message.id}><button className={styles.message} data-active={selected?.id === message.id} data-unread={message.unread} onClick={() => void openMessage(message)}>
            <div className={styles.row}><span className={styles.sender}>{message.fromName || message.from}</span><time className={styles.date}>{new Date(message.receivedAtISO).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time></div>
            <div className={styles.subject}>{message.subject || t('noSubject')}</div><div className={styles.snippet}>{message.hasAttachments ? '📎 ' : ''}{message.snippet}</div>
          </button></li>)}
        </ul>}
      </section>
      <article className={styles.reading}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!selected ? <div className={styles.empty}>{t('selectMessage')}</div> : <>
          <header className={styles.readingHeader}><h2>{selected.subject || t('noSubject')}</h2><div className={styles.senderLine}>
            <span className={styles.avatar}>{(selected.fromName || selected.from).slice(0, 1).toUpperCase()}</span><div><strong>{selected.fromName || selected.from}</strong><div className={styles.meta}>{t('fromAddress', { email: selected.from })} · {new Date(selected.receivedAtISO).toLocaleString()}</div></div>
          </div><div className={styles.actions}><button className={styles.button} onClick={async () => { if (connectionId == null) return; const unread = !selected.unread; await mailboxApi.setUnread(connectionId, selected.id, unread); setSelected({ ...selected, unread }); setMessages((current) => current.map((item) => item.id === selected.id ? { ...item, unread } : item)); }}>{selected.unread ? t('markRead') : t('markUnread')}</button>{selected.webUrl && <a className={styles.button} href={selected.webUrl} target="_blank" rel="noreferrer noopener">{t('openProvider')}</a>}</div></header>
          <div className={styles.body}>{selected.bodyText || selected.snippet}</div>
          <section className={styles.reply} aria-label={t('reply')}>
            <div className={styles.replyTop}><strong>{t('reply')}</strong>{matchingRule && <span className={styles.meta}>{t('matchedRule', { name: matchingRule.name })}</span>}</div>
            <textarea className={styles.textarea} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={t('replyPlaceholder')} />
            <div className={styles.actions}><button className={styles.primary} disabled={busy || !reply.trim() || !connection?.allowSending} onClick={() => void sendReply()}>{t('send')}</button><button className={styles.button} disabled={busy} onClick={() => void generateReply()}>{busy ? t('drafting') : t('draftWithAgent')}</button>{!connection?.allowSending && <span className={styles.error}>{t('sendingDisabled')}</span>}</div>
          </section>
        </>}
      </article>
    </div>
    {rulesOpen && <><button className={styles.drawerBackdrop} aria-label={t('close')} onClick={() => setRulesOpen(false)} /><aside className={styles.drawer} aria-label={t('rules')}>
      <div className={styles.drawerHeader}><div><h2>{t('rules')}</h2><p className={styles.meta}>{connection?.accountEmail}</p></div><div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => void runAutomation()}>{t('runNow')}</button><button className={styles.button} onClick={() => setRulesOpen(false)}>{t('close')}</button></div></div>
      {rules.map((rule) => <div className={styles.rule} key={rule.id}><div className={styles.row}><strong>{rule.name}</strong><label className={styles.meta}><input type="checkbox" checked={rule.enabled} onChange={async (event) => { const updated = await mailboxApi.updateRule(rule.id, { enabled: event.target.checked }); setRules((current) => current.map((item) => item.id === rule.id ? updated : item)); }} /> {t('enabled')}</label></div><p className={styles.meta}>{rule.fromContains ? t('fromContainsValue', { value: rule.fromContains }) : t('anySender')} · {t(`mode.${rule.responseMode}`)}</p><button className={styles.button} onClick={async () => { await mailboxApi.deleteRule(rule.id); setRules((current) => current.filter((item) => item.id !== rule.id)); }}>{t('delete')}</button></div>)}
      {executions.length > 0 && <section><h3>{t('automationActivity')}</h3>{executions.slice(0, 20).map((execution) => <div className={styles.rule} key={execution.id}><div className={styles.row}><strong>{execution.subject || t('noSubject')}</strong><span className={styles.meta}>{t(`executionStatus.${['processing', 'draft', 'pending_approval', 'sent', 'failed', 'rejected'].includes(execution.status) ? execution.status : 'failed'}`)}</span></div><p className={styles.meta}>{execution.sender} · {new Date(execution.createdAt).toLocaleString()}</p>{execution.draftText && <p className={styles.body}>{execution.draftText}</p>}{execution.error && <p className={styles.error}>{execution.error}</p>}<div className={styles.actions}>{execution.status === 'draft' && <button className={styles.primary} onClick={async () => { await mailboxApi.sendAutomationDraft(execution.id); setExecutions((current) => current.map((item) => item.id === execution.id ? { ...item, status: 'sent' } : item)); }}>{t('sendDraft')}</button>}{execution.status === 'pending_approval' && <Link className={styles.button} href="/workforce?tab=approvals">{t('reviewApproval')}</Link>}</div></div>)}</section>}
      <div className={styles.rule}><strong>{t('newRule')}</strong><div className={styles.ruleGrid}>
        <label className={`${styles.field} ${styles.fieldWide}`}>{t('ruleName')}<input className={styles.control} value={ruleDraft.name} onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className={styles.field}>{t('fromContains')}<input className={styles.control} value={ruleDraft.fromContains} onChange={(event) => setRuleDraft((current) => ({ ...current, fromContains: event.target.value }))} /></label>
        <label className={styles.field}>{t('subjectContains')}<input className={styles.control} value={ruleDraft.subjectContains} onChange={(event) => setRuleDraft((current) => ({ ...current, subjectContains: event.target.value }))} /></label>
        <label className={styles.field}>{t('agent')}<select className={styles.control} value={ruleDraft.agentRef ?? ''} onChange={(event) => setRuleDraft((current) => ({ ...current, agentRef: event.target.value || null }))}><option value="">{t('chooseAgent')}</option>{agents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{agent.name}</option>)}</select></label>
        <label className={styles.field}>{t('responseMode')}<select className={styles.control} value={ruleDraft.responseMode} onChange={(event) => setRuleDraft((current) => ({ ...current, responseMode: event.target.value as MailboxAutomationRuleInput['responseMode'] }))}>{(['draft', 'approval', 'automatic'] as const).map((mode) => <option key={mode} value={mode}>{t(`mode.${mode}`)}</option>)}</select></label>
        {ruleDraft.responseMode === 'automatic' && <p className={`${styles.error} ${styles.fieldWide}`}>{t('automaticWarning')}</p>}
        <label className={`${styles.field} ${styles.fieldWide}`}>{t('instructions')}<textarea className={styles.textarea} value={ruleDraft.instructions} onChange={(event) => setRuleDraft((current) => ({ ...current, instructions: event.target.value }))} /></label>
      </div><div className={styles.actions}><button className={styles.primary} disabled={busy || !ruleDraft.name.trim() || !ruleDraft.agentRef} onClick={() => void saveRule()}>{t('saveRule')}</button>{!ruleDraft.agentRef && <span className={styles.error}>{t('agentRequired')}</span>}</div></div>
      <div className={styles.rule}><strong>{t('createAgent')}</strong><p className={styles.meta}>{t('createAgentHelp')}</p><div className={styles.actions}><input className={styles.control} value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} placeholder={t('agentName')} /><button className={styles.button} disabled={busy || !newAgentName.trim()} onClick={() => void createAgent()}>{t('create')}</button></div></div>
    </aside></>}
  </main>;
}
