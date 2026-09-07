'use client';

/**
 * THE account control — the avatar in the top-right corner, and everything the
 * signed-in chrome used to spread across six buttons beside it.
 *
 * The badge on the avatar is the SUM of what is waiting (alerts + messages +
 * cart), so a person sees there is something for them without having to read a
 * row of icons; opening the menu breaks that number back down per row. The
 * chevron is there because an avatar alone reads as a picture, not a control.
 *
 * Self-gating (`useAccountMenu` returns null signed out) and layout-agnostic:
 * it owns its own open state, its own outside-click and Escape handling, and its
 * own popover, so it can be dropped into a second header with no edits.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AvatarFace } from '@/components/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useAccountMenu, type AccountMenuRow } from './useAccountMenu';

function RowBody({ row }: { row: AccountMenuRow }) {
  return (
    <>
      <Icon name={row.icon} size={17} className="ui-icon account-menu__row-icon" />
      <span className="account-menu__row-label">{row.label}</span>
      {row.hint && <span className="account-menu__row-hint">{row.hint}</span>}
      {row.count != null && (
        <span className="account-menu__row-count">{row.count > 99 ? '99+' : row.count}</span>
      )}
    </>
  );
}

export function AccountMenu() {
  const t = useTranslations('accountMenu');
  const menu = useAccountMenu();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!menu) return null;

  const label = menu.totalCount > 0
    ? t('openWithCount', { name: menu.name, count: menu.totalCount })
    : t('open', { name: menu.name });

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu__trigger"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* `active` gives the face its deterministic colour rather than the
            elevated-surface fill — the menu it opens onto IS that surface, so an
            unfilled face would vanish into it. */}
        <AvatarFace
          name={menu.name}
          imageUrl={menu.imageUrl}
          count={menu.totalCount > 0 ? menu.totalCount : undefined}
          size={30}
          active
        />
        <Icon name="chevron-down" size={14} className="ui-icon account-menu__chevron" />
      </button>

      {open && (
        <div className="account-menu__popover" role="menu" aria-label={t('menuLabel')}>
          <div className="account-menu__identity">
            <AvatarFace name={menu.name} imageUrl={menu.imageUrl} size={36} active />
            <span className="account-menu__identity-text">
              <strong>{menu.name}</strong>
              <span>{menu.email}</span>
            </span>
          </div>

          {menu.sections.map((section) => (
            <div key={section.id} className="account-menu__section">
              {section.rows.map((row) => (row.href ? (
                <Link
                  key={row.id}
                  href={row.href}
                  role="menuitem"
                  className="account-menu__row"
                  onClick={() => setOpen(false)}
                >
                  <RowBody row={row} />
                </Link>
              ) : (
                <button
                  key={row.id}
                  type="button"
                  role="menuitem"
                  className={`account-menu__row${row.tone === 'danger' ? ' account-menu__row--danger' : ''}`}
                  onClick={() => {
                    row.onSelect?.();
                    if (!row.keepsMenuOpen) setOpen(false);
                  }}
                >
                  <RowBody row={row} />
                </button>
              )))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
