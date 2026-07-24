'use client';

/**
 * Superadmin authoring for platform release notes — the changelog marketed to
 * every user via the footer "What's new" panel and the weekly digest email.
 *
 * Create/edit a note (draft or published), publish/unpublish, delete, and trigger
 * the weekly digest on demand. The `emailedAt` column tells the operator which
 * notes the digest has already sent, so an edit after a send is a conscious choice.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  type AdminReleaseNote,
  type AdminReleaseNoteCategory,
  type ReleaseDigestResult,
} from '@/lib/adminApi';
import { errText, fmtDateTime, AdminError, AdminLoading } from '@/components/admin/adminShared';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';

const CATEGORIES: AdminReleaseNoteCategory[] = ['new', 'improvement', 'fix'];

const EMPTY_DRAFT = { version: '', title: '', body: '', category: 'improvement' as AdminReleaseNoteCategory };

export default function ReleaseNotesPanel() {
  const t = useTranslations('admin');
  const tCat = useTranslations('whatsNew');
  const confirm = useConfirm();

  const [notes, setNotes] = useState<AdminReleaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [digestResult, setDigestResult] = useState<ReleaseDigestResult | null>(null);

  // The editor: an id (existing) or null (new), plus the working fields.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setNotes(await adminApi.releaseNotes());
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const resetEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (note: AdminReleaseNote) => {
    setEditingId(note.id);
    setDraft({
      version: note.version,
      title: note.title,
      body: note.body ?? '',
      category: (CATEGORIES.includes(note.category as AdminReleaseNoteCategory)
        ? note.category
        : 'improvement') as AdminReleaseNoteCategory,
    });
  };

  const save = async (publish: boolean) => {
    setBusy(true);
    setError('');
    try {
      const payload = {
        version: draft.version.trim(),
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        category: draft.category,
        publish,
      };
      if (editingId) await adminApi.updateReleaseNote(editingId, payload);
      else await adminApi.createReleaseNote(payload);
      resetEditor();
      await reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (note: AdminReleaseNote) => {
    setBusy(true);
    setError('');
    try {
      await adminApi.updateReleaseNote(note.id, { publish: !note.publishedAt });
      await reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (note: AdminReleaseNote) => {
    if (!(await confirm({ message: t('releaseNotes.deleteConfirm', { title: note.title }), destructive: true }))) return;
    setBusy(true);
    setError('');
    try {
      await adminApi.deleteReleaseNote(note.id);
      if (editingId === note.id) resetEditor();
      await reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendDigest = async () => {
    if (!(await confirm({
      message: t('releaseNotes.sendDigestConfirm'),
      confirmLabel: t('releaseNotes.sendDigest'),
      destructive: false,
    }))) return;
    setBusy(true);
    setError('');
    setDigestResult(null);
    try {
      const { result } = await adminApi.sendReleaseDigest();
      setDigestResult(result);
      await reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !initialLoaded) return <AdminLoading />;

  const canSave = draft.version.trim() !== '' && draft.title.trim() !== '';
  const unsentCount = notes.filter((n) => n.publishedAt && !n.emailedAt).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <AdminError message={error} />

      {/* Digest trigger + status */}
      <div className="health-card" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="health-label">{t('releaseNotes.digestTitle')}</div>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            {t('releaseNotes.unsentCount', { count: unsentCount })}
          </div>
          {digestResult && (
            <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
              {t('releaseNotes.digestSent', {
                notes: digestResult.notes,
                sent: digestResult.sent,
                suppressed: digestResult.suppressed,
              })}
            </div>
          )}
        </div>
        <button type="button" className="admin-tab active" disabled={busy || unsentCount === 0} onClick={sendDigest}>
          {busy ? t('common.saving') : t('releaseNotes.sendDigest')}
        </button>
      </div>

      {/* Editor */}
      <div className="health-card" style={{ padding: 16 }}>
        <div className="health-label" style={{ marginBottom: 12 }}>
          {editingId ? t('releaseNotes.editNote') : t('releaseNotes.newNote')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder={t('releaseNotes.phVersion')}
            value={draft.version}
            onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))}
            className="admin-select"
          />
          <Select
            className="admin-select"
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as AdminReleaseNoteCategory }))}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{tCat(`categories.${cat}`)}</option>
            ))}
          </Select>
        </div>
        <input
          type="text"
          placeholder={t('releaseNotes.phTitle')}
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          className="admin-select"
          style={{ width: '100%', marginBottom: 8 }}
        />
        <textarea
          placeholder={t('releaseNotes.phBody')}
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          className="admin-token-textarea"
          style={{ minHeight: 120, marginBottom: 8, width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="admin-tab active" disabled={busy || !canSave} onClick={() => save(true)}>
            {t('releaseNotes.savePublish')}
          </button>
          <button type="button" className="admin-tab" disabled={busy || !canSave} onClick={() => save(false)}>
            {t('releaseNotes.saveDraft')}
          </button>
          {editingId && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={resetEditor}>
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div>
        <div className="health-label" style={{ marginBottom: 8 }}>{t('releaseNotes.allNotes', { count: notes.length })}</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('releaseNotes.thTitle')}</th>
                <th>{t('releaseNotes.thVersion')}</th>
                <th>{t('releaseNotes.thCategory')}</th>
                <th>{t('releaseNotes.thStatus')}</th>
                <th>{t('releaseNotes.thEmailed')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notes.map((note) => (
                <tr key={note.id}>
                  <td>{note.title}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{note.version}</td>
                  <td>{tCat(`categories.${CATEGORIES.includes(note.category as AdminReleaseNoteCategory) ? note.category : 'improvement'}`)}</td>
                  <td>
                    <span className={`badge ${note.publishedAt ? 'badge-success' : 'badge-neutral'}`}>
                      {note.publishedAt ? t('releaseNotes.published') : t('releaseNotes.draft')}
                    </span>
                  </td>
                  <td className="text-muted">{note.emailedAt ? fmtDateTime(note.emailedAt) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => startEdit(note)}>
                      {t('common.edit')}
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => togglePublish(note)}>
                      {note.publishedAt ? t('releaseNotes.unpublish') : t('releaseNotes.publish')}
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => remove(note)}>
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
