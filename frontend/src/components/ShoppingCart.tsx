'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useCart, type CartItem } from '@/lib/CartContext';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { useLocale, useTranslations } from 'next-intl';
import { AUTH_API_URL, getStoredTenantToken } from '@/lib/auth';
import {
  marketplacePurchaseApi,
  setMarketplaceToken,
  type MarketplacePurchase,
} from '@/lib/builderforceApi';

function formatPrice(item: CartItem, locale: string, freeLabel: string, useLabel: string): string {
  if (item.price === 0) return freeLabel;
  const dollars = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(item.price);
  if (item.pricingModel === 'consumption') {
    return `${dollars}${item.priceUnit ? ` / ${item.priceUnit}` : ` / ${useLabel}`}`;
  }
  return item.pricingModel === 'subscription' ? `${dollars}${item.priceUnit ?? ''}` : dollars;
}

function TypeBadge({ type }: { type: CartItem['type'] }) {
  const colors: Record<CartItem['type'], string> = {
    skill: 'var(--indigo-bright)',
    persona: 'var(--purple-bright)',
    content: 'var(--cyan-bright)',
    agent: 'var(--emerald-bright)',
    service: 'var(--coral-bright)',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: colors[type],
        color: 'var(--text-on-accent)',
      }}
    >
      {type}
    </span>
  );
}

