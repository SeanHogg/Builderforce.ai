'use client';

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

function fmt(field: TrackerField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'bool') return value ? 'Yes' : 'No';
  if (field.type === 'date') {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }
  return String(value);
}

export function TrackerSurface({ title, apiBase, fields }: TrackerSurfaceProps) {
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

  if (loading) return <div style={{ color: '#64748b' }}>Loading {title}…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
        {!form && <button onClick={openAdd} style={btn}>+ Add</button>}
      </div>
      {error && <div role="alert" style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}

      {form ? (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>{editingId ? 'Edit' : 'New'} {title}</div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            {fields.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: f.type === 'textarea' ? '1 / -1' : undefined }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>{f.label}{f.required ? ' *' : ''}</span>
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
        <div style={{ color: '#64748b' }}>No entries yet.</div>
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
                    {f.type === 'select' ? <span style={badge}>{fmt(f, row[f.key])}</span> : fmt(f, row[f.key])}
                  </td>
                ))}
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEdit(row)} style={linkBtn}>Edit</button>
                  <button onClick={() => remove(row.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
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
      <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  return <input {...common} type={type} value={String(value ?? '')} onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)} />;
}

const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: 'var(--text-secondary, #64748b)', border: '1px solid var(--border-subtle, #e2e8f0)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' };
const card: React.CSSProperties = { border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: 8, padding: 16, background: 'var(--bg-base, #f8fafc)' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-subtle, #e2e8f0)', color: '#64748b', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--border-subtle, #f1f5f9)' };
const input: React.CSSProperties = { fontSize: 13, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-subtle, #e2e8f0)', background: 'var(--bg-base, #fff)', color: 'var(--text-primary, #0f172a)', width: '100%' };
const badge: React.CSSProperties = { fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-elevated, #f1f5f9)', color: 'var(--text-secondary, #475569)' };
