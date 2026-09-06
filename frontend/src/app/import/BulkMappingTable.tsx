'use client';

import { useTranslations } from 'next-intl';
import { Surface } from '@/components/ui';
import type { FieldDirective } from '@/lib/import-input-schema';
import type { ParsedFileResult } from '@/lib/importHelpers';
import { optionStyle, tableStyle, tableWrap, tdStyle, thStyle } from './importStyles';

/**
 * File header → registry column, one row per header. The column list is the
 * kind's fields; a required one is starred so an unmapped requirement is visible
 * before the check says so.
 */
export function BulkMappingTable({ parsed, mappings, fields, labelOf, onChange }: {
  parsed: ParsedFileResult;
  mappings: Record<string, string>;
  fields: readonly FieldDirective[];
  labelOf: (key: string) => string;
  onChange: (header: string, target: string) => void;
}) {
  const t = useTranslations('import');
  const firstRow = parsed.rows[0];
  return (
    <Surface padding="sm" style={{ marginBottom: 'var(--space-5)' }}>
      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>{t('bulkMappingSourceCol')}</th>
              <th style={thStyle}>{t('bulkMappingTargetField')}</th>
              <th style={thStyle}>{t('bulkMappingPreview')}</th>
            </tr>
          </thead>
          <tbody>
            {parsed.headers.map((header) => {
              const preview = firstRow?.[header];
              return (
                <tr key={header}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600 }}>{header}</span>
                  </td>
                  <td style={tdStyle}>
                    <select
                      className="ui-input"
                      value={mappings[header] ?? ''}
                      onChange={(e) => onChange(header, e.target.value)}
                      aria-label={`${t('bulkMappingTargetFor')} ${header}`}
                    >
                      <option value="" style={optionStyle}>{t('bulkMappingIgnore')}</option>
                      {fields.map((f) => (
                        <option key={f.key} value={f.key} style={optionStyle}>
                          {labelOf(f.key)}{f.required ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-secondary)', maxWidth: '14rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {preview === undefined || preview === null || String(preview) === '' ? '—' : String(preview)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}
