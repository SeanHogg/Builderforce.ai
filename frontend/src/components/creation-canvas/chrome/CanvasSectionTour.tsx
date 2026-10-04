import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SectionTour, type SectionTourStep } from '@/components/onboarding/SectionTour';
import type { useSectionTour } from '@/components/onboarding/useSectionTour';

/** What each of the six steps points at, in order. */
const TOUR_TARGETS = [
  '[data-tour="creation-brain-dock"]',
  '[data-tour="creation-object-palette"]',
  '[data-tour="creation-board"]',
  '[data-tour="creation-board"]',
  '[data-tour="creation-collaborators"]',
  '[data-tour="creation-share"]',
] as const;

export interface CanvasSectionTourProps {
  tour: ReturnType<typeof useSectionTour>;
  /** Clear the chrome a step needs out of the way, or open what it points at. */
  onStepChange: (step: number) => void;
}

/** The tour that teaches the CANVAS — dock, palette, Share — offered on somebody's first board. */
export function CanvasSectionTour({ tour, onStepChange }: CanvasSectionTourProps) {
  const t = useTranslations('creationCanvas');
  const tourSteps = useMemo<SectionTourStep[]>(() => TOUR_TARGETS.map((target, index) => ({
    title: t(`tourTitle${index + 1}` as 'tourTitle1'),
    body: t(`tourBody${index + 1}` as 'tourBody1'),
    target,
  })), [t]);
  return <SectionTour
        phase={tour.phase}
        step={tour.step}
        steps={tourSteps}
        label={t('tourLabel')}
        offerTitle={t('tourOfferTitle')}
        offerBody={t('tourOfferBody')}
        startLabel={t('tourStart')}
        cancelLabel={t('tourCancel')}
        closeLabel={t('tourClose')}
        backLabel={t('back')}
        nextLabel={t('next')}
        finishLabel={t('startCreating')}
        stepLabel={(current) => t('tourStep', { step: current })}
        onStart={tour.start}
        onCancel={tour.cancel}
        onNext={() => tour.next(tourSteps.length)}
        onBack={tour.back}
        onStepChange={onStepChange}
      />;
}
