'use client';

import { useTranslations } from 'next-intl';
import { FieldFrame, TextField } from '@/components/ui';
import { fieldLabelKey, type FieldDirective } from '@/lib/import-input-schema';
import { optionStyle } from './importStyles';

/**
 * One input for one registry column, chosen by the column's TYPE: a yes/no
 * select for a bool, a date picker for a date, a number field for a number,
 * text for the rest. The placeholder is the registry's example — the same value
 * the CSV template writes in its example row.
 */
export function GuidedFieldInput({ field, value, error, onChange, onBlur }: {
  field: FieldDirective;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const t = useTranslations('import');
  const label = t(fieldLabelKey(field.key));
  const id = `import-field-${field.key}`;
  const optional = field.required ? undefined : t('fieldOptional');

  if (field.type === 'bool') {
    return (
      <FieldFrame id={id} label={label} error={error} optional={optional}>
        <select
          id={id}
          className="ui-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-required={field.required || undefined}
          aria-invalid={Boolean(error) || undefined}
        >
          <option value="" style={optionStyle}>—</option>
          <option value="true" style={optionStyle}>{t('yes')}</option>
          <option value="false" style={optionStyle}>{t('no')}</option>
        </select>
      </FieldFrame>
    );
  }

  const inputType = field.type === 'number' ? 'number'
    : field.type === 'dateString' ? 'date'
      : field.type === 'timestamp' ? 'datetime-local'
        : 'text';

  return (
    <TextField
      id={id}
      label={label}
      error={error}
      optional={optional}
      type={inputType}
      step={field.type === 'number' ? 'any' : undefined}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      value={value}
      placeholder={field.example ? t('placeholderExample', { example: field.example }) : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      aria-required={field.required || undefined}
    />
  );
}
