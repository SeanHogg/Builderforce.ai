/**
 * The salary guide's two tables.
 *
 * Both the role page and the city page show a seniority ladder and a city
 * comparison, so both live here rather than being written twice with the columns
 * drifting apart. Server components: they take rows and render, no state.
 *
 * The spread bar marks the MEDIAN rather than implying it from the bar's middle —
 * the number people actually negotiate against is the anchor, which is the whole
 * argument of the article this page serves.
 */
import Link from 'next/link';
import { money, type SalaryBandRow, type SalaryCityRow } from '@/lib/salary';

const wrap: React.CSSProperties = {
  overflowX: 'auto',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-base)',
};
const table: React.CSSProperties = {
  borderCollapse: 'collapse', width: '100%', minWidth: 560,
  fontSize: 'var(--font-size-small)', fontVariantNumeric: 'tabular-nums',
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '11px 14px', whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
  fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
};
const td: React.CSSProperties = {
  padding: '11px 14px', borderBottom: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};

/**
 * Above, below or at the national median — semantic colour, not the accent.
 * Keyed off `Math.sign` rather than a chain of comparisons so the three cases are
 * a lookup instead of nested ternaries.
 */
const VS_NATIONAL_COLOR: Record<number, string> = {
  [-1]: 'var(--warning)',
  [0]: 'var(--text-muted)',
  [1]: 'var(--success)',
};

/** A signed percentage reads as a comparison; an unsigned one reads as a value. */
const signed = (delta: number): string => `${Math.sign(delta) === 1 ? '+' : ''}${delta}%`;

/** Where the median sits between the low and high of the widest row on the page. */
function Spread({ low, median, high, floor, ceiling }: {
  low: number; median: number; high: number; floor: number; ceiling: number;
}) {
  const span = Math.max(1, ceiling - floor);
  const pct = (n: number) => Math.max(0, Math.min(100, ((n - floor) / span) * 100));
  return (
    // Every rounded edge here is a BAR END, not a corner: a 7px track, the band
    // inside it and a 2px median tick. `--radius-full` is what a bar end is on
    // this scale — the literal 4 and 1 they carried were each an eyeballed
    // approximation of a pill at one particular height, which stops being right
    // the moment the height changes.
    <span style={{ position: 'relative', display: 'block', height: 7, minWidth: 110, borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)' }}>
      <span style={{
        position: 'absolute', top: 0, bottom: 0, borderRadius: 'var(--radius-full)',
        left: `${pct(low)}%`, right: `${100 - pct(high)}%`,
        background: 'var(--surface-coral-soft, var(--bg-elevated))',
        border: '1px solid var(--coral-bright)',
      }} />
      <span style={{
        position: 'absolute', top: -2, bottom: -2, width: 2, borderRadius: 'var(--radius-full)',
        left: `${pct(median)}%`, background: 'var(--coral-bright)',
      }} />
    </span>
  );
}

export function SeniorityTable({ rows, currency, labels }: {
  rows: SalaryBandRow[];
  currency: string;
  labels: { seniority: string; low: string; median: string; high: string; spread: string };
}) {
  const floor = Math.min(...rows.map((r) => r.low));
  const ceiling = Math.max(...rows.map((r) => r.high));
  return (
    <div style={wrap}>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>{labels.seniority}</th>
            <th style={th}>{labels.low}</th>
            <th style={th}>{labels.median}</th>
            <th style={th}>{labels.high}</th>
            <th style={{ ...th, width: '34%' }}>{labels.spread}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.seniority}>
              <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 600, textTransform: 'capitalize' }}>{row.seniority}</td>
              <td style={td}>{money(row.low, currency)}</td>
              <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 700 }}>{money(row.median, currency)}</td>
              <td style={td}>{money(row.high, currency)}</td>
              <td style={td}><Spread {...row} floor={floor} ceiling={ceiling} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CityTable({ rows, currency, roleSlug, labels }: {
  rows: SalaryCityRow[];
  currency: string;
  roleSlug: string;
  labels: { city: string; low: string; median: string; high: string; spread: string; vsNational: string };
}) {
  const floor = Math.min(...rows.map((r) => r.low));
  const ceiling = Math.max(...rows.map((r) => r.high));
  return (
    <div style={wrap}>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>{labels.city}</th>
            <th style={th}>{labels.low}</th>
            <th style={th}>{labels.median}</th>
            <th style={th}>{labels.high}</th>
            <th style={{ ...th, width: '28%' }}>{labels.spread}</th>
            <th style={th}>{labels.vsNational}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug}>
              <td style={{ ...td, fontWeight: 600 }}>
                <Link href={`/salary/${roleSlug}/${row.slug}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                  {row.name}
                </Link>
                <span style={{ display: 'block', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {row.region}
                </span>
              </td>
              <td style={td}>{money(row.low, currency)}</td>
              <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 700 }}>{money(row.median, currency)}</td>
              <td style={td}>{money(row.high, currency)}</td>
              <td style={td}><Spread {...row} floor={floor} ceiling={ceiling} /></td>
              <td style={{ ...td, fontWeight: 700, color: VS_NATIONAL_COLOR[Math.sign(row.vsNational)] }}>
                {signed(row.vsNational)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
