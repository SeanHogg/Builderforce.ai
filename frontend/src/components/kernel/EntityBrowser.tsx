'use client';

/**
 * ONE record surface for all 244 consolidated tables (PRD 20 §7.1).
 *
 * §7 says the target is "15 domain surfaces plus the canvas — not 134 rewritten
 * pages", and this is the component that makes the second half of that sentence
 * true for the data: every seat's tables are browsed, searched, created, edited
 * and retired through this one component, because after the consolidation there
 * is ONE shape to render and the per-table difference arrives as metadata from
 * `/api/<scope>/entities`.
 *
 * WHY THE FORM IS GENERATED AND NOT WRITTEN. The API already states, per column,
 * its type, whether it is required, whether it is writable and its allowed
 * values. A hand-written form per table would be 244 copies of one shape — §0's
 * rule, at the last layer it can still be broken — and 244 chances for a form to
 * drift from the column it writes.
 *
 * §7.2 STANDARDS, in this pass:
 *   · every colour a theme token, checked in both themes;
 *   · fluid — the tab strip wraps, the table scrolls inside its own container,
 *     nothing fixed-px overflows at 360px;
 *   · every visible string through `next-intl`, real translations in all five
 *     catalogs;
 *   · the component decides its own visibility per entity: a read-only entity
 *     renders no create button, an unreadable one is not offered at all. No
 *     `canX` boolean is drilled in from a parent that would have to re-derive it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  archiveEntityRow,
  createEntityRow,
  getEntityRows,
  getScopeEntities,
  updateEntityRow,
  type EntityDescriptor,
  type EntityPage,
  type EntityRow,
  type EntityScope,
} from '@/lib/kernel/kernelApi';

const PAGE_SIZE = 25;
/** Enough columns to identify a row, few enough to stay readable on a phone.
 *  The full row is the detail form, which is one click away. */
const PREVIEW_COLUMNS = 5;

const surface = { background: 'var(--surface, #101624)', border: '1px solid var(--border-subtle)' };

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The generated field control. One function, switching on the type the API
 *  reported, so a new column type is handled here once rather than per table. */
