import { useState, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { canvasTourDesignFromNode } from '@/lib/onboarding/canvasTourDesign';
import type { CreationBodyProps } from './types';

export function GuidedTourBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.tourBuilder');
  const tour = canvasTourDesignFromNode(data);
  const [previewStep, setPreviewStep] = useState(-1);
  const active = previewStep >= 0 ? tour.steps[previewStep] : null;
  const stop = (event: MouseEvent) => event.stopPropagation();
  return <div className={`${styles.tourDesign} nodrag nowheel`} onClick={stop}>
    <div className={styles.tourPreview} data-blur={tour.blurBackground ? 'true' : 'false'}>
      <div className={styles.tourPreviewChrome} aria-hidden><i /><i /><i /></div>
      <div className={styles.tourPreviewCard}>
        <button type="button" aria-label={t('closePreview')} onClick={() => setPreviewStep(-1)}>×</button>
        {active ? <>
          <small>{t('stepOf', { current: previewStep + 1, total: tour.steps.length })}</small>
          <strong>{active.title}</strong>
          <p>{active.body}</p>
          <span>{active.targetObjectId ? t('targetConnected') : t('targetNeeded')}</span>
          <div><button type="button" disabled={previewStep === 0} onClick={() => setPreviewStep((value) => Math.max(0, value - 1))}>{t('back')}</button><button type="button" onClick={() => setPreviewStep((value) => value >= tour.steps.length - 1 ? -1 : value + 1)}>{previewStep >= tour.steps.length - 1 ? t('finish') : t('next')}</button></div>
        </> : <>
          <small>{t('offer')}</small>
          <strong>{tour.offerTitle}</strong>
          <p>{tour.offerBody}</p>
          <div><button type="button">{tour.cancelLabel}</button><button type="button" onClick={() => setPreviewStep(0)}>{tour.startLabel}</button></div>
        </>}
      </div>
    </div>
    <div className={styles.tourDesignMeta}><span>{t('stepCount', { count: tour.steps.length })}</span><span>{t('visitCount', { count: tour.minimumVisits })}</span>{tour.escapeHatch && <span>{t('escapeEnabled')}</span>}</div>
  </div>;
}
