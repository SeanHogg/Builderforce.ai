'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useDestinations } from '@/lib/destinations/useDestinations';
import { rankDestinations, type RankedDestination } from '@/lib/destinations/registry';
import styles from './CommandPalette.module.css';

/**
 * Search-first navigation — the door that scales.
 *
 * Menu-browsing is fine at 78 destinations and unusable at the scale the
 * consolidation programs bring, so this reads the shared destination registry
 * and ranks it against what the person types. It is deliberately the SAME list
 * the rail and the Brain use: a destination that exists is findable here, and a
 * destination this account may not reach is absent from all three.
 *
 * Keyboard is the point — ⌘K / Ctrl+K anywhere, arrows to move, Enter to open,
 * Escape to leave — but every row is also a 44px tap target, because on a phone
 * this is still the fastest way to a named destination.
 */
export function CommandPalette() {
  const t = useTranslations('nav');
  const tp = useTranslations('commandPalette');
  const router = useRouter();
  const { hasTenant } = useAuth();
  const destinations = useDestinations();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // A missing `nav` key must not blank the palette — fall back to the key itself
  // so a newly registered destination is still findable before its copy lands.
  const translate = useCallback((key: string): string => {
    try { return t(key); } catch { return key.split('.').at(-1) ?? key; }
  }, [t]);

  const results = useMemo(
    () => rankDestinations(destinations, query, translate),
    [destinations, query, translate],
  );

  const close = useCallback(() => { setOpen(false); setQuery(''); setCursor(0); }, []);

  const openDestination = useCallback((destination: RankedDestination) => {
    close();
    router.push(destination.href);
  }, [close, router]);

  // Global shortcut. Bound at the document so it works whatever has focus, but
  // it yields to a text field the person is already typing in — stealing ⌘K from
  // an editor would be worse than not having the shortcut.
  useEffect(() => {
    if (!hasTenant) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasTenant]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setCursor(0); }, [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => (results.length ? (c + 1) % results.length : 0)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0)); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[cursor];
      if (chosen) openDestination(chosen);
    }
  };

  if (!hasTenant) return null;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label={tp('openAria')}
        title={tp('openAria')}
      >
        <span aria-hidden="true">⌕</span>
        <span>{tp('trigger')}</span>
      </button>

      {open && (
        <div
          className={styles.overlay}
          role="presentation"
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the dialog owns the arrow/Enter/Escape keymap for the list it labels. */}
          <div className={styles.panel} role="dialog" aria-modal="true" aria-label={tp('title')} onKeyDown={onKeyDown}>
            <div className={styles.inputRow}>
              <span className={styles.inputIcon} aria-hidden="true">⌕</span>
              <input
                ref={inputRef}
                type="text"
                className={styles.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tp('placeholder')}
                aria-label={tp('placeholder')}
                aria-controls="command-palette-results"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className={styles.results} id="command-palette-results" role="listbox" aria-label={tp('title')} ref={listRef}>
              {results.map((destination, index) => {
                const isFirstOfGroup = index === 0 || results[index - 1]?.groupLabel !== destination.groupLabel;
                return (
                  <div key={destination.id}>
                    {isFirstOfGroup && <div className={styles.group}>{destination.groupLabel}</div>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === cursor}
                      data-active={index === cursor}
                      className={styles.row}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => openDestination(destination)}
                    >
                      <span className={styles.rowIcon} aria-hidden="true">{destination.icon}</span>
                      <span className={styles.rowLabel}>{destination.label}</span>
                      <span className={styles.rowPath}>{destination.href}</span>
                    </button>
                  </div>
                );
              })}
              {results.length === 0 && <p className={styles.empty}>{tp('noResults', { query })}</p>}
            </div>

            <div className={styles.foot}>
              <span>{tp.rich('hintMove', { kbd: (chunks) => <kbd>{chunks}</kbd> })}</span>
              <span>{tp.rich('hintOpen', { kbd: (chunks) => <kbd>{chunks}</kbd> })}</span>
              <span>{tp.rich('hintClose', { kbd: (chunks) => <kbd>{chunks}</kbd> })}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
