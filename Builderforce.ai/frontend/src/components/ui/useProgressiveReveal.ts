'use client';

import { useContext } from 'react';
import { ProgressiveRevealContext } from './ProgressiveRevealContext';

/**
 * Hook to safely access progressive reveal state.
 * Throws an error if used outside of a ProgressiveRevealOrchestrator.
 */
export function useProgressiveReveal() {
  const ctx = useContext(ProgressiveRevealContext);
  if (!ctx) {
    throw new Error('useProgressiveReveal must be used within a ProgressiveRevealOrchestrator');
  }
  return ctx;
}