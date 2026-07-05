'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type AdminNewsletterSubscriber,
  type AdminNewsletterTemplate,
  type AdminNewsletterEvent,
} from '@/lib/adminApi';
import { errText, fmtDate, fmtDateTime, fmtNum, AdminError, AdminLoading } from '@/components/admin/adminShared';
import { Select } from '@/components/Select';

export default function NewsletterPanel() {
  const [newsletterStatusFilter, setNewsletterStatusFilter] = useState<'all' | 'subscribed' | 'unsubscribed' | 'suppressed'>('subscribed');
  const [newsletterSearch, setNewsletterSearch] = useState('');

  const [newsletterSubscribers, setNewsletterSubscribers] = useState<AdminNewsletterSubscriber[]>([]);
  const [newsletterTemplates, setNewsletterTemplates] = useState<AdminNewsletterTemplate[]>([]);
  const [newsletterEvents, setNewsletterEvents] = useState<AdminNewsletterEvent[]>([]);

  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState('');

  const [newsletterTemplateName, setNewsletterTemplateName] = useState('');
  const [newsletterTemplateSubject, setNewsletterTemplateSubject] = useState('');
  const [newsletterTemplatePreheader, setNewsletterTemplatePreheader] = useState('');
  const [newsletterTemplateBody, setNewsletterTemplateBody] = useState('');
  const [newsletterTemplateBusy, setNewsletterTemplateBusy] = useState(false);

  const [newsletterTrackTemplateId, setNewsletterTrackTemplateId] = useState('');
  const [newsletterTrackEmail, setNewsletterTrackEmail] = useState('');
  const [newsletterTrackBusy, setNewsletterTrackBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = newsletterStatusFilter === 'all' ? undefined : newsletterStatusFilter;
      const [subs, templates, events] = await Promise.all([
        adminApi.newsletterSubscribers({ status, q: newsletterSearch || undefined, limit: 400 }),
        adminApi.newsletterTemplates(),
        adminApi.newsletterEvents(300),
      ]);
      setNewsletterSubscribers(subs);
      setNewsletterTemplates(templates);
      setNewsletterEvents(events);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsletterStatusFilter, newsletterSearch]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && !initialLoaded) return <AdminLoading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <AdminError message={error} />
      <div className="health-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
        <div className="health-card">
          <div className="health-label">Subscribers</div>
          <div className="health-value">{fmtNum(newsletterSubscribers.length)}</div>
        </div>
        <div className="health-card">
          <div className="health-label">Templates</div>
          <div className="health-value">{newsletterTemplates.length}</div>
        </div>
        <div className="health-card">
          <div className="health-label">Tracked events</div>
          <div className="health-value">{fmtNum(newsletterEvents.length)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          className="admin-select"
          value={newsletterStatusFilter}
          onChange={(e) => {
            setNewsletterStatusFilter(e.target.value as typeof newsletterStatusFilter);
          }}
        >
          <option value="all">All</option>
          <option value="subscribed">Subscribed</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="suppressed">Suppressed</option>
        </Select>
        <input
          type="text"
          placeholder="Search email"
          value={newsletterSearch}
          onChange={(e) => setNewsletterSearch(e.target.value)}
          className="admin-select"
          style={{ width: 180 }}
        />
        <button type="button" className="btn-ghost" onClick={() => reload()}>↻ Refresh</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Source</th>
              <th>User</th>
              <th>Subscribed</th>
              <th>Unsubscribed</th>
            </tr>
          </thead>
          <tbody>
            {newsletterSubscribers.slice(0, 200).map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td>
                <td>
                  <span className={`badge ${s.status === 'subscribed' ? 'badge-success' : 'badge-neutral'}`}>
                    {s.status}
                  </span>
                </td>
                <td className="text-muted">{s.source}</td>
                <td className="text-muted">{(s.userDisplayName || s.userUsername) ? `${s.userDisplayName ?? s.userUsername ?? ''} (${s.userUsername ?? ''})` : '—'}</td>
                <td className="text-muted">{s.subscribedAt ? fmtDate(s.subscribedAt) : '—'}</td>
                <td className="text-muted">{s.unsubscribedAt ? fmtDate(s.unsubscribedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="health-card" style={{ padding: 16 }}>
        <div className="health-label" style={{ marginBottom: 12 }}>Create template</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Name"
            value={newsletterTemplateName}
            onChange={(e) => setNewsletterTemplateName(e.target.value)}
            className="admin-select"
          />
          <input
            type="text"
            placeholder="Subject"
            value={newsletterTemplateSubject}
            onChange={(e) => setNewsletterTemplateSubject(e.target.value)}
            className="admin-select"
          />
        </div>
        <input
          type="text"
          placeholder="Preheader"
          value={newsletterTemplatePreheader}
          onChange={(e) => setNewsletterTemplatePreheader(e.target.value)}
          className="admin-select"
          style={{ width: '100%', marginBottom: 8 }}
        />
        <textarea
          placeholder="Body (Markdown)"
          value={newsletterTemplateBody}
          onChange={(e) => setNewsletterTemplateBody(e.target.value)}
          className="admin-token-textarea"
          style={{ minHeight: 120, marginBottom: 8 }}
        />
        <button
          type="button"
          className="admin-tab active"
          disabled={newsletterTemplateBusy || !newsletterTemplateName.trim() || !newsletterTemplateSubject.trim() || !newsletterTemplateBody.trim()}
          onClick={async () => {
            setNewsletterTemplateBusy(true);
            setError('');
            try {
              await adminApi.createNewsletterTemplate({
                name: newsletterTemplateName.trim(),
                subject: newsletterTemplateSubject.trim(),
                preheader: newsletterTemplatePreheader.trim() || undefined,
                bodyMarkdown: newsletterTemplateBody.trim(),
              });
              setNewsletterTemplateName('');
              setNewsletterTemplateSubject('');
              setNewsletterTemplatePreheader('');
              setNewsletterTemplateBody('');
              await reload();
            } catch (e) {
              setError(errText(e));
            } finally {
              setNewsletterTemplateBusy(false);
            }
          }}
        >
          {newsletterTemplateBusy ? 'Saving…' : 'Save template'}
        </button>
      </div>
      <div className="health-card" style={{ padding: 16 }}>
        <div className="health-label" style={{ marginBottom: 12 }}>Track send</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            className="admin-select"
            value={newsletterTrackTemplateId}
            onChange={(e) => setNewsletterTrackTemplateId(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">Select template</option>
            {newsletterTemplates.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.name}</option>
            ))}
          </Select>
          <input
            type="email"
            placeholder="Subscriber email"
            value={newsletterTrackEmail}
            onChange={(e) => setNewsletterTrackEmail(e.target.value)}
            className="admin-select"
            style={{ width: 220 }}
          />
          <button
            type="button"
            className="admin-tab"
            disabled={newsletterTrackBusy || !newsletterTrackTemplateId || !newsletterTrackEmail.trim()}
            onClick={async () => {
              setNewsletterTrackBusy(true);
              setError('');
              try {
                await adminApi.trackNewsletterEvent({
                  subscriberEmail: newsletterTrackEmail.trim(),
                  templateId: newsletterTrackTemplateId ? Number(newsletterTrackTemplateId) : undefined,
                  eventType: 'template_sent',
                });
                setNewsletterTrackEmail('');
                await reload();
              } catch (e) {
                setError(errText(e));
              } finally {
                setNewsletterTrackBusy(false);
              }
            }}
          >
            {newsletterTrackBusy ? 'Sending…' : 'Track send'}
          </button>
        </div>
      </div>
      <div>
        <div className="health-label" style={{ marginBottom: 8 }}>Templates ({newsletterTemplates.length})</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Subject</th>
                <th>Active</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {newsletterTemplates.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{t.slug}</td>
                  <td>{t.subject}</td>
                  <td>{t.isActive ? '✓' : '—'}</td>
                  <td className="text-muted">{t.updatedAt ? fmtDateTime(t.updatedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="health-label" style={{ marginBottom: 8 }}>Recent events ({newsletterEvents.length})</div>
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Email</th>
                <th>Event</th>
                <th>Template</th>
              </tr>
            </thead>
            <tbody>
              {newsletterEvents.slice(0, 100).map((ev) => (
                <tr key={ev.id}>
                  <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{ev.createdAt ? fmtDateTime(ev.createdAt) : '—'}</td>
                  <td>{ev.email}</td>
                  <td>{ev.eventType}</td>
                  <td className="text-muted">{ev.templateSlug ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
