// No 'use client' directive: this module is only ever imported by `CreationNode`, which
// already declares the client boundary, so the directive would be redundant — and the
// architecture ratchet counts every one of them for a reason.
import { useTranslations } from 'next-intl';
import { specObjectNamespace, specObjectSpec, type SpecField } from '@/lib/specObjects';
// The vocabularies register themselves as an import SIDE EFFECT, so this component only
// renders a kind whose set has already been imported by SOMEONE. In the app that
// happened by accident — `CreationNode` pulls in `creationObjectRegistry`, which pulls in
// every set — which meant the body worked in the tree and rendered NOTHING when imported
// on its own. An accident of import order is not a dependency; importing the sets here
// makes the component self-sufficient, which is also what lets it be unit-tested.
import '@/lib/specObjectSets';
import { renderTex } from '@/lib/academic/mathTex';
import {
  citationFromNode, citationsFromBibliographyNode, citationStyleOf,
  formatBibliography, formatReference, isBibliographySort, defaultSortFor,
} from '@/lib/academic/citations';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * ONE node body for every spec-declared object kind — founder, academic, and whatever
 * vocabulary registers next.
 *
 * ── WHY ONE COMPONENT AND NOT FORTY-SEVEN ────────────────────────────────────────
 * `CreationNode` renders its bodies as a list of `{data.kind === 'x' && <XBody/>}`
 * branches, in a file well past 100KB. Every branch is a place the render can disagree
 * with the registry that declares the fields, and the registry has already lost that
 * argument once: a `kpi` could be authored with a `value` the AI context then stripped,
 * so the card showed a number the model was blind to.
 *
 * This body reads the registered spec. A field that is declared renders; a field that
 * is not, does not. There is no second list to update — which is why the entire
 * twenty-five-kind academic vocabulary arrived without a single new render branch.
 *
 * ── WHY IT DRAWS NOTHING IT WAS NOT GIVEN ────────────────────────────────────────
 * Every section is omitted when its field is empty, and the card falls back to an
 * explicit "nothing authored yet" state rather than placeholder rows. A sample row on a
 * rubric is indistinguishable from a real descriptor at a glance, and a student marked
 * against invented criteria is a worse outcome than an empty card — the same judgement
 * `emptyShellProblem` enforces on the authoring side.
 *
 * ── THEME AND WIDTH ──────────────────────────────────────────────────────────────
 * Every colour here is a CSS variable from the canvas palette, so both themes are
 * covered by construction, and the two wide styles (`rows`, `matrix`) scroll inside
 * their own container rather than widening the card — a gradebook with fourteen
 * assessments must not push a node off the board on a narrow viewport.
 */

/** A `list` entry: either a bare string or a {title, detail} pair. */
function listEntries(value: unknown): Array<{ title: string; detail: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw) => {
    if (typeof raw === 'string') return raw.trim() ? [{ title: raw.trim(), detail: '' }] : [];
    if (!raw || typeof raw !== 'object') return [];
    const record = raw as Record<string, unknown>;
    const title = String(record.title ?? record.name ?? record.label ?? record.question ?? '').trim();
    const detail = String(record.detail ?? record.body ?? record.answer ?? record.description ?? record.url ?? '').trim();
    return title || detail ? [{ title: title || detail, detail: title ? detail : '' }] : [];
  });
}

function chipValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item : String((item as Record<string, unknown>)?.name ?? (item as Record<string, unknown>)?.title ?? '')))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 14);
}

function tableRows(value: unknown, columns: readonly string[]): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const record = raw as Record<string, unknown>;
    const row = Object.fromEntries(columns.map((column) => {
      const cell = record[column];
      return [column, cell == null ? '' : String(cell)];
    }));
    return Object.values(row).some((cell) => cell) ? [row] : [];
  });
}

/** 0–100, clamped. Anything unparseable yields null so the meter is omitted rather
 *  than drawn at zero — an undrawn meter reads as "not scored", a zero reads as "bad". */
