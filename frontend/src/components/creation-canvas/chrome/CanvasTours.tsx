import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SectionTour, type SectionTourStep } from '@/components/onboarding/SectionTour';
import type { useSectionTour } from '@/components/onboarding/useSectionTour';
import { CanvasWalkthrough } from '../CanvasWalkthrough';
import type { useCanvasFiles } from '../hooks/useCanvasFiles';

type Files = ReturnType<typeof useCanvasFiles>;

/** What each of the six steps points at, in order. */
const TOUR_TARGETS = [
  '[data-tour="creation-brain-dock"]',
  '[data-tour="creation-object-palette"]',
  '[data-tour="creation-board"]',
  '[data-tour="creation-board"]',
  '[data-tour="creation-collaborators"]',
  '[data-tour="creation-share"]',
] as const;

export interface CanvasToursProps {
  tour: ReturnType<typeof useSectionTour>;
  /** Clear the chrome a step needs out of the way, or open what it points at. */
  onStepChange: (step: number) => void;
  walkthroughRef: Files['walkthroughRef'];
  boardId: string;
  /** Whose "already seen" history applies — the signed-in user, a guest, or nobody yet. */
  audienceId: string | null;
  stops: Files['walkthroughStops'];
  busy: boolean;
  onReveal: (nodeId: string) => void;
}

/**
 * TWO TOURS, TWO SUBJECTS. The section tour teaches the CANVAS — dock, palette,
 * Share — and is offered on somebody's first board. The walkthrough walks what the
 * board CONTAINS, and is offered once per board that has enough on it to get
 * lost in. Neither is a place the other's steps should have been added to:
 * "where is the palette" and "what are these twenty-four things" are asked by
 * different people at different moments.
 */
export function CanvasTours({ tour, onStepChange, walkthroughRef, boardId, audienceId, stops, busy, onReveal }: CanvasToursProps) {
  const t = useTranslations('creationCanvas');
  const tourSteps = useMemo<SectionTourStep[]>(() => TOUR_TARGETS.map((target, index) => ({
    title: t(`tourTitle${index + 1}` as 'tourTitle1'),
    body: t(`tourBody${index + 1}` as 'tourBody1'),
    target,
  })), [t]);
  return <>
      <CanvasWalkthrough
        ref={walkthroughRef}
        boardId={boardId}
        audienceId={audienceId}
        stops={stops}
        busy={busy}
        onReveal={onReveal}
      />
      <SectionTour
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
      />
  </>;
}
