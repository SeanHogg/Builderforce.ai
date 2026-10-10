/**
 * Who a scheduled report goes to — a textarea that accepts what people paste
 * (commas, semicolons, newlines, `Name <a@b.co>`) and says, by name, which
 * entries it could not read. Parsing is `lib/reports/recipients.ts`, so the
 * form's validity check and this control's hint can never disagree.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { TextAreaField } from '@/components/ui';
import { parseRecipientInput } from '@/lib/reports/recipients';

export function RecipientsField({ id, value, onChange, disabled = false }: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('financeHub.reports');
  const parsed = useMemo(() => parseRecipientInput(value), [value]);
  const error = parsed.invalid.length > 0
    ? t('recipientsInvalid', { entries: parsed.invalid.join(', ') })
    : undefined;
  const hint = parsed.valid.length > 0
    ? t('recipientsCount', { count: parsed.valid.length })
    : t('recipientsHint');
  return (
    <TextAreaField
      id={id}
      label={t('field.recipients')}
      value={value}
      rows={3}
      disabled={disabled}
      placeholder={t('recipientsPlaceholder')}
      hint={hint}
      error={error}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
