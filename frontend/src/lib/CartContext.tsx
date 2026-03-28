'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PricingModel = 'flat_fee' | 'consumption';
export type ArtifactType = 'skill' | 'persona' | 'content' | 'agent';

export interface CartItem {
  id: string;              // unique key: `${type}:${slug}`
  type: ArtifactType;
  slug: string;
  name: string;
  price: number;           // USD; 0 = free
  pricingModel: PricingModel;
  priceUnit?: string;      // e.g. "per 1K tokens" for consumption
  emoji?: string;
  image?: string;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  subtotal: number;
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  hasItem: (id: string) => boolean;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const CartContext = createContext<CartContextValue | null>(null);

const CART_STORAGE_KEY = 'bf_marketplace_cart';

function loadCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => loadCart());
  const [isOpen, setIsOpen] = useState(false);

  // Persist to localStorage on change
  useEffect(() => {
    saveCart(items);
  }, [items]);

  const addItem = useCallback((item: CartItem) => {
    setItems((prev) => {
      if (prev.some((i) => i.id === item.id)) return prev; // no duplicates
      return [...prev, item];
    });
    setIsOpen(true);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const hasItem = useCallback((id: string) => items.some((i) => i.id === id), [items]);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const count = items.length;
  const subtotal = items.reduce((sum, i) => sum + i.price, 0);

  const value = useMemo<CartContextValue>(
    () => ({ items, count, subtotal, addItem, removeItem, clearCart, hasItem, isOpen, openCart, closeCart }),
    [items, count, subtotal, addItem, removeItem, clearCart, hasItem, isOpen, openCart, closeCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
