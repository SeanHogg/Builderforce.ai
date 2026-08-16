'use client';

/**
 * The template gallery — one grid, used by `/templates` and by the marketplace's
 * Templates chip.
 *
 * It renders `useTemplateCatalog`, the same merge the prompt picker reads, so a
 * template cannot appear in one surface and be missing from the other. The two
 * differ only in which entries they ask for: the picker shows everything,
 * because it is answering "what should we make?"; the gallery shows the
 * installable half, because it is answering "what can I set up and keep?".
 *
 * The number that matters on a card is `connectedCount / connectors.length`. It
 * is what decides whether somebody starts, so it is computed once on the server
 * and rendered here rather than derived per card from a prop-drilled set.
 *
 * DEEP LINKS OPEN THE WIZARD HERE. `/templates?open=<key>` is what the prompt
 * picker, the canvas and the landing hero link to when somebody presses an
 * installable entry on a surface that cannot run a guided setup itself. A
 * separate `/templates/<key>` route was the obvious alternative and the wrong
 * one: it would have been a second page rendering a second copy of the same
 * wizard, which is the shape this whole consolidation removed.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { useTemplateCatalog } from '@/lib/templates/useTemplateCatalog';
import { matchesTemplateQuery, type TemplateEntry } from '@/lib/templates/contract';
import { GuidedSetupPanel } from './GuidedSetupPanel';

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 18,
  textAlign: 'left',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  cursor: 'pointer',
  color: 'var(--text-primary)',
};

const searchStyle: React.CSSProperties = {
  flex: '1 1 220px',
  minWidth: 0,
  padding: '10px 12px',
  color: 'var(--text-primary)',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
};

const optionStyle: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)' };

function TemplateCard({ entry, onOpen }: { entry: TemplateEntry; onOpen: (entry: TemplateEntry) => void }) {
  const t = useTranslations('templates');
  const total = entry.connectors?.length ?? 0;
  const connected = entry.connectedCount ?? 0;
  const ready = total === 0 || connected === total;
  return (
    <button type="button" style={cardStyle} onClick={() => onOpen(entry)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span aria-hidden><Icon source={entry.icon} size={20} /></span>
        <h3 className="ui-text-card-title" style={{ margin: 0, flex: 1 }}>{entry.name}</h3>
      </div>
      <p className="ui-text-small" style={{ margin: 0, color: 'var(--text-secondary)' }}>{entry.summary}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
        <span className="ui-text-eyebrow" style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-interactive)' }}>
          {entry.categoryLabel}
        </span>
        {total > 0 && (
          <span className="ui-text-small" style={{ fontWeight: 600, color: ready ? 'var(--text-muted)' : 'var(--coral-bright)' }}>
            {ready ? t('allConnected') : t('connectedOf', { connected, total })}
          </span>
        )}
        {entry.action.kind === 'install' && (
          <span className="ui-text-small" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {t('setupSteps', { count: entry.action.stepCount })}
          </span>
        )}
      </div>
    </button>
  );
}

export function TemplateGallery({ search: externalSearch }: { search?: string }) {
  const t = useTranslations('templates');
  const entries = useTemplateCatalog({ workspaceOnly: true });
  const [ownSearch, setOwnSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<TemplateEntry | null>(null);
  const searchParams = useSearchParams();
  const openKey = searchParams.get('open');

  // The marketplace owns a shared search box; `/templates` renders its own.
  // Whichever is present is the one that filters — never both.
  const search = externalSearch ?? ownSearch;

  const categories = useMemo(
    () => [...new Set(entries.map((e) => e.category))].map((c) => ({
      value: c,
      label: entries.find((e) => e.category === c)?.categoryLabel ?? c,
    })),
    [entries],
  );

  // Resolve a deep link once the catalogue has arrived. Keyed on the entry so a
  // link to a template this workspace cannot see simply lands on the gallery
  // rather than opening an empty wizard.
  useEffect(() => {
    if (!openKey) return;
    const target = entries.find((e) => e.action.kind === 'install' && e.action.templateKey === openKey);
    if (target) setSelected(target);
  }, [openKey, entries]);

  const visible = useMemo(
    () => entries
      .filter((e) => category === 'all' || e.category === category)
      .filter((e) => matchesTemplateQuery(e, search)),
    [entries, category, search],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {externalSearch === undefined && (
          <input
            type="search"
            className="ui-text-body"
            style={searchStyle}
            value={ownSearch}
            onChange={(e) => setOwnSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
          />
        )}
        <select
          className="ui-text-body"
          style={{ ...searchStyle, flex: '0 1 200px' }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={t('filterCategory')}
        >
          <option value="all" style={optionStyle}>{t('allCategories')}</option>
          {categories.map((c) => <option key={c.value} value={c.value} style={optionStyle}>{c.label}</option>)}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="ui-text-small" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
          {t('empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((entry) => <TemplateCard key={entry.id} entry={entry} onOpen={setSelected} />)}
        </div>
      )}

      {selected?.action.kind === 'install' && (
        <GuidedSetupPanel
          templateKey={selected.action.templateKey}
          templateName={selected.name}
          open
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
