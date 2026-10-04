import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { highlightToneFor, profileTabular, tabularFromObject, workbookSheets, type TabularCell, type TabularHighlightRule } from '@/lib/canvasTabularData';
import { recalculateSheet } from '@/lib/canvasSheet';
import { columnLetters } from '@/lib/canvasFormula';
import { maskCell, maskPlan, normalizeClassifications } from '@/lib/canvasDataGovernance';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { textValue, asRecord, AuthoredContent } from './shared';

/** Rows and columns rendered inside a Table/Dataset card before it scrolls. */
const DATA_GRID_VISIBLE_ROWS = 40;

const DATA_GRID_VISIBLE_COLUMNS = 10;

/**
 * Rows, columns, and — for authored Table and Spreadsheet objects — direct
 * editing. A sheet a person can only look at is a screenshot; this one takes a
 * value, a renamed header, a new row, or a new column straight back into the
 * object, so the canvas holds a working sheet rather than a picture of one.
 */
export function DataGridBody({ data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  // A card re-renders on selection, drag, and every neighbouring edit. Normalizing
  // an imported workbook's rows is O(rows × columns) per sheet, so doing it inline
  // would re-walk a 50,000-row import on each of those renders.
  const stored = useMemo(() => tabularFromObject(data as Record<string, unknown>), [data]);
  /**
   * THE RECALCULATION.
   *
   * `formulas` was a declared mutable field with no reader anywhere in the frontend, so
   * a sheet could store `=SUM(C1:C12)` and render that literal string. Everything below
   * this line reads `source`, so a formula cell now shows its VALUE — and a broken one
   * shows `#REF!`/`#CYCLE!` rather than a stale literal that looks like a real number.
   *
   * Memoized on the same dependency the normalization above uses: recalculation is
   * O(cells) with a topological sort, and a card re-renders on selection, drag and every
   * neighbouring edit.
   */
  const recalc = useMemo(
    () => (data.formulas ? recalculateSheet({ columns: stored.columns, rows: stored.rows, formulas: data.formulas }) : null),
    [stored, data.formulas],
  );
  const source = recalc ? { columns: stored.columns, rows: recalc.rows } : stored;
  // A computed cell is NOT editable: typing over it would replace the formula's output
  // with a literal and silently break every cell downstream of it — the sheet would keep
  // rendering a number, and it would stop being the number the formula says.
  const computedCells = useMemo(
    () => new Set(recalc ? Object.keys(recalc.cells) : []),
    [recalc],
  );
  const editable = !!onEdit && Array.isArray(data.rows) && (data.kind === 'spreadsheet' || data.kind === 'table');
  const [draft, setDraft] = useState<{ row: number; column: string; value: string } | null>(null);
  const sheets = useMemo(() => workbookSheets(data as Record<string, unknown>), [data]);
  const activeSheet = textValue(data.activeSheet, sheets[0]?.name ?? '');
  const writeRows = (rows: Array<Record<string, TabularCell>>, columns = source.columns) => {
    onEdit?.({
      columns, rows, rowCount: rows.length, sampleRows: rows.slice(0, 25), profile: profileTabular({ columns, rows }),
      // An edit belongs to the tab it was made on. Without writing it back into
      // the workbook, switching sheets and returning would discard it.
      ...(sheets.length ? { sheets: sheets.map((sheet) => sheet.name === activeSheet ? { name: sheet.name, columns, rows } : sheet) } : {}),
    });
  };
  const selectSheet = (name: string) => {
    const sheet = sheets.find((item) => item.name === name);
    if (!sheet || name === activeSheet) return;
    onEdit?.({
      activeSheet: name, columns: sheet.columns, rows: sheet.rows, rowCount: sheet.rows.length,
      sampleRows: sheet.rows.slice(0, 25), profile: profileTabular(sheet),
      subtitle: t('rowsColumns', { rows: sheet.rows.length, columns: sheet.columns.length }),
    });
  };
  const commitDraft = () => {
    if (!draft) { return; }
    const value = draft.value;
    if (draft.row < 0) {
      const name = value.trim() || draft.column;
      if (name !== draft.column && !source.columns.includes(name)) {
        writeRows(
          source.rows.map((row) => Object.fromEntries(source.columns.map((column) => [column === draft.column ? name : column, row[column] ?? ''])) as Record<string, TabularCell>),
          source.columns.map((column) => column === draft.column ? name : column),
        );
      }
    } else if (String(source.rows[draft.row]?.[draft.column] ?? '') !== value) {
      writeRows(source.rows.map((row, index) => index === draft.row ? { ...row, [draft.column]: value } : row));
    }
    setDraft(null);
  };
  const editorProps = (row: number, column: string) => ({
    className: styles.dataGridEditor,
    autoFocus: true,
    value: draft?.value ?? '',
    'aria-label': row < 0 ? t('editColumnName', { column }) : t('editCell', { column, row: row + 1 }),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ row, column, value: event.target.value }),
    onBlur: commitDraft,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
      if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
    },
  });
  const highlightRules = Array.isArray(data.highlightRules)
    ? (data.highlightRules as unknown[]).flatMap((value) => {
      const rule = asRecord(value, {});
      return typeof rule.column === 'string' && typeof rule.tone === 'string'
        ? [{ column: rule.column, op: rule.op, value: rule.value, tone: rule.tone } as TabularHighlightRule]
        : [];
    })
    : [];
  if (!source.columns.length && !source.rows.length && !editable) return <AuthoredContent data={data} fallback={t('dataFallback')} />;
  const columns = source.columns.slice(0, DATA_GRID_VISIBLE_COLUMNS);
  // Restricted columns are masked HERE, on the render path, not by rewriting the
  // stored rows: the analysis must still run over the real values (a masked join
  // key matches nothing), while a card on a shared board must never paint a card
  // number or a national id in the clear. `maskCell` preserves the shape a
  // reviewer needs — the domain of an email, the last four of a card — because a
  // column of identical dots says nothing about whether the data is right.
  const masking = maskPlan(normalizeClassifications(data.classifications));
  const rows = source.rows.slice(0, DATA_GRID_VISIBLE_ROWS);
  const totalRows = typeof data.rowCount === 'number' ? data.rowCount : source.rows.length;
  const toneCounts = highlightRules.length
    ? source.rows.reduce<Record<string, number>>((counts, row) => {
      const tone = highlightToneFor(row, highlightRules);
      if (tone) counts[tone] = (counts[tone] ?? 0) + 1;
      return counts;
    }, {})
    : {};
  return <div className={styles.dataGridBody}>
    {sheets.length > 1 && <div className={`${styles.sheetTabs} nodrag nowheel`} role="tablist" aria-label={t('workbookSheets')}>
      {sheets.map((sheet) => <button
        key={sheet.name}
        type="button"
        role="tab"
        aria-selected={sheet.name === activeSheet}
        disabled={!onEdit}
        title={t('sheetShape', { name: sheet.name, rows: sheet.rows.length, columns: sheet.columns.length })}
        onClick={(event) => { event.stopPropagation(); selectSheet(sheet.name); }}
      >{sheet.name}</button>)}
    </div>}
    <p className={styles.fileMeta}>
      {t('rowsColumns', { rows: totalRows, columns: source.columns.length })}
      {source.columns.length > columns.length ? ` · ${t('columnsHidden', { hidden: source.columns.length - columns.length })}` : ''}
    </p>
    {!!Object.keys(toneCounts).length && <div className={styles.dataGridTones}>
      {Object.entries(toneCounts).map(([tone, count]) => <span key={tone} data-tone={tone}><i />{t(`tone_${tone}` as 'tone_success')}<b>{fmt.number(count)}</b></span>)}
    </div>}
    {/* A formula that failed is reported on the card rather than only inside the cell:
        one `#REF!` in a 500-row sheet is invisible, and every total downstream of it is
        wrong by exactly that cell. */}
    {!!recalc?.errors.length && <p className={styles.dataGridFormulaErrors} role="status">
      {t('formulaErrors', { count: recalc.errors.length, first: `${recalc.errors[0].ref} ${recalc.errors[0].text}` })}
    </p>}
    <div className={`${styles.dataGridScroll} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      <div className={styles.miniTable} data-editable={editable ? 'true' : undefined} style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(84px, 1fr))` }}>
        {columns.map((column) => <b key={column}>
          {editable && draft?.row === -1 && draft.column === column
            ? <input {...editorProps(-1, column)} />
            : editable
              ? <button type="button" className={styles.dataGridCellButton} onClick={() => setDraft({ row: -1, column, value: column })}>{column}</button>
              : column}
        </b>)}
        {rows.flatMap((row, rowIndex) => {
          const tone = highlightToneFor(row, highlightRules);
          return columns.map((column) => {
            const pii = masking.get(column);
            const value = String((pii ? maskCell(row[column], pii) : row[column]) ?? '');
            // A COMPUTED cell is not editable either, and for a sharper reason than a
            // masked one: typing over it replaces the formula's output with a literal,
            // the cell keeps rendering a number, and it silently stops being the number
            // the formula says — while everything downstream still computes from it.
            const computed = computedCells.has(`${columnLetters(source.columns.indexOf(column))}${rowIndex + 1}`);
            return <span key={`${rowIndex}-${column}`} data-tone={tone ?? undefined} data-masked={pii ? 'true' : undefined} data-computed={computed ? 'true' : undefined}>
              {/* A masked cell is NOT editable: the visible text IS the mask, so
                  committing it would overwrite the real value with dots. */}
              {editable && !pii && !computed && draft?.row === rowIndex && draft.column === column
                ? <input {...editorProps(rowIndex, column)} />
                : editable && !pii && !computed
                  ? <button type="button" className={styles.dataGridCellButton} onClick={() => setDraft({ row: rowIndex, column, value })}>{value || ' '}</button>
                  : value}
            </span>;
          });
        })}
      </div>
    </div>
    {editable && <div className={`${styles.dataGridActions} nodrag nowheel`}>
      <button type="button" onClick={() => writeRows([...source.rows, Object.fromEntries(source.columns.map((column) => [column, ''])) as Record<string, TabularCell>])}>{t('addRow')}</button>
      <button type="button" onClick={() => {
        const name = t('columnName', { index: source.columns.length + 1 });
        const column = source.columns.includes(name) ? `${name}-${source.columns.length + 1}` : name;
        writeRows(source.rows.map((row) => ({ ...row, [column]: '' })), [...source.columns, column]);
      }}>{t('addColumn')}</button>
    </div>}
    {totalRows > rows.length && <small className={styles.dataGridFooter}>{t('rowsShown', { shown: rows.length, total: totalRows })}</small>}
  </div>;
}
