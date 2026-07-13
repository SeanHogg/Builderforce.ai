'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useRole, hasMinRole } from '@/lib/rbac';
import { factsApi, type Fact, type FactInput } from '@/lib/builderforceApi';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';

/**
 * FactsPageClient — the FACTS library surface. A filterable table of
 * (subject, predicate, object) triples with provenance, add/edit via the
 * canonical SlideOutPanel. Writes are gated to developer+ (mirrors the server
 * requireRole(DEVELOPER) on /api/facts writes). Fully localized + themed.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const EMPTY: FactInput = { subject: '', predicate: '', object: '', source: '', confidence: null, projectId: null };

export default function FactsPageClient() {
  const t = useTranslations('factsPage');
  const role = useRole();
  const canManage = hasMinRole(role, 'developer');

  const [facts, setFacts] = useState<Fact[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [predicates, setPredicates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  const [predicate, setPredicate] = useState('');

  const [editing, setEditing] = useState<Fact | null>(null);
  const [draft, setDraft] = useState<FactInput>(EMPTY);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      factsApi.list({ q: q || undefined, subject: subject || undefined, predicate: predicate || undefined }),
      factsApi.schema(),
    ])
      .then(([rows, schema]) => {
        setFacts(rows);
        setSubjects(schema.subjects);
        setPredicates(schema.predicates);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, subject, predicate]);

  useEffect(() => { load(); }, [subject, predicate]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => { setEditing(null); setDraft(EMPTY); setPanelOpen(true); };
  const openEdit = (f: Fact) => {
    setEditing(f);
    setDraft({ subject: f.subject, predicate: f.predicate, object: f.object, source: f.source ?? '', confidence: f.confidence, projectId: f.projectId });
    setPanelOpen(true);
  };

  const save = async () => {
    if (!draft.subject.trim() || !draft.predicate.trim() || !draft.object.trim()) {
      setError(t('validation'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) await factsApi.update(editing.id, draft);
      else await factsApi.create(draft);
      setPanelOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f: Fact) => {
    try { await factsApi.remove(f.id); setFacts((prev) => prev.filter((x) => x.id !== f.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const hasFilters = useMemo(() => !!(q || subject || predicate), [q, subject, predicate]);

  return (
    <div className="page-inner">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>{t('title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0, maxWidth: 620 }}>{t('subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!canManage} title={canManage ? undefined : t('needDeveloper')}>
          {t('newFact')}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="search"
          className="input"
          style={{ maxWidth: 260 }}
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
        />
        <Select className="input" style={{ maxWidth: 200 }} value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">{t('allSubjects')}</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select className="input" style={{ maxWidth: 200 }} value={predicate} onChange={(e) => setPredicate(e.target.value)}>
          <option value="">{t('allPredicates')}</option>
          {predicates.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        {hasFilters && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setQ(''); setSubject(''); setPredicate(''); }}>
            {t('clear')}
          </button>
        )}
      </div>

      {loading && <div style={card}>{t('loading')}</div>}
      {error && <div style={{ ...card, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

      {!loading && !error && (
        facts.length === 0 ? (
          <div style={{ ...card, color: 'var(--text-muted)' }}>{t('empty')}</div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('colSubject')}</th>
                  <th style={thStyle}>{t('colPredicate')}</th>
                  <th style={thStyle}>{t('colObject')}</th>
                  <th style={thStyle}>{t('colSource')}</th>
                  <th style={thStyle}>{t('colConfidence')}</th>
                  <th style={thStyle}>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {facts.map((f) => (
                  <tr key={f.id} style={trStyle}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{f.subject}</td>
                    <td style={tdMutedStyle}>{f.predicate}</td>
                    <td style={tdStyle}>{f.object}</td>
                    <td style={tdMutedStyle}>{f.source ?? '—'}</td>
                    <td style={tdMutedStyle}>{f.confidence != null ? `${Math.round(f.confidence * 100)}%` : '—'}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(f)} disabled={!canManage}>{t('edit')}</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(f)} disabled={!canManage}>{t('delete')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <SlideOutPanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editing ? t('editFact') : t('newFact')}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('colSubject')}>
            <input className="input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder={t('subjectPlaceholder')} />
          </Field>
          <Field label={t('colPredicate')}>
            <input className="input" value={draft.predicate} onChange={(e) => setDraft({ ...draft, predicate: e.target.value })} placeholder={t('predicatePlaceholder')} />
          </Field>
          <Field label={t('colObject')}>
            <textarea className="input" style={{ minHeight: 90 }} value={draft.object} onChange={(e) => setDraft({ ...draft, object: e.target.value })} placeholder={t('objectPlaceholder')} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={t('colSource')}>
              <input className="input" value={draft.source ?? ''} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder={t('sourcePlaceholder')} />
            </Field>
            <Field label={t('colConfidence')}>
              <input
                className="input"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.confidence ?? ''}
                onChange={(e) => setDraft({ ...draft, confidence: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="0.0 – 1.0"
              />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !canManage}>
              {saving ? t('saving') : t('save')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPanelOpen(false)}>{t('cancel')}</button>
          </div>
        </div>
      </SlideOutPanel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}
