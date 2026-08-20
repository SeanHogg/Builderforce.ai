'use client';

import { useTranslations } from 'next-intl';

import type { Formatter } from '@/i18n/format';
import { useFormat } from '@/i18n/useFormat';

import { Select } from '@/components/Select';

import { useEffect, useMemo, useState } from 'react';
import { segmentTrackerClient, type TrackerRow } from '@/lib/builderforceApi';

/**
 * One generic CRUD surface for EVERY governance tracker (vendors, incidents, PII,
 * DPA, training, compliance calendar, DSR, suppression). Driven by a field
 * schema — list + add/edit form + delete — so each tracker is a config entry,
 * not a bespoke component (DRY). All calls are segment-scoped server-side.
 */

export interface TrackerField {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'bool' | 'date' | 'select';
  options?: string[];
  required?: boolean;
  /** Show as a column in the list table. */
  inList?: boolean;
}

export interface TrackerSurfaceProps {
  title: string;
  /** Full API route for this tracker, e.g. '/api/product/mvp'. */
  apiBase: string;
  fields: TrackerField[];
}

/**
 * One tracker cell as text.
 *
 * Takes the formatter and the translator rather than reaching for either: this
 * is module scope, where a hook cannot run. Before that it rendered dates in the
 * browser's language and printed a literal "Yes"/"No" in every locale.
 */
function cellText(fmt: Formatter, t: (key: string) => string, field: TrackerField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'bool') return value ? t('yes') : t('no');
  if (field.type === 'date') return fmt.date(String(value));
  return String(value);
}

export function TrackerSurface({ title, apiBase, fields }: TrackerSurfaceProps) {
  const fmt = useFormat();
  const tCommon = useTranslations('common');
  const api = useMemo(() => segmentTrackerClient(apiBase), [apiBase]);
  const listFields = fields.filter((f) => f.inList !== false && f.type !== 'textarea').slice(0, 5);

  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.list().then(setRows).catch(() => setError('Could not load.')).finally(() => setLoading(false));
  };
  useEffect(load, [api]);

  const openAdd = () => {
    setEditingId(null);
    setForm(Object.fromEntries(fields.map((f) => [f.key, f.type === 'bool' ? false : ''])));
  };
  const openEdit = (row: TrackerRow) => {
    setEditingId(row.id);
    setForm(Object.fromEntries(fields.map((f) => [f.key, row[f.key] ?? (f.type === 'bool' ? false : '')])));
  };

  const save = async () => {
    if (!form) return;
    for (const f of fields) {
      if (f.required && (form[f.key] === '' || form[f.key] == null)) {
        setError(`${f.label} is required`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    // Drop empty optionals so they aren't sent as ''.
    const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '' && v != null));
    try {
      if (editingId) await api.update(editingId, payload);
      else await api.create(payload);
      setForm(null);
      setEditingId(null);
      load();
    } catch {
      setError('Save failed (manager role required for changes).');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id)); // optimistic
    try {
      await api.remove(id);
    } catch {
      setError('Delete failed.');
      load();
    }
  };

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>Loading {title}…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
        {!form && <button onClick={openAdd} style={btn}>+ Add</button>}
      </div>
      {error && <div role="alert" style={{ color: 'var(--error-text)', marginBottom: 8 }}>{error}</div>}

      {form ? (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>{editingId ? 'Edit' : 'New'} {title}</div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            {fields.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: f.type === 'textarea' ? '1 / -1' : undefined }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{f.label}{f.required ? ' *' : ''}</span>
                <FieldInput field={f} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setForm(null); setEditingId(null); setError(null); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>No entries yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {listFields.map((f) => <th key={f.key} style={th}>{f.label}</th>)}
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {listFields.map((f) => (
                  <td key={f.key} style={td}>
                    {f.type === 'select' ? <span style={badge}>{cellText(fmt, tCommon, f, row[f.key])}</span> : cellText(fmt, tCommon, f, row[f.key])}
                  </td>
                ))}
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEdit(row)} style={linkBtn}>Edit</button>
                  <button onClick={() => remove(row.id)} style={{ ...linkBtn, color: 'var(--error-text)' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: TrackerField; value: unknown; onChange: (v: unknown) => void }) {
  const common = { style: input } as const;
  if (field.type === 'bool') {
    return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (field.type === 'textarea') {
    return <textarea {...common} rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'select') {
    return (
      <Select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  return <input {...common} type={type} value={String(value ?? '')} onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)} />;
}

const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' };
const card: React.CSSProperties = { border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16, background: 'var(--bg-base)' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' };
const input: React.CSSProperties = { fontSize: 13, padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', width: '100%' };
const badge: React.CSSProperties = { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' };
