/** The one loading / failed line a panel kind shows before its data arrives. */

import { useTranslations } from 'next-intl';

export function PanelPending({ loading, error }: { loading: boolean; error: string }) {
  const t = useTranslations('insights.panel');
  if (error) return <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('loadFailed')} {error}</p>;
  return loading ? <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p> : null;
}
