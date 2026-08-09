'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './PromptUseCasePicker.module.css';
import { Icon } from '@/components/ui/Icon';

type PromptUseCase = { category: string; label: string; prompt: string };

export function PromptUseCasePicker({ placement, onSelect }: {
  placement: 'top' | 'bottom';
  onSelect: (prompt: string) => void;
}) {
  const t = useTranslations('promptUseCases');
  // Some embedded/test translation adapters intentionally expose only the
  // string translator. Keep the prompt usable there even without rich arrays.
  const localizedItems = typeof t.raw === 'function' ? t.raw('items') : [];
  const items = Array.isArray(localizedItems) ? localizedItems as PromptUseCase[] : [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !normalizedQuery || `${item.label} ${t(`categories.${item.category}`)} ${item.prompt}`.toLocaleLowerCase().includes(normalizedQuery));
    return [...filtered.reduce((result, entry) => {
      const group = result.get(entry.item.category) ?? [];
      group.push(entry);
      result.set(entry.item.category, group);
      return result;
    }, new Map<string, Array<{ item: PromptUseCase; index: number }>>())];
  }, [items, query, t]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const tab = (
    <button type="button" className={styles.tab} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
      <span>{t('tabLabel')}</span>
      <span className={styles.arrow} aria-hidden="true">⌃</span>
    </button>
  );
  const panel = (
    <div className={styles.reveal} data-open={open ? 'true' : 'false'}>
      <div id={panelId} className={styles.panel} aria-hidden={!open}>
        <div className={styles.panelHeader}>
          <div className={styles.heading}>{t('heading')}</div>
          <input
            type="search"
            className={styles.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            tabIndex={open ? 0 : -1}
          />
        </div>
        <div className={styles.catalog}>
          {groups.map(([category, entries]) => (
            <section key={category} className={styles.group}>
              <div className={styles.category}>{t(`categories.${category}`)}</div>
              <div className={styles.grid}>
                {entries.map(({ item, index }) => (
                  <button key={item.label} type="button" className={styles.item} tabIndex={open ? 0 : -1} onClick={() => { onSelect(item.prompt); setOpen(false); setQuery(''); }}>
                    <span className={styles.icon} aria-hidden="true"><Icon source={USE_CASE_ICONS[index % USE_CASE_ICONS.length]} size={18} /></span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && <div className={styles.empty}>{t('noResults')}</div>}
        </div>
      </div>
    </div>
  );

  return <div ref={rootRef} className={styles.root} data-placement={placement}>{placement === 'top' ? <>{panel}{tab}</> : <>{tab}{panel}</>}</div>;
}

const USE_CASE_ICONS = ['□', '◎', '▶', '▣', '◇', '⌘', '◖', '✉', '▤', '▥', '↗', '✦', '🧠', '▷', '◉', '▦', '◆', '⌗', '⬡', '◈'];
