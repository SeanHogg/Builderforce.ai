import { useCallback, useContext } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmContext } from '@/components/confirmContext';

export function useConfirmShellCommand(): (command: string) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  const t = useTranslations('common');
  return useCallback((command: string) =>
    confirm?.({ message: command, confirmLabel: t('approve'), destructive: true }) ?? Promise.resolve(false),
  [confirm, t]);
}
