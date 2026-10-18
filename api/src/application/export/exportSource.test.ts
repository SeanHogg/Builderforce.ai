import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  EXPORT_FORMATS,
  renderExport,
  resolveExportFormat,
  serializeExport,
  type ExportResult,
  type TenantExportSource,
} from './exportSource';
import { downloadResponse } from './exportDownload';
import { listExportSources, getExportSource } from './exportSources';
import { TenantRole } from '../../domain/shared/types';

const RESULT: ExportResult = {
  filename: 'demo-2026-10-17',
  title: 'Demo',
  table: {
    columns: ['name', 'amount', 'when', 'meta'],
    rows: [
      ['Payments, "v2"', 12.5, new Date('2026-10-17T00:00:00.000Z'), { a: 1 }],
      [null, 0, null, null],
    ],
  },
};

describe('serializeExport — the ONE serialiser every source goes through', () => {
  it('csv quotes every cell, doubles inner quotes, renders dates as ISO and objects as JSON', () => {
    const csv = serializeExport(RESULT, 'csv', 0) as string;
    const [header, first, second] = csv.split('\n');
    expect(header).toBe('"name","amount","when","meta"');
    expect(first).toBe('"Payments, ""v2""","12.5","2026-10-17T00:00:00.000Z","{""a"":1}"');
    expect(second).toBe('"","0","",""');
  });

  it('html escapes markup and titles the document', () => {
    const html = serializeExport({ ...RESULT, table: { columns: ['x'], rows: [['<b>&</b>']] } }, 'html', 0) as string;
    expect(html).toContain('<title>Demo</title>');
    expect(html).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('xlsx writes one sheet from the table, or one per supplied sheet', () => {
    const one = unzipSync(serializeExport(RESULT, 'xlsx', 0) as Uint8Array);
    expect(Object.keys(one)).toContain('xl/worksheets/sheet1.xml');
    expect(Object.keys(one)).not.toContain('xl/worksheets/sheet2.xml');

    const two = unzipSync(serializeExport({
      ...RESULT,
      sheets: [{ title: 'A', columns: ['a'], rows: [[1]] }, { title: 'B', columns: ['b'], rows: [[2]] }],
    }, 'xlsx', 0) as Uint8Array);
    const workbook = strFromU8(two['xl/workbook.xml']!);
    expect(workbook).toContain('name="A"');
    expect(workbook).toContain('name="B"');
  });

  it('json is the source snapshot when given, else a generic { columns, rows } envelope', () => {
    expect(JSON.parse(serializeExport({ ...RESULT, json: { members: [1] } }, 'json', 0) as string)).toEqual({ members: [1] });
    const generic = JSON.parse(serializeExport(RESULT, 'json', 0) as string);
    expect(generic.columns).toEqual(['name', 'amount', 'when', 'meta']);
    expect(generic.generatedAt).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('resolveExportFormat', () => {
  const source = { formats: ['csv', 'json'] } as unknown as TenantExportSource;
  it('accepts a declared format and falls back to the first for anything else', () => {
    expect(resolveExportFormat(source, 'json')).toBe('json');
    expect(resolveExportFormat(source, 'xlsx')).toBe('csv');
    expect(resolveExportFormat(source, undefined)).toBe('csv');
  });
});

describe('renderExport / downloadResponse — the one download response', () => {
  it('names the file from the stem + format and saves it as an attachment, uncached', () => {
    const res = renderExport(RESULT, 'csv', 0);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="demo-2026-10-17.csv"');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves JSON inline so a script (or a browser tab) reads it like the old c.json body', () => {
    const res = renderExport(RESULT, 'json', 0);
    expect(res.headers.get('content-disposition')).toBe('inline; filename="demo-2026-10-17.json"');
  });

  it('strips quotes and newlines from a filename so the header cannot be broken', () => {
    const res = downloadResponse('x', { filename: 'a"b\r\nc.txt', contentType: 'text/plain' });
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="abc.txt"');
  });

  it('carries route-specific headers and an explicit cache policy', () => {
    const res = downloadResponse(new Uint8Array([1, 2]), {
      filename: 'i.pdf', contentType: 'pdf', disposition: 'inline', cacheControl: 'private, no-store', headers: { 'x-extra': '1' },
    });
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-extra')).toBe('1');
  });
});

describe('the export-source registry', () => {
  const sources = listExportSources();

  it('has unique, namespaced ids that resolve back to their source', () => {
    const ids = sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of sources) {
      expect(s.id).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
      expect(getExportSource(s.id)).toBe(s);
    }
  });

  it('declares only formats the renderer can produce, and an explicit gate for every tenant source', () => {
    for (const s of sources) {
      for (const f of s.formats) expect(EXPORT_FORMATS).toContain(f);
      if (s.scope === 'tenant') expect(Object.values(TenantRole)).toContain(s.minRole);
    }
  });

  it('keeps the premium insight downloads behind the same plan flag as their lenses', () => {
    expect(getExportSource('insights.capitalization')).toMatchObject({ scope: 'tenant', planFeature: 'advancedInsights' });
    expect(getExportSource('insights.evidence-pack')).toMatchObject({ scope: 'tenant', planFeature: 'advancedInsights' });
  });

  it('keeps the operator exports platform-scoped (superadmin gate), never tenant-pullable', () => {
    expect(getExportSource('admin.audit-log')?.scope).toBe('platform');
    expect(getExportSource('admin.permission-matrix')?.scope).toBe('platform');
  });
});
