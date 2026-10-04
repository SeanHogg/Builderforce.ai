import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { Icon } from '@/components/ui/Icon';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
import type { CreationObjectKind } from '../types';
import type { CreationBodyProps } from './types';
import { textValue, AuthoredContent } from './shared';

// `game` is deliberately absent: a game is the one creative kind whose artifact
// can be USED in place, so it gets a body that plays it rather than a tile that
// describes it. See GameBody.
export const CREATIVE_STUDIO_KINDS: ReadonlySet<CreationObjectKind> = new Set(['image', 'animation', 'podcast', 'comic', 'cad', 'model3d', 'template']);

export function CreativeStudioBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const mediaKind = textValue(data.mediaKind, data.kind === 'model3d' ? 'cad_3d' : data.kind);
  const template = textValue(data.templateId, data.kind === 'template' ? t('browseCatalog') : t('blankCanvas'));
  const output = textValue(data.outputFormat, data.kind === 'resume' ? 'PDF / DOCX' : t('chooseOnExport'));
  const thumbnail = creativePreviewImageUrl(data);
  return <div className={styles.creativeStudioBody}>
    {thumbnail ? <img src={thumbnail} alt={t('previewAlt', { title: data.title })} width={240} height={118} /> :<div className={styles.creativeStudioPreview} aria-hidden="true"><span><Icon source={creationObjectDefinition(data.kind).icon} size={24} /></span><i /><i /><i /></div>}
    <AuthoredContent data={data} fallback={t('creativeFallback')} />
    <div className={styles.widgetSettings}>
      <span><small>{t('studio')}</small><b>{mediaKind.replaceAll('_', ' ')}</b></span>
      <span><small>{t('template')}</small><b>{template.replaceAll('_', ' ')}</b></span>
      <span><small>{t('output')}</small><b>{output}</b></span>
    </div>
    <div className={styles.pills}><span>{textValue(data.capabilityId, `creative.${data.kind}`)}</span><span>{`MCP · ${textValue(data.mcpServer, 'builtin')}`}</span></div>
  </div>;
}
