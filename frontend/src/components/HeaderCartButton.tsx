import { useTranslations } from 'next-intl';
import { useCart } from '@/lib/CartContext';
import { Icon } from '@/components/ui/Icon';
import ShoppingCart from './ShoppingCart';

/**
 * The cart trigger for the PUBLIC header. The signed-in top bar carries the same
 * cart as a row in the account menu instead, and mounts `<ShoppingCart />`
 * itself — the two shells never render together, so the drawer is still mounted
 * exactly once.
 */
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
        <Icon name="cart" size={19} />
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