function meterValue(value: unknown): number | null {
  // A DIGIT IS REQUIRED, and the null matters more than the clamp: an OMITTED meter
  // reads as "not scored", a meter drawn at zero reads as "scored, and terrible".
  // Stripping non-numeric characters and handing the result to `Number` gets this
  // exactly backwards — `Number('')` is 0, so a `fitScore` of "unknown" drew a
  // full-width track with a red zero bar, telling a founder a segment had been assessed
  // and rejected when nothing had assessed it.
  const numeric = typeof value === 'number'
    ? value
    : /\d/.test(String(value ?? ''))
      ? Number(String(value).replace(/[^0-9.-]/g, ''))
      : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : null;
}

function statText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value).trim();
}

/**
 * A `matrix`: columns that are DATA rather than declared.
 *
 * The shape a rubric, a curriculum map and a gradebook all share — `{columns, rows}`
 * where each row is `{label, cells}`. `rows` cannot express it because its column
 * headers come from the spec, and these come from the object.
 */
interface MatrixData {
  columns: string[];
  rows: Array<{ label: string; cells: string[] }>;
}

function matrixValue(value: unknown): MatrixData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const columns = Array.isArray(record.columns)
    ? record.columns.map((column) => statText(column)).slice(0, 14)
    : [];
  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  const rows = rawRows.slice(0, 12).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const label = statText(row.label ?? row.criterion ?? row.title);
    if (!label) return [];
    const cells = Array.isArray(row.cells) ? row.cells.slice(0, 14).map((cell) => statText(cell)) : [];
    return [{ label, cells }];
  });
  return columns.length || rows.length ? { columns, rows } : null;
}

/** A `bars` distribution. Zero-valued entries are KEPT: "nobody got a distinction"
 *  is the most informative bar on the chart, and dropping it hides it. */
function barValues(value: unknown): Array<{ label: string; value: number }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 14).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const label = statText(row.label ?? row.choice ?? row.grade);
    const numeric = Number(row.value ?? row.count ?? 0);
    return label ? [{ label, value: Number.isFinite(numeric) ? numeric : 0 }] : [];
  });
}

/** How many entries a RESTRICTED field holds — the only thing about it that renders. */
function restrictedCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value as object).length;
  return statText(value) ? 1 : 0;
}

/**
 * Fields whose value is only ever interesting as an AGE.
 *
 * Derived from the name rather than hard-coded per vocabulary, because every set that
 * has reached for one has called it the same thing: an ISO instant a machine last wrote.
 * A recruiter asking "is this pool stale" wants "3 days ago", not a timestamp they have
 * to date-difference in their head.
 */
const AGE_FIELDS: ReadonlySet<string> = new Set([
  'fetchedAt', 'lastEvaluatedAt', 'refreshedAt', 'lastTouchAt', 'lastSentAt',
]);

/** Relative staleness for an instant field, so a live object shows its age rather than
 *  an ISO string the reader has to date-difference in their head. */
