import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { capitalizationTables, capitalizationToCsv, capitalizationToXlsx, type ReportTable } from './capitalizationReport';
import type { AllocationHistory, AllocationInsights } from '../insights/allocationInsights';

const history: AllocationHistory = {
  dataAsOf: '2026-06-27T12:00:00.000Z',
  months: [
    {
      month: '2026-06', status: 'in_progress',
      capitalizedFteMonths: 1.25, totalFteMonths: 2.5,
      capitalizedUsd: 120.5, notCapitalizedUsd: 40, uncategorizedUsd: 0, totalUsd: 160.5,
      taskCount: 9, hours: 400, loggedHours: 300, measuredEffortPct: 75,
    },
    {
      month: '2026-05', status: 'ready',
      capitalizedFteMonths: 0.5, totalFteMonths: 1,
      capitalizedUsd: 10, notCapitalizedUsd: 5, uncategorizedUsd: 1, totalUsd: 16,
      taskCount: 4, hours: 160, loggedHours: 0, measuredEffortPct: 0,
    },
  ],
};

const current = {
  epics: [
    {
      epicId: 7, title: 'Payments, "v2"', status: 'capitalized', source: 'manual',
      hours: 210.44, fteMonths: 1.3153, costUsd: 12.345, laborUsd: 9800, ratedHours: 200,
      loggedHours: 180, taskCount: 12, projectName: 'Acme',
    },
  ],
} as unknown as AllocationInsights;

describe('capitalizationTables', () => {
  it('is the one definition both formats render', () => {
    const [months, epics] = capitalizationTables(history, current) as [ReportTable, ReportTable];
    expect(months.title).toBe('Historical months');
    expect(epics.title).toBe('Work capitalization');
    expect(months.rows).toHaveLength(2);
    expect(epics.rows).toHaveLength(1);
  });

  it('keeps cells NUMERIC so a workbook does not need re-parsing', () => {
    const [months] = capitalizationTables(history, current) as [ReportTable, ReportTable];
    const row = months.rows[0]!;
    // capitalized_fte_months, rounded but still a number.
    expect(row[months.columns.indexOf('capitalized_fte_months')]).toBe(1.25);
    expect(typeof row[months.columns.indexOf('total_ai_cost_usd')]).toBe('number');
  });

  it('carries the measured-effort share per month', () => {
    const [months] = capitalizationTables(history, current) as [ReportTable, ReportTable];
    const col = months.columns.indexOf('measured_effort_pct');
    expect(col).toBeGreaterThanOrEqual(0);
    expect(months.rows[0]![col]).toBe(75);
    // Zero, not blank: a month nobody logged time in is 0% measured, and that is
    // the fact the column exists to state.
    expect(months.rows[1]![col]).toBe(0);
  });
});

describe('capitalizationToCsv', () => {
  it('unions both tables behind a section column', () => {
    const lines = capitalizationToCsv(history, current).split('\n');
    expect(lines[0]).toContain('"section"');
    expect(lines[0]).toContain('"measured_effort_pct"');
    expect(lines[0]).toContain('"labor_usd"');
    expect(lines[1]).toContain('"month"');
    expect(lines.at(-1)).toContain('"epic"');
    expect(lines).toHaveLength(1 + 2 + 1);
  });

  it('escapes a quote in an epic title rather than breaking the row', () => {
    const csv = capitalizationToCsv(history, current);
    expect(csv).toContain('"Payments, ""v2"""');
  });

  it('leaves the other table’s columns empty on each row', () => {
    const csv = capitalizationToCsv(history, current).split('\n');
    const header = csv[0]!.split(',').map((h) => h.replace(/"/g, ''));
    const monthCells = csv[1]!.split(',');
    // A month row has no labour figure — that lives at epic grain.
    expect(monthCells[header.indexOf('labor_usd')]).toBe('""');
  });
});

describe('capitalizationToXlsx', () => {
  const files = unzipSync(capitalizationToXlsx(history, current));

  it('writes a two-sheet workbook with both parts declared', () => {
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]));
    const types = strFromU8(files['[Content_Types].xml']!);
    expect(types).toContain('/xl/worksheets/sheet1.xml');
    expect(types).toContain('/xl/worksheets/sheet2.xml');
  });

  it('gives the styles part an rId that no sheet already claims', () => {
    // Two sheets take rId1 and rId2, so styles must be rId3. A hardcoded rId2
    // here is the failure that opens as "unreadable content" with no explanation.
    const rels = strFromU8(files['xl/_rels/workbook.xml.rels']!);
    expect(rels).toContain('Id="rId3"');
    expect(rels).toContain('Target="styles.xml"');
    expect(rels).toContain('Target="worksheets/sheet2.xml"');
  });

  it('names the sheets after the report’s two halves', () => {
    const workbook = strFromU8(files['xl/workbook.xml']!);
    expect(workbook).toContain('name="Historical months"');
    expect(workbook).toContain('name="Work capitalization"');
  });

  it('writes numbers as numbers, not as inline strings', () => {
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<v>1.25</v>');
    expect(sheet).not.toContain('<is><t xml:space="preserve">1.25</t></is>');
  });
});
