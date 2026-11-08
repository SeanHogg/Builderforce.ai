import { useTranslations } from 'next-intl';
import styles from '../styles/bodies.module.css';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { Icon } from '@/components/ui/Icon';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
import type { CreationBodyProps } from './types';
import { textValue, AuthoredContent } from './shared';
import { AuthedImg } from '../creative/AuthedMedia';

/** The `template` card: a catalog entry's studio, template and output at a glance. */
export function CreativeStudioBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const mediaKind = textValue(data.mediaKind, data.kind);
  const template = textValue(data.templateId, t('browseCatalog'));
  const output = textValue(data.outputFormat, t('chooseOnExport'));
  const thumbnail = creativePreviewImageUrl(data);
  return <div className={styles.creativeStudioBody}>
    {thumbnail ? <AuthedImg src={thumbnail} alt={t('previewAlt', { title: data.title })} width={240} height={118} /> :<div className={styles.creativeStudioPreview} aria-hidden="true"><span><Icon source={creationObjectDefinition(data.kind).icon} size={24} /></span><i /><i /><i /></div>}
    <AuthoredContent data={data} fallback={t('creativeFallback')} />
    <div className={styles.widgetSettings}>
      <span><small>{t('studio')}</small><b>{mediaKind}</b></span>
      <span><small>{t('template')}</small><b>{template.replaceAll('_', ' ')}</b></span>
      <span><small>{t('output')}</small><b>{output}</b></span>
    </div>
    <div className={styles.pills}><span>{textValue(data.capabilityId, `creative.${data.kind}`)}</span><span>{`MCP · ${textValue(data.mcpServer, 'builtin')}`}</span></div>
  </div>;
}
