/**
 * FILTER_VALUE_EDITORS — how the filter bar asks for a clause's value, keyed by
 * the field's `valueKind` (`FILTER_FIELDS`, PRD 33 §3.4). A field never gets
 * its own branch: a new field picks an existing kind, a new kind adds one row.
 *
 * Every editor reports `null` while its value is incomplete, so the bar's
 * Apply stays disabled until the clause would parse. Duration fields are
 * stored in ms and typed in seconds (`FIELD_UNITS`, data).
 */

import { useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import type {
  FilterFieldId,
  FilterFieldSpec,
  FilterOp,
  FilterValueKind,
  ReplayFilterClause,
} from '@builderforce/interaction-contract';

export type ClauseValue = ReplayFilterClause['value'];

export interface FilterValueEditorProps {
  spec: FilterFieldSpec;
  op: FilterOp;
  value: ClauseValue | null;
  onChange: (value: ClauseValue | null) => void;
  /** Values the site's recordings carry for this field, most sessions first. */
  suggestions: ReadonlyArray<{ value: string; count: number }>;
  /** Labels the control (the bar renders the visible label). */
  inputId: string;
}

/** A field typed in a larger unit than it is stored in: `scale` stored units per typed unit. */
export const FIELD_UNITS: Partial<Record<FilterFieldId, { scale: number; unitKey: string }>> = {
  durationMs: { scale: 1000, unitKey: 'unit.seconds' },
  activeMs: { scale: 1000, unitKey: 'unit.seconds' },
};

const inputStyle = { minHeight: 44, minWidth: 0, flex: '1 1 160px' } as const;

function splitList(raw: string): string[] {
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

function StringEditor({ op, value, onChange, suggestions, inputId }: FilterValueEditorProps) {
  const t = useTranslations('replay.filter');
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
  const listId = `${inputId}-options`;
  return (
    <>
      <input
        id={inputId}
        className="input"
        list={suggestions.length > 0 ? listId : undefined}
        defaultValue={text}
        placeholder={op === 'in' ? t('placeholder.list') : t('placeholder.text')}
        style={inputStyle}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          if (op === 'in') {
            const items = splitList(raw);
            onChange(items.length > 0 ? items : null);
          } else {
            onChange(raw.trim() ? raw.trim() : null);
          }
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((option) => <option key={option.value} value={option.value}>{`${option.value} (${option.count})`}</option>)}
        </datalist>
      )}
    </>
  );
}

function NumberEditor({ spec, value, onChange, inputId }: FilterValueEditorProps) {
  const t = useTranslations('replay.filter');
  const unit = FIELD_UNITS[spec.id];
  const scale = unit?.scale ?? 1;
  const shown = typeof value === 'number' ? value / scale : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', flex: '1 1 160px', minWidth: 0 }}>
      <input
        id={inputId}
        type="number"
        min={0}
        className="input"
        defaultValue={shown}
        style={inputStyle}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          const n = Number(raw);
          onChange(raw.trim() !== '' && Number.isFinite(n) ? Math.round(n * scale) : null);
        }}
      />
      {unit && <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t(unit.unitKey)}</span>}
    </span>
  );
}

function BooleanEditor({ value, onChange, inputId }: FilterValueEditorProps) {
  const t = useTranslations('replay.filter');
  return (
    <select
      id={inputId}
      className="input"
      value={value === true ? 'true' : value === false ? 'false' : ''}
      style={inputStyle}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        onChange(raw === 'true' ? true : raw === 'false' ? false : null);
      }}
    >
      <option value="">{t('choose')}</option>
      <option value="true">{t('value.true')}</option>
      <option value="false">{t('value.false')}</option>
    </select>
  );
}

function EnumEditor({ spec, op, value, onChange, inputId }: FilterValueEditorProps) {
  const t = useTranslations('replay.filter');
  const values = spec.values ?? [];
  if (op === 'in') {
    const chosen = new Set(Array.isArray(value) ? value.map(String) : []);
    return (
      <fieldset id={inputId} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', border: 'none', margin: 0, padding: 0 }}>
        <legend className="sr-only">{t(`field.${spec.id}`)}</legend>
        {values.map((item) => (
          <label key={item} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', minHeight: 44 }}>
            <input
              type="checkbox"
              checked={chosen.has(item)}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.currentTarget.checked) next.add(item);
                else next.delete(item);
                const list = values.filter((v) => next.has(v));
                onChange(list.length > 0 ? list : null);
              }}
            />
            <span>{t(`value.${item}`)}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <select
      id={inputId}
      className="input"
      value={typeof value === 'string' ? value : ''}
      style={inputStyle}
      onChange={(event) => onChange(event.currentTarget.value || null)}
    >
      <option value="">{t('choose')}</option>
      {values.map((item) => <option key={item} value={item}>{t(`value.${item}`)}</option>)}
    </select>
  );
}

function KeyValueEditor({ value, onChange, inputId }: FilterValueEditorProps) {
  const t = useTranslations('replay.filter');
  const [pair, setPair] = useState(() => {
    const raw = typeof value === 'string' ? value : '';
    const eq = raw.indexOf('=');
    return eq > 0 ? { key: raw.slice(0, eq), val: raw.slice(eq + 1) } : { key: '', val: '' };
  });
  const update = (next: { key: string; val: string }) => {
    setPair(next);
    onChange(next.key.trim() ? `${next.key.trim()}=${next.val.trim()}` : null);
  };
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--space-1)', flex: '1 1 200px', minWidth: 0 }}>
      <input
        id={inputId}
        className="input"
        value={pair.key}
        placeholder={t('placeholder.tagKey')}
        aria-label={t('placeholder.tagKey')}
        style={inputStyle}
        onChange={(event) => update({ ...pair, key: event.currentTarget.value })}
      />
      <input
        className="input"
        value={pair.val}
        placeholder={t('placeholder.tagValue')}
        aria-label={t('placeholder.tagValue')}
        style={inputStyle}
        onChange={(event) => update({ ...pair, val: event.currentTarget.value })}
      />
    </span>
  );
}

export const FILTER_VALUE_EDITORS: Readonly<Record<FilterValueKind, ComponentType<FilterValueEditorProps>>> = {
  string: StringEditor,
  number: NumberEditor,
  boolean: BooleanEditor,
  enum: EnumEditor,
  keyValue: KeyValueEditor,
};

type T = (key: string, values?: Record<string, string | number>) => string;

/** A clause's value as the chip reads it (enum and boolean values translated, durations in seconds). */
export function formatClauseValue(spec: FilterFieldSpec, value: ClauseValue, t: T): string {
  const one = (item: string | number | boolean): string => {
    if (typeof item === 'boolean') return t(`value.${item}`);
    if (spec.valueKind === 'enum') return t(`value.${item}`);
    const unit = FIELD_UNITS[spec.id];
    if (unit && typeof item === 'number') return `${item / unit.scale} ${t(unit.unitKey)}`;
    return String(item);
  };
  return Array.isArray(value) ? value.map(one).join(', ') : one(value as string | number | boolean);
}