function staleness(value: unknown, t: ReturnType<typeof useTranslations>): string | null {
  const text = statText(value);
  if (!text) return null;
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return t('freshJustNow');
  if (minutes < 60) return t('freshMinutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('freshHours', { count: hours });
  return t('freshDays', { count: Math.round(hours / 24) });
}

/**
 * The formatted reference(s) for a `reference` field.
 *
 * Reads the OBJECT, never the stored `formatted` value, which is why the field is
 * `derived`: a stored string cannot be re-styled, and the whole argument for storing
 * references as fields is that the style is applied at render time.
 */
function referenceLines(data: CreationNodeData): Array<{ marker: string; text: string }> {
  const style = citationStyleOf(data);
  if (data.kind === 'bibliography') {
    const sort = isBibliographySort(data.sortOrder) ? data.sortOrder : defaultSortFor(style);
    return formatBibliography(citationsFromBibliographyNode(data), style, sort)
      .slice(0, 12)
      .map((entry) => ({ marker: entry.marker, text: entry.formatted.text }));
  }
  const record = citationFromNode(data);
  if (!record.title && !record.authors.length) return [];
  return [{ marker: '', text: formatReference(record, style).text }];
}

function FieldSection({ field, data, t }: {
  field: SpecField;
  data: CreationNodeData;
  t: ReturnType<typeof useTranslations>;
}) {
  const raw = data[field.name];
  const label = t(`field.${field.label}`);

  // RESTRICTED, before the per-style switch: what the field would have drawn is exactly
  // what must not be drawn, whichever style it declared. A restricted field renders as a
  // COUNT and never as its values — `candidate.demographics` must be visible enough that
  // a compliance reader can see it was collected, and must never be readable over
  // someone's shoulder beside the ranking it is unlawful to influence. The model never
  // receives it at all (`specFieldNames()` excludes it), so this is the only surface that
  // acknowledges it exists. See `SpecField.restricted`.
  if (field.restricted) {
    const count = restrictedCount(raw);
    return count > 0
      ? <div className={styles.founderVerdict}><small>{label}</small><strong>{t('restrictedHeld', { count })}</strong></div>
      : null;
  }

  switch (field.render) {
    case 'stat': {
      const text = statText(raw);
      if (!text) return null;
      // An instant field is only ever interesting as an age.
      const age = AGE_FIELDS.has(field.name) ? staleness(raw, t) : null;
      return <span className={styles.founderStat}><small>{label}</small><b>{age ?? text}</b></span>;
    }

    case 'text': {
      const text = statText(raw);
      return text ? <p className={styles.founderText}><small>{label}</small>{text}</p> : null;
    }

    case 'chips': {
      const chips = chipValues(raw);
      return chips.length
        ? <div className={styles.founderChips}><small>{label}</small><div>{chips.map((chip, index) => <span key={`${chip}-${index}`}>{chip}</span>)}</div></div>
        : null;
    }

    case 'list': {
      const entries = listEntries(raw);
      return entries.length
        ? <div className={styles.founderList}><small>{label}</small><ul>{entries.map((entry, index) => (
          <li key={`${entry.title}-${index}`}><b>{entry.title}</b>{entry.detail && <span>{entry.detail}</span>}</li>
        ))}</ul></div>
        : null;
    }

    case 'rows': {
      const columns = field.columns ?? [];
      const rows = tableRows(raw, columns);
      if (!rows.length) return null;
      return (
        <div className={styles.founderTableWrap}>
          <small>{label}</small>
          <div className={styles.founderTableScroll}>
            <table className={styles.founderTable}>
              <thead><tr>{columns.map((column) => <th key={column} scope="col">{t(`column.${column}`)}</th>)}</tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr key={`${Object.values(row)[0] ?? ''}-${index}`}>{columns.map((column) => <td key={column}>{row[column]}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      );
    }

    case 'meter': {
      const score = meterValue(raw);
      if (score == null) return null;
      const tone = score >= 67 ? 'good' : score >= 34 ? 'watch' : 'risk';
      return (
        <div className={styles.founderMeter} data-tone={tone}>
          <small>{label}</small>
          <div className={styles.founderMeterTrack} role="img" aria-label={t('meterLabel', { label, score })}>
            <i style={{ width: `${score}%` }} />
          </div>
          <b>{score}</b>
        </div>
      );
    }

    case 'verdict': {
      const text = statText(raw);
      return text ? <div className={styles.founderVerdict}><small>{label}</small><strong>{text}</strong></div> : null;
    }

    case 'matrix': {
      const matrix = matrixValue(raw);
      if (!matrix || !matrix.rows.length) return null;
      return (
        <div className={styles.founderTableWrap}>
          <small>{label}</small>
          <div className={styles.founderTableScroll}>
            <table className={styles.specMatrix}>
              <thead>
                <tr>
                  <th scope="col" />
                  {matrix.columns.map((column, index) => <th key={`${column}-${index}`} scope="col">{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row, rowIndex) => (
                  <tr key={`${row.label}-${rowIndex}`}>
                    <th scope="row">{row.label}</th>
                    {matrix.columns.map((column, cellIndex) => (
                      <td key={`${column}-${cellIndex}`}>{row.cells[cellIndex] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    case 'bars': {
      const bars = barValues(raw);
      if (!bars.length) return null;
      const peak = Math.max(1, ...bars.map((bar) => bar.value));
      const total = bars.reduce((sum, bar) => sum + bar.value, 0);
      return (
        <div className={styles.specBars}>
          <small>{label}</small>
          <ul>
            {bars.map((bar, index) => (
              <li key={`${bar.label}-${index}`}>
                <span>{bar.label}</span>
                {/* The bar is decorative; the number beside it is the accessible value,
                    so a screen reader never has to interpret a width. */}
                <i aria-hidden="true" style={{ width: `${Math.round((bar.value / peak) * 100)}%` }} />
                <b>{total > 0 ? t('barValue', { value: bar.value, percent: Math.round((bar.value / total) * 100) }) : bar.value}</b>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case 'math': {
      const rendered = renderTex(raw, data.altText);
      if (rendered.empty) return null;
      return (
        <div className={styles.specMath}>
          <small>{label}</small>
          {/* MathML is native in every current browser and is what a screen reader
              speaks; the `alttext` carried inside is the author's reading when they
              wrote one. There is no script and no font download — see mathTex.ts. */}
          <div
            className={styles.specMathRender}
            role="math"
            aria-label={rendered.spoken}
            dangerouslySetInnerHTML={{ __html: rendered.mathml }}
          />
        </div>
      );
    }

    case 'reference': {
      const lines = referenceLines(data);
      if (!lines.length) return null;
      return (
        <div className={styles.specReference}>
          <small>{label}</small>
          <ol>
            {lines.map((line, index) => (
              <li key={`${line.marker}-${index}`}>
                {line.marker && <span className={styles.specReferenceMarker}>{line.marker}</span>}
                {line.text}
              </li>
            ))}
          </ol>
        </div>
      );
    }
  }
}

/**
 * Whether a field would render anything.
 *
 * Duplicating the emptiness test the sections already perform would be two rules to
 * keep in step, so the checks live here and the sections read the same predicate shape:
 * a section is present exactly when this says its value is non-empty.
 */
function sectionHasContent(field: SpecField, data: CreationNodeData): boolean {
  const value = data[field.name];
  // Restricted first, matching `FieldSection`: the section exists when the data was
  // collected, whatever style the field declared for values nobody here will see.
  if (field.restricted) return restrictedCount(value) > 0;
  switch (field.render) {
    case 'stat':
    case 'text':
    case 'verdict':
      return statText(value).length > 0;
    case 'chips':
      return chipValues(value).length > 0;
    case 'list':
      return listEntries(value).length > 0;
    case 'rows':
      return tableRows(value, field.columns ?? []).length > 0;
    case 'meter':
      return meterValue(value) != null;
    case 'matrix':
      return (matrixValue(value)?.rows.length ?? 0) > 0;
    case 'bars':
      return barValues(value).length > 0;
    case 'math':
      return !renderTex(value, data.altText).empty;
    // A reference renders from the whole object rather than from one stored field, so
    // it is present exactly when the formatter produces a line.
    case 'reference':
      return referenceLines(data).length > 0;
  }
}

export function SpecObjectBody({ data }: { data: CreationNodeData }) {
  const namespace = specObjectNamespace(data.kind);
  const spec = specObjectSpec(data.kind);
  // `useTranslations` must be called unconditionally, so the namespace falls back
  // rather than the hook being skipped for a non-spec kind.
  const t = useTranslations(namespace ?? 'creationCanvas.founder');
  if (!spec || !namespace) return null;

  const sections = spec.fields
    .filter((field) => sectionHasContent(field, data))
    .map((field) => ({ field, node: <FieldSection key={field.name} field={field} data={data} t={t} /> }));

  if (!sections.length) {
    return (
      <div className={styles.founderEmpty}>
        <p>{t('empty', { label: t(`label.${spec.kind}`) })}</p>
        <span>{t('emptyHint')}</span>
      </div>
    );
  }

  // Stats lead, because the numbers are what a reader scans for; everything else keeps
  // its declared order, which is the order the spec author reasoned in. A RESTRICTED
  // field is never a stat whatever it declared — it draws as a callout, so putting it in
  // the stat grid would break the row it cannot fill.
  const isStat = (entry: { field: SpecField }) => entry.field.render === 'stat' && !entry.field.restricted;
  const stats = sections.filter(isStat);
  const rest = sections.filter((entry) => !isStat(entry));

  return (
    <div className={styles.founderBody}>
      {stats.length > 0 && <div className={styles.founderStatRow}>{stats.map((entry) => entry.node)}</div>}
      {rest.map((entry) => entry.node)}
    </div>
  );
}
