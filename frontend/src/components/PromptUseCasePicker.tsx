'use client';

/**
 * The starting-point picker under the prompt bar.
 *
 * It used to own a catalogue: it merged the localized `promptUseCases.items`
 * with the 48 hard-coded executive intents and rendered the result — while the
 * canvas kept a SECOND browser over the object packs, and the installable
 * templates had no surface here at all. Somebody looking for "email campaign"
 * therefore found a canvas prompt in this menu and a working Mailchimp
 * automation in a different one, with nothing to tell them the other existed.
 *
 * Now it renders `lib/templates/catalog` and owns nothing. Every source appears
 * in one list, one search box covers all of them, and selecting an entry is
 * dispatched by `useTemplateApply` on the entry's own action — so an installable
 * template opens its guided setup from the same menu that seeds a prompt.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './PromptUseCasePicker.module.css';
import { Icon } from '@/components/ui/Icon';
import { groupTemplates, matchesTemplateQuery, type TemplateEntry } from '@/lib/templates/contract';
import { useTemplateCatalog } from '@/lib/templates/useTemplateCatalog';

export function PromptUseCasePicker({ placement, align = 'center', onSelect }: {
  placement: 'top' | 'bottom';
  align?: 'center' | 'end';
  /** Called with the entry the person picked. The caller decides what to do
   *  with it — the canvas applies packs in place, the landing hero only ever
   *  seeds a prompt — which is why this hands over the ENTRY and not a string. */
  onSelect: (entry: TemplateEntry) => void;
}) {
  const t = useTranslations('promptUseCases');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // The installable half of the catalogue is fetched only once the menu has
  // been opened: a signed-out visitor on the landing canvas never opens it, and
  // must not pay for a workspace call that would 401.
  const entries = useTemplateCatalog({ includeWorkspace: open });

  const groups = useMemo(
    () => groupTemplates(entries.filter((entry) => matchesTemplateQuery(entry, query))),
    [entries, query],
  );

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
          {groups.map(([category, items]) => (
            <section key={category} className={styles.group}>
              <div className={styles.category}>{items[0]?.categoryLabel ?? category}</div>
              <div className={styles.grid}>
                {items.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={styles.item}
                    tabIndex={open ? 0 : -1}
                    title={entry.summary}
                    onClick={() => { onSelect(entry); setOpen(false); setQuery(''); }}
                  >
                    <span className={styles.icon} aria-hidden="true"><Icon source={entry.icon} size={18} /></span>
                    <span>{entry.name}</span>
                    {/* An installable entry says so, because pressing it opens a
                        setup rather than filling the composer — a difference the
                        person deserves to know BEFORE they press it. */}
                    {entry.action.kind === 'install' && (
                      <em className={styles.badge}>{t('setupSteps', { count: entry.action.stepCount })}</em>
                    )}
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

  return <div ref={rootRef} className={styles.root} data-open={open ? 'true' : 'false'} data-placement={placement} data-align={align}>{placement === 'top' ? <>{panel}{tab}</> : <>{tab}{panel}</>}</div>;
}
