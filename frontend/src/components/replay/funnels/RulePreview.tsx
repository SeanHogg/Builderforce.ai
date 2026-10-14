/** "≈ N recordings match" under a rule being typed (`useSmartEventPreview`). */

import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { SmartEventDraft } from './funnelLevel';
import { useSmartEventPreview } from './useSmartEventPreview';

export function RulePreview({ siteId, days, rule }: { siteId: string; days: number; rule: SmartEventDraft | null }) {
  const t = useTranslations('replay.smartEvents.preview');
  const fmt = useFormat();
  const preview = useSmartEventPreview(siteId, days, rule);
  const style = { margin: 0, fontSize: 'var(--font-size-small)', color: preview.invalid ? 'var(--error)' : 'var(--text-secondary)' } as const;
  let text = t('idle');
  if (preview.loading) text = t('checking');
  else if (preview.invalid) text = t('invalid');
  else if (preview.count != null) text = t('count', { count: preview.count, value: fmt.number(preview.count), days });
  return <p role="status" aria-live="polite" style={style}>{text}</p>;
}
