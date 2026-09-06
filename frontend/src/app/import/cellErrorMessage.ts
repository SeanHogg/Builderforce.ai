import type { CellErrorCode } from '@/lib/import-input-schema';

/** The slice of next-intl's `t` these messages need. */
export type ImportTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * A cell error's sentence, said here rather than in `import-input-schema` —
 * which has no translator. Written as literal keys instead of one interpolated
 * `t(\`bulkError.${code}\`)` so `check-i18n-keys` can see every one.
 *
 * `form` is the wizard: the same rule, phrased for a field the reader is
 * typing into rather than a row they uploaded.
 */
export function cellErrorMessage(
  t: ImportTranslator,
  code: CellErrorCode,
  field: string,
  variant: 'row' | 'form' = 'row',
): string {
  switch (code) {
    case 'requiredEmpty':
      return variant === 'form' ? t('fieldRequired', { field }) : t('bulkErrorRequiredEmpty', { field });
    case 'notBoolean':
      return t('bulkErrorNotBoolean', { field });
    case 'notNumber':
      return t('bulkErrorNotNumber', { field });
    case 'notDate':
      return t('bulkErrorNotDate', { field });
  }
}
