'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { trackActivity } from '@/lib/activity/tracker';
import { readSectionTourHistory, writeSectionTourHistory } from '@/lib/onboarding/browserSectionTourHistory';
import { registerSectionVisit, resolveSectionTour, type SectionTourHistory } from '@/lib/onboarding/sectionTourPolicy';

export type SectionTourPhase = 'idle' | 'offer' | 'active';
export type SectionTourExit = 'cancel' | 'close' | 'escape';

interface UseSectionTourOptions {
  sectionId: string;
  version: number;
  audienceId: string | null;
  enabled?: boolean;
  minimumVisits?: number;
  activity?: Record<string, unknown>;
}

export function useSectionTour({ sectionId, version, audienceId, enabled = true, minimumVisits = 1, activity = {} }: UseSectionTourOptions) {
  const [phase, setPhase] = useState<SectionTourPhase>('idle');
  const [step, setStep] = useState(0);
  const historyRef = useRef<SectionTourHistory | null>(null);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  const record = useCallback((kind: string, metadata: Record<string, unknown> = {}) => {
    trackActivity(kind, { metadata: { sectionId, tourVersion: version, ...activityRef.current, ...metadata } });
  }, [sectionId, version]);

  useEffect(() => {
    if (!enabled || !audienceId) return;
    const result = registerSectionVisit(readSectionTourHistory(sectionId, audienceId), { version, minimumVisits });
    historyRef.current = result.history;
    writeSectionTourHistory(sectionId, audienceId, result.history);
    record('onboarding_section_visited', { visit: result.history.visits });
    if (result.shouldOffer) {
      setPhase('offer');
      record('onboarding_tour_offer_shown', { visit: result.history.visits });
    }
  }, [audienceId, enabled, minimumVisits, record, sectionId, version]);

  const persistOutcome = useCallback((outcome: 'dismissed' | 'completed', lastStep?: number) => {
    if (!audienceId || !historyRef.current) return;
    const next = resolveSectionTour(historyRef.current, outcome, lastStep);
    historyRef.current = next;
    writeSectionTourHistory(sectionId, audienceId, next);
  }, [audienceId, sectionId]);

  const openOffer = useCallback(() => {
    setStep(0);
    setPhase('offer');
    record('onboarding_tour_offer_shown', { source: 'manual' });
  }, [record]);

  const start = useCallback(() => {
    setStep(0);
    setPhase('active');
    record('onboarding_tour_started');
    record('onboarding_tour_step_viewed', { step: 1 });
  }, [record]);

  const cancel = useCallback((reason: SectionTourExit) => {
    persistOutcome('dismissed', phase === 'active' ? step + 1 : undefined);
    setPhase('idle');
    record('onboarding_tour_cancelled', { reason, step: phase === 'active' ? step + 1 : 0 });
  }, [persistOutcome, phase, record, step]);

  const next = useCallback((totalSteps: number) => {
    if (step >= totalSteps - 1) {
      persistOutcome('completed', totalSteps);
      setPhase('idle');
      record('onboarding_tour_completed', { steps: totalSteps });
      return;
    }
    const nextStep = step + 1;
    setStep(nextStep);
    record('onboarding_tour_step_viewed', { step: nextStep + 1 });
  }, [persistOutcome, record, step]);

  const back = useCallback(() => setStep((current) => Math.max(0, current - 1)), []);

  return { phase, step, openOffer, start, cancel, next, back };
}