function FieldInput({
  field,
  value,
  onChange,
  label,
}: {
  field: EntityDescriptor['fields'][number];
  value: unknown;
  onChange: (next: string) => void;
  label: string;
}) {
  const shared = {
    id: `entity-field-${field.name}`,
    className: 'w-full rounded px-2 py-1.5 text-sm min-w-0',
    style: {
      background: 'var(--surface-2, rgba(255,255,255,0.06))',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-subtle)',
    },
    value: value === null || value === undefined ? '' : String(value),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
  };

  if (field.options && field.options.length > 0) {
    return (
      <select {...shared} aria-label={label}>
        <option value="" style={{ background: 'var(--surface, #101624)', color: 'var(--text-primary)' }}>
          —
        </option>
        {field.options.map((opt) => (
          // A native <option> does not inherit the control's background in every
          // browser, so it carries its own opaque pair or it is unreadable in one
          // of the two themes.
          <option
            key={opt}
            value={opt}
            style={{ background: 'var(--surface, #101624)', color: 'var(--text-primary)' }}
          >
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'json') return <textarea {...shared} rows={3} aria-label={label} />;
  if (field.type === 'boolean') {
    return (
      <select {...shared} aria-label={label}>
        <option value="" style={{ background: 'var(--surface, #101624)', color: 'var(--text-primary)' }}>—</option>
        <option value="true" style={{ background: 'var(--surface, #101624)', color: 'var(--text-primary)' }}>true</option>
        <option value="false" style={{ background: 'var(--surface, #101624)', color: 'var(--text-primary)' }}>false</option>
      </select>
    );
  }
  return (
    <input
      {...shared}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'datetime-local' : 'text'}
      aria-label={label}
    />
  );
}

export function EntityBrowser({ scope, locale = 'en' }: { scope: EntityScope; locale?: string }) {
  const t = useTranslations('kernel.entities');
  const [entities, setEntities] = useState<EntityDescriptor[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [page, setPage] = useState<EntityPage | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Only what a tenant may actually read is offered. The gate lives here, in
   *  the shared component, rather than in each caller. */
  const offered = useMemo(() => (entities ?? []).filter((e) => e.readable), [entities]);
  const current = useMemo(() => offered.find((e) => e.name === active) ?? null, [offered, active]);

  useEffect(() => {
    let live = true;
    setEntities(null);
    setActive(null);
    setPage(null);
    void getScopeEntities(scope)
      .then((list) => {
        if (!live) return;
        setEntities(list);
        setActive(list.find((e) => e.readable)?.name ?? null);
      })
      .catch(() => live && setEntities([]));
    return () => {
      live = false;
    };
  }, [scope]);

  const load = useCallback(async () => {
    if (!current) return;
    setError(null);
    try {
      setPage(await getEntityRows(scope, current.name, { limit: PAGE_SIZE, offset, q: query || undefined }));
    } catch {
      setPage({ rows: [], total: 0, limit: PAGE_SIZE, offset });
      setError(t('loadFailed'));
    }
  }, [scope, current, offset, query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new entity or a new search starts at the first page — paging into an
  // offset that belongs to the previous list is how an empty table appears full.
  useEffect(() => setOffset(0), [active, query]);

  const columns = useMemo(() => {
    if (!current) return [];
    const title = current.titleField;
    const ordered = [...current.fields].sort((a, b) => {
      const rank = (f: typeof a) => (f.name === 'id' ? 0 : f.name === title ? 1 : 2);
      return rank(a) - rank(b);
    });
    return ordered.slice(0, PREVIEW_COLUMNS);
  }, [current]);

  const idOf = (row: EntityRow) => String(row.id ?? '');

  const startCreate = () => {
    if (!current) return;
    setEditing(null);
    setDraft(Object.fromEntries(current.fields.filter((f) => f.writable).map((f) => [f.name, ''])));
  };

  const startEdit = (row: EntityRow) => {
    if (!current) return;
    setEditing(idOf(row));
    setDraft(
      Object.fromEntries(
        current.fields
          .filter((f) => f.writable)
          .map((f) => [f.name, row[f.name] === null || row[f.name] === undefined ? '' : String(row[f.name])]),
      ),
    );
  };

  /** Empty means "not supplied" on create and "leave alone" on edit — a generic
   *  form cannot tell an intentional blank from an untouched control, and
   *  clearing a column is the rarer of the two. */
  const body = (values: Record<string, string>): EntityRow =>
    Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));

  const save = async () => {
    if (!current || !draft) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) await updateEntityRow(scope, current.name, editing, body(draft));
      else await createEntityRow(scope, current.name, body(draft));
      setDraft(null);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const retire = async (row: EntityRow) => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await archiveEntityRow(scope, current.name, idOf(row));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (entities === null) {
    return (
      <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
        {t('loading')}
      </p>
    );
  }

  if (offered.length === 0) {
    return (
      <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
        {t('noEntities')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Wraps rather than scrolls: 46 entities on the Growth seat must not push
          the page sideways. */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('tabs')}>
        {offered.map((e) => {
          const selected = e.name === active;
          return (
            <button
              key={e.name}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(e.name)}
              className="rounded-full px-2.5 py-1 text-xs min-w-0"
              style={{
                background: selected ? 'var(--accent)' : 'var(--surface-2, rgba(255,255,255,0.06))',
                color: selected ? 'var(--text-on-accent, #fff)' : 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {e.name}
              <span className="ml-1.5 tabular-nums" style={{ opacity: 0.75 }}>
                {e.count.toLocaleString(locale)}
              </span>
            </button>
          );
        })}
      </div>

      {current && (
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={current.titleField ? t('searchBy', { field: current.titleField }) : t('searchDisabled')}
            disabled={!current.titleField}
            aria-label={t('search')}
            className="flex-1 min-w-[10rem] rounded px-2 py-1.5 text-sm"
            style={{
              background: 'var(--surface-2, rgba(255,255,255,0.06))',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          />
          {/* Decides its own visibility: no create button where the API would
              refuse the write anyway. */}
          {current.writable && (
            <button
              type="button"
              onClick={startCreate}
              className="rounded px-3 py-1.5 text-sm"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent, #fff)', border: 'none' }}
            >
              {t('new')}
            </button>
          )}
        </div>
      )}

      {current && !current.writable && (
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('readOnly')}
        </p>
      )}

      {current && current.redactedFields.length > 0 && (
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('withheld', { fields: current.redactedFields.join(', ') })}
        </p>
      )}

      {error && (
        <p className="m-0 text-xs" style={{ color: 'var(--danger, var(--error))' }} role="alert">
          {error}
        </p>
      )}

      {draft && current && (
        <form
          className="rounded-lg p-3 flex flex-col gap-2 min-w-0"
          style={surface}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {editing ? t('editing', { entity: current.name }) : t('creating', { entity: current.name })}
          </h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {current.fields
              .filter((f) => f.writable)
              .map((f) => (
                <label key={f.name} className="flex flex-col gap-1 min-w-0 text-xs" htmlFor={`entity-field-${f.name}`}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {f.name}
                    {f.required ? ' *' : ''}
                  </span>
                  <FieldInput
                    field={f}
                    label={f.name}
                    value={draft[f.name] ?? ''}
                    onChange={(next) => setDraft({ ...draft, [f.name]: next })}
                  />
                </label>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded px-3 py-1.5 text-sm"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent, #fff)', border: 'none' }}
            >
              {busy ? t('saving') : t('save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setEditing(null);
              }}
              className="rounded px-3 py-1.5 text-sm"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Wide tables scroll inside their own container — the page never does. */}
      <div className="overflow-x-auto rounded-lg" style={surface}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.name}
                  scope="col"
                  className="text-left px-3 py-2 text-[0.65rem] uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}
                >
                  {c.name}
                </th>
              ))}
              <th
                scope="col"
                className="text-right px-3 py-2 text-[0.65rem] uppercase tracking-wider"
                style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}
              >
                {t('actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {(page?.rows ?? []).map((row, i) => (
              <tr key={idOf(row) || i}>
                {columns.map((c) => (
                  <td
                    key={c.name}
                    className="px-3 py-2 max-w-[22rem] truncate"
                    style={{ color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)' }}
                    title={cellText(row[c.name])}
                  >
                    {cellText(row[c.name])}
                  </td>
                ))}
                <td
                  className="px-3 py-2 text-right whitespace-nowrap"
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                >
                  {current?.writable && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="text-xs mr-2"
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent)' }}
                      >
                        {t('edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void retire(row)}
                        disabled={busy}
                        className="text-xs"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
                      >
                        {t('retire')}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-4 text-center text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {page && page.total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded px-2 py-1"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {t('previous')}
          </button>
          <span className="tabular-nums">
            {t('range', {
              from: (page.total === 0 ? 0 : offset + 1).toLocaleString(locale),
              to: Math.min(offset + PAGE_SIZE, page.total).toLocaleString(locale),
              total: page.total.toLocaleString(locale),
            })}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= page.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded px-2 py-1"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {t('next')}
          </button>
        </div>
      )}
    </div>
  );
}
