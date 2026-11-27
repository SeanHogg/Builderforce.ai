import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { PROJECT_TYPES } from '@builderforce/ide-templates/project-types';

export function useCanvasProjectStarters() {
  const t = useTranslations();
  return useMemo(() => PROJECT_TYPES.flatMap(({ id, labelKey, descriptionKey, canvasStarter }) => canvasStarter ? [{
    id,
    label: t(labelKey),
    tagline: t(descriptionKey),
    ...canvasStarter,
  }] : []), [t]);
}
