'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import PageContainer from '@/components/PageContainer';
import { Button, FieldFrame, PageHeader, SectionEmpty, SectionLoading } from '@/components/ui';
import { findActiveGroup } from '@/lib/navGroups';
import { kindLabelKey } from '@/lib/import-input-schema';
import { useImportKinds } from '@/lib/useImportKinds';
import GuidedWizard from './GuidedWizard';
import BulkImport from './BulkImport';
import { errorBanner, optionStyle } from './importStyles';

type ImportMode = 'guided' | 'bulk';

/**
 * Where cancelling lands: the destination that owns the /import tab (Insights,
 * whose lenses these records feed). Read from the registry rather than spelled
 * here, so moving the tab moves the way back.
 */
const IMPORT_HOME = findActiveGroup('/import')?.href ?? '/';

/**
 * /import — pick a record kind (the server's registry), then enter records one
 * at a time (guided) or from a file (bulk). Both halves post to the same
 * `/api/import/:kind`; this page only owns the kind, the mode and the exits.
 */
export default function ImportPage() {
  const t = useTranslations('import');
  const confirm = useConfirm();
  const router = useRouter();
  const { kinds, order, loading, failed, reload } = useImportKinds();

  const [kindKey, setKindKey] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('guided');
  const [dirty, setDirty] = useState(false);

  const selectedKey = kindKey ?? order[0] ?? null;
  const kind = selectedKey ? kinds[selectedKey] : undefined;

  /** True when it is fine to throw the current input away. */
  const mayDiscard = useCallback(async (title: string, message: string, confirmLabel: string): Promise<boolean> => {
    if (!dirty) return true;
    return confirm({ title, message, destructive: true, confirmLabel, cancelLabel: t('keepEditing') });
  }, [dirty, confirm, t]);

  const handleSwitchMode = useCallback(async (next: ImportMode) => {
    if (next === mode) return;
    if (!(await mayDiscard(t('modeSwitchTitle'), t('modeSwitchMessage'), t('switch')))) return;
    setMode(next);
    setDirty(false);
  }, [mode, mayDiscard, t]);

  const handleKindChange = useCallback(async (next: string) => {
    if (next === selectedKey) return;
    if (!(await mayDiscard(t('cancelTitle'), t('cancelMessage'), t('discard')))) return;
    setKindKey(next);
    setDirty(false);
  }, [selectedKey, mayDiscard, t]);

  const handleCancel = useCallback(async () => {
    if (!(await mayDiscard(t('cancelTitle'), t('cancelMessage'), t('discard')))) return;
    setDirty(false);
    router.push(IMPORT_HOME);
  }, [mayDiscard, t, router]);

  return (
    <PageContainer width="readable">
      <PageHeader
        title={t('title')}
        description={t('kindHint')}
        actions={
          <div className="ui-button-group" role="group" aria-label={t('modeLabel')}>
            <Button variant={mode === 'guided' ? 'primary' : 'secondary'} aria-pressed={mode === 'guided'} onClick={() => void handleSwitchMode('guided')}>
              {t('guidedTab')}
            </Button>
            <Button variant={mode === 'bulk' ? 'primary' : 'secondary'} aria-pressed={mode === 'bulk'} onClick={() => void handleSwitchMode('bulk')}>
              {t('bulkTab')}
            </Button>
          </div>
        }
      />

      {loading && <SectionLoading label={t('kindsLoading')} />}
      {failed && (
        <div style={errorBanner} role="alert">
          {t('kindsLoadFailed')}{' '}
          <Button variant="ghost" size="sm" onClick={reload}>{t('kindsRetry')}</Button>
        </div>
      )}
      {!loading && !failed && !kind && <SectionEmpty message={t('kindsEmpty')} />}

      {kind && (
        <>
          <FieldFrame id="import-kind" label={t('kindLabel')}>
            <select
              id="import-kind"
              className="ui-input"
              value={kind.kind}
              onChange={(e) => void handleKindChange(e.target.value)}
            >
              {order.map((key) => (
                <option key={key} value={key} style={optionStyle}>{t(kindLabelKey(key))}</option>
              ))}
            </select>
          </FieldFrame>

          {mode === 'guided' ? (
            <GuidedWizard key={`guided:${kind.kind}`} kind={kind} onDirtyChange={setDirty} onCancel={() => void handleCancel()} />
          ) : (
            <BulkImport key={`bulk:${kind.kind}`} kind={kind} onDirtyChange={setDirty} onCancel={() => void handleCancel()} />
          )}
        </>
      )}
    </PageContainer>
  );
}
