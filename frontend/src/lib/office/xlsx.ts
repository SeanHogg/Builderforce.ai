/**
 * `.xlsx` → the tabular shape the canvas queries and charts.
 */

import { attribute, decodeXmlText, openZip } from './container';

/* ----------------------------------------------------------------- XLSX --- */

export type WorkbookCell = string | number;
export interface WorkbookSheet {
  name: string;
  columns: string[];
  rows: Array<Record<string, WorkbookCell>>;
}

/** `AB` → 27. Cell references, not element order, decide a column: a sparse row
 * that skips an empty cell would otherwise shift every value left. */
function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase())?.[1] ?? '';
  return [...letters].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
}

function sharedStringValues(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g)].map((item) =>
    [...(item[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((text) => decodeXmlText(text[1]!)).join(''));
}

const SHEET_ROW = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row(?:\s[^>]*)?\/>/g;
const SHEET_CELL = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;

/** Excel serial day → ISO date. The epoch is 1899-12-30 to absorb the
 * deliberate 1900 leap-year bug every spreadsheet keeps for compatibility. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DATE_NUMBER_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateStyle(style: string | null, dateStyles: Set<number>): boolean {
  const index = Number(style);
  return Number.isFinite(index) && dateStyles.has(index);
}

function excelDate(serial: number): string {
  const time = EXCEL_EPOCH_MS + Math.round(serial * 86_400_000);
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return String(serial);
  const iso = date.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

function parseSheetXml(name: string, xml: string, shared: string[], dateStyles: Set<number>, maxRows: number): WorkbookSheet {
  const grid: WorkbookCell[][] = [];
  for (const rowMatch of xml.matchAll(SHEET_ROW)) {
    if (grid.length >= maxRows + 1) break;
    const row: WorkbookCell[] = [];
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(SHEET_CELL)) {
      const attributes = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = attribute(attributes, 'r') ?? '';
      const index = reference ? columnIndex(reference) : row.length;
      const type = attribute(attributes, 't') ?? 'n';
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      let value: WorkbookCell = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr' || type === 'str') {
        value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((text) => decodeXmlText(text[1]!)).join('') || decodeXmlText(raw);
      } else if (type === 'b') value = raw === '1' ? 'true' : 'false';
      else if (raw) {
        const numeric = Number(raw);
        value = Number.isFinite(numeric)
          ? isDateStyle(attribute(attributes, 's'), dateStyles) ? excelDate(numeric) : numeric
          : decodeXmlText(raw);
      }
      if (index >= 0) row[index] = value;
    }
    grid.push(row);
  }
  while (grid.length && !grid[grid.length - 1]!.some((cell) => cell !== '' && cell != null)) grid.pop();
  const [header, ...body] = grid;
  if (!header) return { name, columns: [], rows: [] };
  const width = Math.max(header.length, ...body.map((row) => row.length), 0);
  const columns = Array.from({ length: width }, (_, index) => {
    const label = String(header[index] ?? '').trim();
    return label || `Column ${index + 1}`;
  });
  const unique = columns.map((label, index) => columns.indexOf(label) === index ? label : `${label} (${index + 1})`);
  return {
    name,
    columns: unique,
    rows: body.map((row) => Object.fromEntries(unique.map((label, index) => [label, row[index] ?? '']))),
  };
}

/** Number formats a workbook defines itself; a serial rendered as `45231`
 * instead of a date makes an imported sheet unreadable. */
function customDateStyles(stylesXml: string): Set<number> {
  const dateFormats = new Set(DATE_NUMBER_FORMATS);
  for (const format of stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)) {
    const id = Number(attribute(format[1]!, 'numFmtId'));
    const code = attribute(format[1]!, 'formatCode') ?? '';
    if (Number.isFinite(id) && /[dmyhs]/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g, ''))) dateFormats.add(id);
  }
  const applied = new Set<number>();
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  [...cellXfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].forEach((xf, index) => {
    if (dateFormats.has(Number(attribute(xf[1]!, 'numFmtId')))) applied.add(index);
  });
  return applied;
}

/** Read every populated sheet of an `.xlsx` workbook. Sheet order and names are
 * taken from the workbook part so tabs read the way they do in Excel. */
export async function readXlsx(bytes: Uint8Array, maxRows = 50_000): Promise<WorkbookSheet[] | null> {
  const archive = openZip(bytes);
  const workbookXml = await archive?.readText('xl/workbook.xml');
  if (!archive || !workbookXml) return null;
  const relationships = new Map<string, string>();
  for (const match of (await archive.readText('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = attribute(match[1]!, 'Id');
    const target = attribute(match[1]!, 'Target');
    if (id && target) relationships.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''));
  }
  const shared = sharedStringValues(await archive.readText('xl/sharedStrings.xml') ?? '');
  const dateStyles = customDateStyles(await archive.readText('xl/styles.xml') ?? '');
  const sheets: WorkbookSheet[] = [];
  const declared = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)];
  for (const [index, match] of declared.entries()) {
    const name = attribute(match[1]!, 'name') ?? `Sheet${index + 1}`;
    const relationshipId = attribute(match[1]!, 'r:id') ?? attribute(match[1]!, 'relationshipId') ?? '';
    const path = relationships.get(relationshipId) ?? `worksheets/sheet${index + 1}.xml`;
    const xml = await archive.readText(`xl/${path}`) ?? await archive.readText(path);
    if (!xml) continue;
    const sheet = parseSheetXml(name, xml, shared, dateStyles, maxRows);
    if (sheet.columns.length) sheets.push(sheet);
  }
  return sheets.length ? sheets : null;
}
