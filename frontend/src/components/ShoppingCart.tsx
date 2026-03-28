'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useCart, type CartItem } from '@/lib/CartContext';
import { useAuth } from '@/lib/AuthContext';

function formatPrice(item: CartItem): string {
  if (item.price === 0) return 'Free';
  const dollars = item.price.toFixed(2);
  if (item.pricingModel === 'consumption') {
    return `$${dollars}${item.priceUnit ? ` / ${item.priceUnit}` : ' / use'}`;
  }
  return `$${dollars}`;
}

function TypeBadge({ type }: { type: CartItem['type'] }) {
  const colors: Record<CartItem['type'], string> = {
    skill: '#6366f1',
    persona: '#8b5cf6',
    content: '#0891b2',
    agent: '#059669',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: colors[type],
        color: '#fff',
      }}
    >
      {type}
    </span>
  );
}

export default function ShoppingCart() {
  const { items, count, subtotal, removeItem, clearCart, isOpen, closeCart } = useCart();
  const { isAuthenticated } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);

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

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeCart}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
          backdropFilter: 'blur(2px)',
        }}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Shopping cart"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(420px, 100vw)',
          background: 'var(--bg-elevated, #1a1a2e)',
          borderLeft: '1px solid var(--border, rgba(255,255,255,0.1))',
          zIndex: 201,
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
            <span style={{ fontWeight: 700, fontSize: 16 }}>Cart</span>
            {count > 0 && (
              <span style={{ background: 'var(--accent, #6366f1)', color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>
                {count}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeCart}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
            aria-label="Close cart"
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
              <p style={{ fontSize: 14 }}>Your cart is empty</p>
              <button
                type="button"
                onClick={closeCart}
                style={{ marginTop: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}
              >
                Browse Marketplace
              </button>
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
                    borderRadius: 10,
                    background: 'var(--bg-base, rgba(255,255,255,0.03))',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 28, flexShrink: 0, width: 40, textAlign: 'center' }}>
                    {item.emoji ?? (item.type === 'skill' ? '⚙️' : item.type === 'persona' ? '🤖' : item.type === 'agent' ? '👤' : '📄')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      <TypeBadge type={item.type} />
                    </div>
                    <div style={{ fontSize: 13, color: item.price === 0 ? '#22c55e' : 'var(--text-muted)', fontWeight: 600 }}>
                      {formatPrice(item)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                    aria-label={`Remove ${item.name}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, fontSize: 15, fontWeight: 700 }}>
              <span>Subtotal</span>
              <span>{subtotal === 0 ? 'Free' : `$${subtotal.toFixed(2)}`}</span>
            </div>

            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '12px 0',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: 'pointer',
                    marginBottom: 8,
                  }}
                >
                  Checkout
                </button>
                <button
                  type="button"
                  onClick={clearCart}
                  style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: '4px 0' }}
                >
                  Clear cart
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Sign in to complete your purchase
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link
                    href="/register"
                    onClick={closeCart}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '10px 0',
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 13,
                      textDecoration: 'none',
                    }}
                  >
                    Create Account
                  </Link>
                  <Link
                    href="/login"
                    onClick={closeCart}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '10px 0',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      fontWeight: 600,
                      fontSize: 13,
                      textDecoration: 'none',
                    }}
                  >
                    Sign In
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
