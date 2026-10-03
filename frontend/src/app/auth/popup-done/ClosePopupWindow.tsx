'use client';

import { useEffect } from 'react';

/** Closes the sign-in pop-up it renders in. Renders nothing. */
export function ClosePopupWindow() {
  useEffect(() => {
    window.close();
  }, []);
  return null;
}
