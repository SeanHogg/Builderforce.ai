import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { asRecord, AuthoredContent } from './shared';

/*
 * The one-line bodies: kinds whose whole card is a few elements and that never had a
 * component of their own. Each is a registry row like any other body, so none of them
 * is a branch in `CreationNode`.
 */

export function StaffBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  return <><div className={styles.personRow}><span className={styles.avatar} style={{ background: data.accent }}>{data.title.slice(0, 1)}</span><b>{data.role}</b><span className={styles.presence} /></div><small>{t('currentFocus')}</small><p>{data.focus}</p></>;
}

export function VoiceBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  return <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><AuthoredContent data={data} fallback={t('voiceFallback')} /></>;
}

export function NoteBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  return <AuthoredContent data={data} fallback={t('noteFallback')} />;
}

export function RoadmapBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  return <div className={styles.roadmap}>{(Array.isArray(data.items) && data.items.length ? data.items.slice(0, 12) : [{ title: 'Validate narrative', phase: 'Now' }, { title: 'Executive review', phase: 'Next' }, { title: 'Measure adoption', phase: 'Later' }]).map((raw, index) => { const item = asRecord(raw, { title: raw, phase: index < 2 ? 'Now' : 'Next' }); return <div key={`${String(item.title)}-${index}`}><b>{String(item.phase || item.status || t('phaseIndex', { index: index + 1 }))}</b><span>{String(item.title || item.name || t('itemIndex', { index: index + 1 }))}</span>{item.description ? <span>{String(item.description)}</span> : null}</div>; })}</div>;
}

export function MockupSetBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  return <><div className={styles.mockupGrid}><i /><i /><i /></div><p>{Array.isArray(data.items) && data.items.length ? t('linkedConcepts', { count: data.items.length }) : t('mockupSetFallback')}</p><div className={styles.pills}><span>{t('expandable')}</span><span>{t('citationsRetained')}</span></div></>;
}

export function FeatureSummaryBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  return <div className={styles.featureGrid}>{(Array.isArray(data.items) && data.items.length ? data.items.map((item) => typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || t('feature'))).slice(0, 20) : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration']).map((feature, index) => <span key={`${feature}-${index}`}><b>{index + 1}</b>{feature}</span>)}</div>;
}
