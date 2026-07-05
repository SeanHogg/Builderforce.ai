'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminPrivacyRequest } from '@/lib/adminApi';
import { Select } from '@/components/Select';
import { AdminError, AdminLoading, errText, fmtDateTime } from '@/components/admin/adminShared';

export default function PrivacyPanel() {
  const [privacyRequests, setPrivacyRequests] = useState<AdminPrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [privacyStatusFilter, setPrivacyStatusFilter] = useState('');
  const [privacyTypeFilter, setPrivacyTypeFilter] = useState('');
  const [privacySearch, setPrivacySearch] = useState('');
  const [privacyUpdateBusy, setPrivacyUpdateBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi
      .privacyRequests({
        status: privacyStatusFilter || undefined,
        type: privacyTypeFilter || undefined,
        q: privacySearch || undefined,
        limit: 400,
      })
      .then((r) => setPrivacyRequests(r))
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, [privacyStatusFilter, privacyTypeFilter, privacySearch]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && privacyRequests.length === 0) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          className="admin-select"
          value={privacyStatusFilter}
          onChange={(e) => {
            setPrivacyStatusFilter(e.target.value);
            reload();
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="closed">Closed</option>
        </Select>
        <Select
          className="admin-select"
          value={privacyTypeFilter}
          onChange={(e) => {
            setPrivacyTypeFilter(e.target.value);
            reload();
          }}
        >
          <option value="">All types</option>
          <option value="ccpa">CCPA</option>
          <option value="gdpr">GDPR</option>
        </Select>
        <input
          type="text"
          placeholder="Search email"
          value={privacySearch}
          onChange={(e) => setPrivacySearch(e.target.value)}
          className="admin-select"
          style={{ width: 180 }}
        />
        <button type="button" className="btn-ghost" onClick={() => reload()}>Search / Refresh</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Type</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Details</th>
              <th>Resolution</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {privacyRequests.map((r) => (
              <tr key={r.id}>
                <td>{r.email}</td>
                <td>{r.requestType}</td>
                <td>
                  <span className={`badge ${r.status === 'pending' ? 'badge-neutral' : r.status === 'completed' ? 'badge-success' : 'badge-neutral'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="text-muted">{r.createdAt ? fmtDateTime(r.createdAt) : '—'}</td>
                <td className="text-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.details ?? undefined}>{r.details ?? '—'}</td>
                <td className="text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.resolution ?? undefined}>{r.resolution ?? '—'}</td>
                <td>
                  {r.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={privacyUpdateBusy}
                        onClick={async () => {
                          setPrivacyUpdateBusy(true);
                          setError('');
                          try {
                            await adminApi.updatePrivacyRequest(r.id, { status: 'completed', resolution: 'Processed' });
                            reload();
                          } catch (e) {
                            setError(errText(e));
                          } finally {
                            setPrivacyUpdateBusy(false);
                          }
                        }}
                      >
                        Mark Resolved
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={privacyUpdateBusy}
                        onClick={async () => {
                          setPrivacyUpdateBusy(true);
                          setError('');
                          try {
                            await adminApi.updatePrivacyRequest(r.id, { status: 'closed', resolution: null });
                            reload();
                          } catch (e) {
                            setError(errText(e));
                          } finally {
                            setPrivacyUpdateBusy(false);
                          }
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
