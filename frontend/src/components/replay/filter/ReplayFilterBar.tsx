/**
 * THE filter bar (PRD 33 §3.4, §4.1 header): the applied clauses as removable
 * chips, an "Add filter" menu listing every `FILTER_FIELDS` row, and the
 * clause editor — an op picker plus the value editor `FILTER_VALUE_EDITORS`
 * names for the field's `valueKind`. Presentational: the filter comes in, a
 * new filter goes out (`onChange`); the host owns where it lives.
 */

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  FILTER_FIELDS,
  FILTER_FIELD_BY_ID,
  MAX_FILTER_CLAUSES,
  parseReplayFilter,
  type FilterFieldId,
  type FilterOp,
  type ReplayFilter,
  type ReplayFilterOptionsDto,
} from '@builderforce/interaction-contract';
import { Icon } from '@/components/ui/Icon';
import { FILTER_VALUE_EDITORS, formatClauseValue, type ClauseValue } from './filterValueEditors';
import { addClause, removeClauseAt } from './useReplayFilter';

export interface ReplayFilterBarProps {
  filter: ReplayFilter;
  onChange: (filter: ReplayFilter) => void;
  /** Value suggestions per field (`replayApi.filterOptions`). */
  options?: ReadonlyArray<ReplayFilterOptionsDto>;
  /** Drawn after the add button (the segment menu). */
  trailing?: ReactNode;
}

interface Draft {
  field: FilterFieldId;
  op: FilterOp;
  value: ClauseValue | null;
}

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  minHeight: 32,
  padding: '0 0 0 var(--space-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-small)',
  maxWidth: '100%',
} as const;

export function ReplayFilterBar({ filter, onChange, options = [], trailing }: ReplayFilterBarProps) {
  const t = useTranslations('replay.filter');
  const baseId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const full = filter.all.length >= MAX_FILTER_CLAUSES;

  const startDraft = (field: FilterFieldId) => {
    const spec = FILTER_FIELD_BY_ID.get(field);
    if (!spec) return;
    setMenuOpen(false);
    setDraft({ field, op: spec.ops[0]!, value: null });
  };

  const draftClause = draft && draft.value !== null ? parseReplayFilter({ all: [{ field: draft.field, op: draft.op, value: draft.value }] })?.all[0] ?? null : null;

  const apply = () => {
    if (!draftClause) return;
    onChange(addClause(filter, draftClause));
    setDraft(null);
  };

  const draftSpec = draft ? FILTER_FIELD_BY_ID.get(draft.field) : undefined;
  const Editor = draftSpec ? FILTER_VALUE_EDITORS[draftSpec.valueKind] : null;
  const suggestions = draft ? options.find((row) => row.field === draft.field)?.values ?? [] : [];
  const valueId = `${baseId}-value`;
  const opId = `${baseId}-op`;

  return (
    <div role="group" aria-label={t('aria')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0, flex: '1 1 auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-1)', minWidth: 0 }}>
        {filter.all.map((clause, index) => {
          const spec = FILTER_FIELD_BY_ID.get(clause.field);
          if (!spec) return null;
          const text = `${t(`field.${clause.field}`)} ${t(`op.${clause.op}`)} ${formatClauseValue(spec, clause.value, t)}`;
          return (
            <span key={`${clause.field}.${clause.op}.${index}`} style={chipStyle}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{text}</span>
              <button
                type="button"
                className="btn-ghost"
                aria-label={t('remove', { clause: text })}
                onClick={() => onChange(removeClauseAt(filter, index))}
                style={{ minHeight: 44, minWidth: 44, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="close" size={14} />
              </button>
            </span>
          );
        })}
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className="btn-ghost"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={full}
            title={full ? t('full') : undefined}
            onClick={() => setMenuOpen((open) => !open)}
            style={{ minHeight: 44 }}
          >
            <Icon name="plus" size={14} /> {t('add')}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label={t('fieldsAria')}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 200,
                maxHeight: 320,
                overflowY: 'auto',
                padding: 'var(--space-1)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-card)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {FILTER_FIELDS.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  role="menuitem"
                  className="btn-ghost"
                  style={{ minHeight: 44, justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => startDraft(field.id)}
                >
                  {t(`field.${field.id}`)}
                </button>
              ))}
            </div>
          )}
        </span>
        {filter.all.length > 0 && (
          <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => onChange({ all: [] })}>
            {t('clear')}
          </button>
        )}
        {trailing}
      </div>

      {draft && draftSpec && Editor && (
        <form
          aria-label={t('editorAria', { field: t(`field.${draft.field}`) })}
          onSubmit={(event) => { event.preventDefault(); apply(); }}
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}
        >
          <label htmlFor={opId} style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t(`field.${draft.field}`)}
          </label>
          <select
            id={opId}
            className="input"
            aria-label={t('opAria')}
            value={draft.op}
            onChange={(event) => setDraft({ ...draft, op: event.currentTarget.value as FilterOp, value: null })}
            style={{ minHeight: 44 }}
          >
            {draftSpec.ops.map((op) => <option key={op} value={op}>{t(`op.${op}`)}</option>)}
          </select>
          <label htmlFor={valueId} className="sr-only">{t('valueAria')}</label>
          <Editor
            key={`${draft.field}.${draft.op}`}
            spec={draftSpec}
            op={draft.op}
            value={draft.value}
            onChange={(value) => setDraft((current) => (current ? { ...current, value } : current))}
            suggestions={suggestions}
            inputId={valueId}
          />
          <button type="submit" className="btn-primary" disabled={!draftClause} style={{ minHeight: 44 }}>{t('apply')}</button>
          <button type="button" className="btn-ghost" onClick={() => setDraft(null)} style={{ minHeight: 44 }}>{t('cancel')}</button>
        </form>
      )}
    </div>
  );
}
