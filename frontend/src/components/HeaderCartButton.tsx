'use client';

import { useTranslations } from 'next-intl';
import { useCart } from '@/lib/CartContext';
import ShoppingCart from './ShoppingCart';

/** One cart trigger for both the signed-in top bar and the public header. */
export function HeaderCartButton({ className }: { className?: string }) {
  const { count, openCart } = useCart();
  const t = useTranslations('topbar');

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={openCart}
        title={t('cart')}
        aria-label={count > 0 ? t('cartWithCount', { count }) : t('cart')}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 6,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -1, right: -2, minWidth: 16, height: 16,
            borderRadius: 'var(--radius-full)', background: 'var(--indigo-bright)',
            color: 'var(--text-on-accent)', fontSize: 'var(--font-size-field-label)',
            fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      <ShoppingCart />
    </>
  );
}
