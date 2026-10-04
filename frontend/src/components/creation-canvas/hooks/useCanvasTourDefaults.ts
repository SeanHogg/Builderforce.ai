import { useCallback } from 'react';
import type { useTranslations } from 'next-intl';
import { type CanvasTourDesign, defaultCanvasTourDesign } from '@/lib/onboarding/canvasTourDesign';
import type { CreationNodeData } from '../types';

/** A new `guidedTour` object's starting design, in the board's language. */
export function useCanvasTourDefaults(t: ReturnType<typeof useTranslations<'creationCanvas'>>) {
  return useCallback((): Partial<CreationNodeData> => {
    const base = defaultCanvasTourDesign();
    const tour: CanvasTourDesign = {
      ...base,
      offerTitle: t('tourBuilder.defaultOfferTitle'),
      offerBody: t('tourBuilder.defaultOfferBody'),
      startLabel: t('tourBuilder.defaultStartLabel'),
      cancelLabel: t('tourBuilder.defaultCancelLabel'),
      steps: [
        { ...base.steps[0]!, title: t('tourBuilder.defaultStep1Title'), body: t('tourBuilder.defaultStep1Body') },
        { ...base.steps[1]!, title: t('tourBuilder.defaultStep2Title'), body: t('tourBuilder.defaultStep2Body') },
      ],
    };
    return { title: t('tourBuilder.defaultObjectTitle'), status: t('tourBuilder.draftSteps', { count: tour.steps.length }), tour };
  }, [t]);
}
