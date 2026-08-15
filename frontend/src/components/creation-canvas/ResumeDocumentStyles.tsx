'use client';

import { useEffect } from 'react';
import { RESUME_DOCUMENT_STYLES } from '@/lib/canvasResumeRenderer';

const STYLE_ELEMENT_ID = 'canvas-resume-document-styles';
let mounted = 0;

/**
 * The résumé document stylesheet, mounted ONCE for the whole page.
 *
 * It used to be an inline `<style>` next to every rendering: one per preview, one per
 * compare pane, and one per template thumbnail — thirteen copies of the same four
 * kilobytes inside a single open editor, multiplied again by every résumé card on the
 * board. Every copy is a stylesheet the browser parses and then re-matches against the
 * document on each mount, which is paid on the canvas exactly when the board is at its
 * busiest: right after a template fan-out drops ten résumés on it.
 *
 * The rules are global class selectors, so one copy styles every résumé on the page.
 * Reference-counted rather than mounted-and-left, so a board with no résumé on it does
 * not carry résumé CSS.
 */
export function ResumeDocumentStyles() {
  useEffect(() => {
    mounted += 1;
    if (!document.getElementById(STYLE_ELEMENT_ID)) {
      const element = document.createElement('style');
      element.id = STYLE_ELEMENT_ID;
      element.textContent = RESUME_DOCUMENT_STYLES;
      document.head.append(element);
    }
    return () => {
      mounted -= 1;
      if (mounted <= 0) document.getElementById(STYLE_ELEMENT_ID)?.remove();
    };
  }, []);
  return null;
}
