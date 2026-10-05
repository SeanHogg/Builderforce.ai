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
 *
 * ── TWO PIECES ───────────────────────────────────────────────────────────────
 * `PromptUseCaseCatalog` is the list itself (search, groups, entries) and holds no
 * open state. `PromptUseCasePicker` is the catalog plus its own tab and dismissal,
 * for a host that has nowhere better to put the trigger (the landing hero). The
 * canvas composer composes the catalog directly: its trigger sits in the composer
 * card's top row and the list opens INSIDE that card, so the two are siblings in a
 * shared container rather than a tab hanging off a floating popover.
 */

import { useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './PromptUseCasePicker.module.css';
import { Icon } from '@/components/ui/Icon';
import { groupTemplates, matchesTemplateQuery, type TemplateEntry } from '@/lib/templates/contract';
import { useTemplateCatalog } from '@/lib/templates/useTemplateCatalog';
import { useDismissOnOutsidePress } from '@/lib/useDismissable';

export interface PromptUseCaseCatalogProps {
  open: boolean;
  /** The id the trigger's `aria-controls` names. */
  id: string;
  /**
   * `popover` floats off its tab (above or below it); `inline` is in normal flow inside
   * whatever box the host gives it — the canvas composer card.
   */
  variant: 'popover' | 'inline';
  /** Placement class from the host — the composer card's grid area, for one. */
  className?: string;
  /** Called with the entry the person picked. The caller closes the list. */
  onSelect: (entry: TemplateEntry) => void;
}

/** The searchable catalogue of starting points. Holds its query, never its open state. */
export function PromptUseCaseCatalog({ open, id, variant, className, onSelect }: PromptUseCaseCatalogProps) {
  const t = useTranslations('promptUseCases');
  const [query, setQuery] = useState('');

  // The installable half of the catalogue is fetched only once the list has
  // been opened: a signed-out visitor on the landing canvas never opens it, and
  // must not pay for a workspace call that would 401.
  const entries = useTemplateCatalog({ includeWorkspace: open });

  const groups = useMemo(
    () => groupTemplates(entries.filter((entry) => matchesTemplateQuery(entry, query))),
    [entries, query],
  );

  return (
    <div className={className ? `${styles.reveal} ${className}` : styles.reveal} data-open={open ? 'true' : 'false'} data-variant={variant}>
      <div id={id} className={styles.panel} aria-hidden={!open}>
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
                    onClick={() => { onSelect(entry); setQuery(''); }}
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
}

/** The catalogue with its own tab, opening BELOW it — for a host whose prompt has
 *  nowhere better to put the trigger (the landing hero). */
export function PromptUseCasePicker({ onSelect }: {
  /** Called with the entry the person picked. The caller decides what to do
   *  with it — the canvas applies packs in place, the landing hero only ever
   *  seeds a prompt — which is why this hands over the ENTRY and not a string. */
  onSelect: (entry: TemplateEntry) => void;
}) {
  const t = useTranslations('promptUseCases');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useDismissOnOutsidePress(rootRef, open, () => setOpen(false));

  const tab = (
    <button type="button" className={styles.tab} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
      <span>{t('tabLabel')}</span>
      <span className={styles.arrow} aria-hidden="true">⌃</span>
    </button>
  );
  const panel = (
    <PromptUseCaseCatalog
      open={open}
      id={panelId}
      variant="popover"
      onSelect={(entry) => { onSelect(entry); setOpen(false); }}
    />
  );

  return <div ref={rootRef} className={styles.root} data-open={open ? 'true' : 'false'}>{tab}{panel}</div>;
}
