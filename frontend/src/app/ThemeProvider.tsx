'use client';

import { useEffect } from 'react';
import { applyTheme, savedTheme } from '@/lib/theme';

/**
 * ThemeProvider — applies the saved theme immediately after hydration so the
 * page never flashes the wrong one. Renders nothing; the visible control is
 * `components/ThemeToggleButton`, dropped into each nav.
 */
export default function ThemeProvider() {
  useEffect(() => {
    applyTheme(savedTheme(), false);
  }, []);

  return null;
}
