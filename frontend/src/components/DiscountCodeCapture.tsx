'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { retainDiscountCode } from '@/lib/discountCode';

/** Captures ?discountcode= from every route before signup/checkout navigation. */
export function DiscountCodeCapture() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const code = searchParams.get('discountcode');
    if (code?.trim()) retainDiscountCode(code);
  }, [searchParams]);
  return null;
}
