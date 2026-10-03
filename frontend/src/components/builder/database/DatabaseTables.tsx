// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, SectionEmpty, SectionError, SectionLoading } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmProvider';
import { faultText } from '@/lib/apiClient';
import type { SiteCollection } from '@/lib/growthApi';
import { RecordsTable } from './RecordsTable';
import { useSiteTables } from './useSiteTables';

/**
 * The app's tables: one per collection a form (or the app) writes to. Pick a
 * table on the left, read and prune its rows on the right; the two stack on a
 * narrow pane.
 */
export function DatabaseTables({ projectId }: { projectId: number }) {
  const t = useTranslations('builderDatabase.tables');
  const forms = useTranslations('site.forms');
  const confirm = useConfirm();
  const tables = useSiteTables(projectId);
  const [failure, setFailure] = useState<string | null>(null);

  /** Every action reports the same way, so a new one is one call, not another try/catch. */
  const attempt = async (action: () => Promise<unknown>): Promise<boolean> => {
    setFailure(null);
    try { await action(); return true; } catch (cause) { setFailure(faultText(cause, forms('genericError'))); return false; }
  };

  if (tables.collections === null) {
    return tables.loadError ? <SectionError error={tables.loadError} /> : <SectionLoading label={t('loading')} />;
  }

  const { selected } = tables;

  const deleteTable = async (collection: SiteCollection) => {
    const ok = await confirm({ message: t('deleteConfirm', { name: collection.name, count: collection.recordCount }), confirmLabel: t('delete'), destructive: true });
    if (ok) await attempt(() => tables.removeCollection(collection.id));
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', minWidth: 0 }}>
      <nav aria-label={t('heading')} style={{ flex: '0 1 14rem', minWidth: 0, display: 'grid', gap: 8 }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {tables.collections.map((collection) => {
            const active = collection.id === selected?.id;
            return (
              <li key={collection.id}>
                <button type="button" onClick={() => tables.select(collection.id)} aria-current={active || undefined}
                  style={{
                    width: '100%', minHeight: 36, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', gap: 8,
                    borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${active ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                    background: active ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text-primary)',
                  }}>
                  <span style={{ overflowWrap: 'anywhere', fontWeight: 600 }}>{collection.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', whiteSpace: 'nowrap' }}>
                    {t('rows', { count: collection.recordCount })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <NewTableForm onCreate={(name) => attempt(() => tables.create(name))} />
      </nav>

      <section style={{ flex: '1 1 20rem', minWidth: 0, display: 'grid', gap: 12 }}>
        {failure && <p role="alert" style={{ margin: 0, color: 'var(--error-text)', fontSize: 'var(--font-size-small)' }}>{failure}</p>}
        {!selected ? (
          <SectionEmpty message={tables.collections.length ? t('pick') : t('empty')} />
        ) : (
          <>
            <TableSettings collection={selected} onPatch={(change) => attempt(() => tables.patch(selected.id, change))} onDelete={() => deleteTable(selected)} />
            {tables.records === null ? (
              <SectionLoading label={t('loading')} />
            ) : tables.records.length === 0 ? (
              <SectionEmpty message={forms('noSubmissions')} />
            ) : (
              <RecordsTable
                records={tables.records}
                hasMore={tables.hasMore}
                onLoadMore={() => attempt(tables.loadMore)}
                onDelete={(record) => {
                  void (async () => {
                    const ok = await confirm({ message: t('deleteRowConfirm'), confirmLabel: t('deleteRow'), destructive: true });
                    if (ok) await attempt(() => tables.removeRecord(record.id));
                  })();
                }}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** The selected table's endpoint and switches, plus its delete. */
function TableSettings({ collection, onPatch, onDelete }: {
  collection: SiteCollection;
  onPatch: (change: Parameters<ReturnType<typeof useSiteTables>['patch']>[1]) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations('builderDatabase.tables');
  const forms = useTranslations('site.forms');
  const [busy, setBusy] = useState(false);
  const toggle = async (change: Parameters<typeof onPatch>[0]) => {
    setBusy(true);
    try { await onPatch(change); } finally { setBusy(false); }
  };

  const switches: Array<{ key: string; checked: boolean; label: string; hint: string; change: Parameters<typeof onPatch>[0] }> = [
    { key: 'tickets', checked: collection.raisesTickets, label: forms('raisesTickets'), hint: forms('raisesTicketsHint'), change: { raisesTickets: !collection.raisesTickets } },
    { key: 'read', checked: collection.readPolicy === 'owner', label: forms('readPolicy'), hint: forms('readPolicyHint'), change: { readPolicy: collection.readPolicy === 'owner' ? 'none' : 'owner' } },
  ];

  return (
    <div style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{collection.name}</h3>
        <Button type="button" size="sm" variant="ghost" onClick={() => { void onDelete(); }}>{t('delete')}</Button>
      </div>
      <div style={{ display: 'grid', gap: 2 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{forms('endpoint')}</span>
        <code style={{ display: 'block', overflowX: 'auto', whiteSpace: 'nowrap', padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-deep)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>
          {`POST ${collection.endpoint}`}
        </code>
      </div>
      {switches.map((s) => (
        <label key={s.key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', alignItems: 'start', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>
          <input type="checkbox" checked={s.checked} disabled={busy} onChange={() => { void toggle(s.change); }} style={{ marginTop: 3 }} />
          <span>{s.label}</span>
          <span style={{ gridColumn: 2, color: 'var(--text-muted)' }}>{s.hint}</span>
        </label>
      ))}
    </div>
  );
}

function NewTableForm({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const t = useTranslations('builderDatabase.tables');
  const id = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { if (await onCreate(name.trim())) setName(''); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={(e) => { void submit(e); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <label htmlFor={id} className="sr-only">{t('newLabel')}</label>
      <input id={id} className="ui-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newPlaceholder')}
        maxLength={64} style={{ flex: '1 1 8rem', minWidth: 0 }} />
      <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!name.trim()}>{t('add')}</Button>
    </form>
  );
}