export default function ShoppingCart() {
  const { items, count, subtotal, removeItem, clearCart, isOpen, closeCart } = useCart();
  const { isAuthenticated, tenant, user, webToken } = useAuth();
  const t = useTranslations('shoppingCart');
  const phoneT = useTranslations('pricing.phone');
  const phonePageT = useTranslations('phonePage');
  const locale = useLocale();
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Portal to <body> so the fixed drawer escapes ancestor stacking contexts.
  // ShoppingCart renders inside `.topbar`, which has both `z-index: 40` AND
  // `backdrop-filter: blur(12px)` — the latter makes the topbar the containing
  // block for fixed descendants, clamping the panel to the topbar's height.
  // (Same trap documented in SlideOutPanel.tsx.)
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (webToken) setMarketplaceToken(webToken);
  }, [webToken]);

  useEffect(() => {
    if (!isOpen || !isAuthenticated || !webToken) return;
    marketplacePurchaseApi.list().then(setPurchases).catch(() => setPurchases([]));
  }, [isOpen, isAuthenticated, webToken]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCart(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, closeCart]);

  // Trap body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const phoneItem = items.find((item) => item.checkoutKind === 'business_phone');
  const setupTotal = items.reduce((sum, item) => sum + (item.setupFee ?? 0), 0);
  const recurringTotal = items.filter((item) => item.pricingModel === 'subscription').reduce((sum, item) => sum + item.price, 0);
  const checkout = async () => {
    if (checkingOut) return;
    setCheckingOut(true); setCheckoutError(null); setCheckoutSuccess(null);
    try {
      const marketplaceItems = items.filter((item): item is CartItem & { type: 'skill' | 'persona' | 'content' } =>
        item.type === 'skill' || item.type === 'persona' || item.type === 'content');
      if (phoneItem && marketplaceItems.length > 0) throw new Error(t('mixedCheckout'));

      if (phoneItem) {
        if (!tenant?.id || !user?.email) throw new Error(t('workspaceRequired'));
        const token = getStoredTenantToken();
        const response = await fetch(`${AUTH_API_URL}/api/tenants/${tenant.id}/add-ons/business-phone/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ billingEmail: user.email }) });
        const body = await response.json() as { checkoutUrl?: string; error?: string };
        if (response.status === 403) throw new Error(phoneT('eligibility'));
        if (response.status === 409) throw new Error(phonePageT('active'));
        if (!response.ok || !body.checkoutUrl) throw new Error(t('checkoutFailed'));
        window.location.href = body.checkoutUrl;
        return;
      }

      if (marketplaceItems.length !== items.length || marketplaceItems.length === 0) {
        throw new Error(t('unsupportedCheckout'));
      }
      // Ask the server about paid items first. Until their provider payment has
      // been verified it returns 402, and no free item in the same cart is
      // accidentally recorded as a partial checkout.
      const checkoutItems = [...marketplaceItems].sort((a, b) => b.price - a.price);
      for (const item of checkoutItems) {
        await marketplacePurchaseApi.purchase({ artifactType: item.type, artifactSlug: item.slug });
      }
      const nextPurchases = await marketplacePurchaseApi.list();
      setPurchases(nextPurchases);
      clearCart();
      setCheckoutSuccess(t('purchaseComplete', { count: marketplaceItems.length }));
      setCheckingOut(false);
    } catch (error) { setCheckoutError(error instanceof Error ? error.message : t('checkoutFailed')); setCheckingOut(false); }
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={closeCart}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 9998,
          backdropFilter: 'blur(2px)',
        }}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('title')}
        aria-modal="true"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(420px, 100vw)',
          background: 'var(--bg-elevated)',
          borderLeft: '1px solid var(--border, rgba(255,255,255,0.1))',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{t('title')}</span>
            {count > 0 && (
              <span style={{ background: 'var(--accent)', color: 'var(--text-on-accent)', borderRadius: 'var(--radius-lg)', padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>
                {count}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeCart}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
            aria-label={t('close')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: 48 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 12 }}>
                <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <p style={{ fontSize: 14 }}>{t('empty')}</p>
              <Link
                href="/marketplace"
                onClick={closeCart}
                style={{ display: 'inline-block', marginTop: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text)', padding: '8px 16px', fontSize: 13, textDecoration: 'none' }}
              >
                {t('browse')}
              </Link>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: 12,
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--bg-base, rgba(255,255,255,0.03))',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 28, flexShrink: 0, width: 40, textAlign: 'center' }}>
                    <Icon source={item.emoji ?? (item.type === 'skill' ? 'settings' : item.type === 'persona' ? 'brain' : item.type === 'agent' ? 'person' : 'document')} size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      <TypeBadge type={item.type} />
                    </div>
                    <div style={{ fontSize: 13, color: item.price === 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {formatPrice(item, locale, t('free'), t('use'))}
                      {item.setupFee != null && <div style={{ fontSize: 11, fontWeight: 400 }}>{t('plusActivation', { price: item.setupFee })}</div>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                    aria-label={t('remove', { name: item.name })}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {checkoutSuccess && <p role="status" style={{ color: 'var(--success-text)', fontSize: 13 }}>{checkoutSuccess}</p>}
          {isAuthenticated && purchases.length > 0 && (
            <section style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }} aria-labelledby="cart-purchase-history">
              <h2 id="cart-purchase-history" style={{ margin: '0 0 10px', fontSize: 14 }}>{t('purchaseHistory')}</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {purchases.slice(0, 20).map((purchase) => (
                  <li key={purchase.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{purchase.artifactSlug}</span>
                    <span style={{ flexShrink: 0 }}>{purchase.priceCents === 0 ? t('free') : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(purchase.priceCents / 100)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, fontSize: 15, fontWeight: 700 }}>
              <span>{t('dueToday')}</span>
              <span>{subtotal + setupTotal === 0 ? t('free') : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(subtotal + setupTotal)}</span>
            </div>
            {recurringTotal > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, fontSize: 13, color: 'var(--text-muted)' }}><span>{t('thenMonthly')}</span><span>{new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(recurringTotal)}</span></div>}

            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  onClick={checkout}
                  disabled={checkingOut}
                  style={{
                    width: '100%',
                    padding: '12px 0',
                    borderRadius: 'var(--radius-lg)',
                    border: 'none',
                    background: 'linear-gradient(135deg, var(--indigo-bright), var(--purple-bright))',
                    color: 'var(--text-on-accent)',
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: 'pointer',
                    marginBottom: 8,
                  }}
                >
                  {checkingOut ? t('redirecting') : t('checkout')}
                </button>
                {checkoutError && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 12 }}>{checkoutError}</p>}
                <button
                  type="button"
                  onClick={clearCart}
                  style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: '4px 0' }}
                >
                  {t('clear')}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  {t('signInPrompt')}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link
                    href="/register"
                    onClick={closeCart}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '10px 0',
                      borderRadius: 'var(--radius-md)',
                      background: 'linear-gradient(135deg, var(--indigo-bright), var(--purple-bright))',
                      color: 'var(--text-on-accent)',
                      fontWeight: 600,
                      fontSize: 13,
                      textDecoration: 'none',
                    }}
                  >
                    {t('createAccount')}
                  </Link>
                  <Link
                    href="/login"
                    onClick={closeCart}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '10px 0',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      fontWeight: 600,
                      fontSize: 13,
                      textDecoration: 'none',
                    }}
                  >
                    {t('signIn')}
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
