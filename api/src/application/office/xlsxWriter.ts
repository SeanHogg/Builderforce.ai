/**
 * rowsToXlsx — write a real .xlsx (Office Open XML SpreadsheetML) from a canvas
 * sheet, using fflate, the same zip library `docxWriter` uses. No new package,
 * runs in the Worker.
 *
 * CSV was the only way a sheet left the canvas, and CSV is an interchange format,
 * not Excel's: it carries no types, no header, no column widths, and a cell
 * holding `01234` or `3-5` comes back as a number or a date. This writes the
 * native container instead, so a sheet opens in Excel as the sheet it was.
 *
 * An .xlsx is a zip of five parts: `[Content_Types].xml`, `_rels/.rels`,
 * `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml` and
 * `xl/worksheets/sheet1.xml`. Text is written as `inlineStr` rather than through
 * a shared-string table — one pass, no second index to keep consistent, and the
 * size difference is irrelevant at the row counts a canvas object holds.
 */

import { zipSync, strToU8 } from 'fflate';

/** Excel's own ceilings are 1,048,576 × 16,384; these are the canvas's, chosen so
 * one object cannot turn into an unbounded render inside a Worker. */
export const MAX_XLSX_ROWS = 50_000;
export const MAX_XLSX_COLUMNS = 256;

export type XlsxCell = string | number | boolean | null;

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Control characters are not representable in XML 1.0 and make Excel refuse
    // the file outright rather than skip the cell.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Spreadsheet column name for a zero-based index: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) name = String.fromCharCode(65 + (n % 26)) + name;
  return name;
}

/** Excel rejects a workbook whose sheet name is empty, over 31 characters, or
 * carries any of `[]:*?/\`, so the caller's title is normalized rather than
 * trusted. */
export function sheetName(value: string | undefined): string {
  const cleaned = (value ?? '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned || 'Sheet1';
}

function cellXml(reference: string, value: XlsxCell, style: number): string {
  const attributes = `r="${reference}"${style ? ` s="${style}"` : ''}`;
  if (value === null || value === '') return `<c ${attributes}/>`;
  if (typeof value === 'boolean') return `<c ${attributes} t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c ${attributes}><v>${value}</v></c>`;
  return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

/** Excel's own ceiling on sheets is memory-bound; this one keeps a single export
 *  from turning into an unbounded render inside a Worker. */
export const MAX_XLSX_SHEETS = 16;

function contentTypes(sheetCount: number): string {
  const overrides = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/** One worksheet relationship per sheet, then styles LAST — the styles rId must
 *  not collide with a sheet's, which is what makes this a function rather than a
 *  constant with `rId2` hardcoded. */
function workbookRels(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

/**
 * Two cell formats: body text, and the header band.
 *
 * Excel is strict about this part — `fills` must begin with `none` then
 * `gray125` in that order, and every index referenced by `cellXfs` must exist,
 * or the workbook opens as "unreadable content" with no further explanation.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;

/** Column width in Excel's character units, sized to the widest value it holds so
 * a sheet does not open as a wall of `####`. */
function columnWidth(header: string, values: readonly XlsxCell[]): number {
  const widest = values.reduce<number>((longest, value) => Math.max(longest, String(value ?? '').length), header.length);
  return Math.min(60, Math.max(9, widest + 2));
}

export interface XlsxSheet {
  columns: readonly string[];
  rows: ReadonlyArray<readonly XlsxCell[]>;
  title?: string;
}

/**
 * Write a workbook — one sheet per {@link XlsxSheet}.
 *
 * Rows are positional against `columns`; a short row leaves the trailing cells
 * empty rather than shifting them left.
 *
 * Multi-sheet exists because a report is often two tables that only mean
 * something together — the capitalization report's monthly series is the claim
 * and its epic table is the evidence — and flattening those into one grid with a
 * `section` column is what a CSV has to do, not what a spreadsheet should. Sheet
 * names are normalized AND de-duplicated: Excel refuses a workbook with two
 * sheets of the same name, and two callers passing the same title is a mistake
 * that should produce "Report (2)", not a file nobody can open.
 */
export function sheetsToXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  const limited = sheets.slice(0, MAX_XLSX_SHEETS);
  if (limited.length === 0) return sheetsToXlsx([{ columns: [], rows: [] }]);

  const usedNames = new Set<string>();
  const names = limited.map((sheet, index) => {
    const base = sheetName(sheet.title ?? `Sheet${index + 1}`);
    let name = base;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) {
      // Trim before appending so the suffixed name still fits Excel's 31 chars.
      const suffix = ` (${n})`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    usedNames.add(name.toLowerCase());
    return name;
  });

  const parts: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(limited.length)),
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels(limited.length)),
    'xl/styles.xml': strToU8(STYLES),
  };
  limited.forEach((sheet, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
    names.map((name, index) => `<sheet name="${esc(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')
  }</sheets></workbook>`;
  parts['xl/workbook.xml'] = strToU8(workbook);

  return zipSync(parts, { level: 6 });
}

/** Write a single-sheet workbook — the common case, kept as its own name so the
 *  many callers that have exactly one table read as such. */
export function rowsToXlsx(sheet: XlsxSheet): Uint8Array {
  return sheetsToXlsx([sheet]);
}

/** The `xl/worksheets/sheetN.xml` part for one sheet. */
function worksheetXml({ columns, rows }: XlsxSheet): string {
  const head = columns.slice(0, MAX_XLSX_COLUMNS).map((column) => String(column ?? ''));
  const body = rows.slice(0, MAX_XLSX_ROWS).map((row) => head.map((_column, index) => row[index] ?? null));
  const lastColumn = columnName(Math.max(0, head.length - 1));
  const lastRow = body.length + 1;

  const headerRow = `<row r="1" s="1" customFormat="1">${head.map((value, index) => cellXml(`${columnName(index)}1`, value, 1)).join('')}</row>`;
  const bodyRows = body.map((row, rowIndex) => {
    const reference = rowIndex + 2;
    return `<row r="${reference}">${row.map((value, index) => cellXml(`${columnName(index)}${reference}`, value, 0)).join('')}</row>`;
  }).join('');

  const cols = head.length
    ? `<cols>${head.map((header, index) => `<col min="${index + 1}" max="${index + 1}" width="${columnWidth(header, body.map((row) => row[index] ?? null))}" customWidth="1"/>`).join('')}</cols>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${Math.max(1, lastRow)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${headerRow}${bodyRows}</sheetData>${head.length ? `<autoFilter ref="A1:${lastColumn}${Math.max(1, lastRow)}"/>` : ''}</worksheet>`;
}
