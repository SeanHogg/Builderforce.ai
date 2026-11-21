import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CalendarCell } from '@/lib/builderforceApi';

/**
 * The GitHub-style contribution heat-calendar + its legend (Contributors /
 * Performance tab). A chart, not a row collection. Humans = green, agents =
 * purple, so the calendar visibly distinguishes people from agent hosts.
 *
 * An intensity ramp is ONE hue at four strengths, mixed toward the surface it
 * sits on so it reads in both themes.
 */
const ramp = (hue: string) => [22, 45, 72, 100].map(
  (pct) => `color-mix(in srgb, ${hue} ${pct}%, var(--bg-surface))`,
);
const GREEN = ramp('var(--emerald-bright)');
const PURPLE = ramp('var(--violet-bright)');
const EMPTY = 'var(--border-subtle)';

const CELL = 11;
const GAP = 3;

function cellColor(cell: CalendarCell | null, kind: 'human' | 'agent'): string {
  if (!cell || cell.level <= 0) return EMPTY;
  const pal = kind === 'agent' ? PURPLE : GREEN;
  return pal[Math.min(cell.level, 4) - 1];
}

interface Week {
  days: Array<{ date: string; cell: CalendarCell | null; inRange: boolean }>;
  /** Month index (0–11) to label above this week, or null. */
  month: number | null;
}

function buildWeeks(from: Date, to: Date, cells: CalendarCell[]): Week[] {
  const map = new Map(cells.map((c) => [c.date, c]));
  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back to Sunday
  const end = new Date(to);

  const weeks: Week[] = [];
  const cur = new Date(start);
  let lastMonth = -1;
  while (cur <= end) {
    const days: Week['days'] = [];
    let month: number | null = null;
    for (let d = 0; d < 7; d++) {
      const ds = cur.toISOString().slice(0, 10);
      const inRange = cur >= from && cur <= end;
      if (d === 0) {
        const m = cur.getUTCMonth();
        if (m !== lastMonth && cur.getUTCDate() <= 7) { month = m; lastMonth = m; }
      }
      days.push({ date: ds, cell: map.get(ds) ?? null, inRange });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push({ days, month });
  }
  return weeks;
}

/** Localized short month + weekday names (UTC, so labels match the UTC grid). */
function useCalendarNames() {
  const locale = useLocale();
  return useMemo(() => {
    const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    // 2024-01-01 is a Monday; Jan 1 + 2 / + 4 are Wednesday / Friday.
    const day = (offset: number) => weekday.format(new Date(Date.UTC(2024, 0, 1 + offset)));
    return {
      months: Array.from({ length: 12 }, (_, m) => month.format(new Date(Date.UTC(2024, m, 1)))),
      weekdays: [day(0), day(2), day(4)],
    };
  }, [locale]);
}

export function Heatmap({ from, to, cells, kind }: { from: Date; to: Date; cells: CalendarCell[]; kind: 'human' | 'agent' }) {
  const t = useTranslations('contributors');
  const names = useCalendarNames();
  const weeks = useMemo(() => buildWeeks(from, to, cells), [from, to, cells]);
  const width = weeks.length * (CELL + GAP) + 30;
  const height = 7 * (CELL + GAP) + 20;

  return (
    <svg width={width} height={height} role="img" aria-label={t('calendarAria')} style={{ display: 'block' }}>
      {names.weekdays.map((lbl, i) => (
        <text key={i} x={0} y={20 + (i * 2 + 1) * (CELL + GAP) + CELL} fontSize={9} fill="var(--text-muted)">{lbl}</text>
      ))}
      {weeks.map((week, wi) => (
        <g key={wi} transform={`translate(${30 + wi * (CELL + GAP)}, 18)`}>
          {week.month != null && <text x={0} y={-6} fontSize={9} fill="var(--text-muted)">{names.months[week.month]}</text>}
          {week.days.map((day, di) =>
            day.inRange ? (
              <rect
                key={day.date}
                x={0}
                y={di * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                fill={cellColor(day.cell, kind)}
                stroke="color-mix(in srgb, var(--text-primary) 6%, transparent)"
              >
                <title>{t('tileTitle', { date: day.date, count: day.cell?.count ?? 0 })}</title>
              </rect>
            ) : null,
          )}
        </g>
      ))}
    </svg>
  );
}

export function HeatmapLegend() {
  const t = useTranslations('contributors');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
      <span>{t('legend.less')}</span>
      {[EMPTY, ...GREEN].map((c, i) => (
        <span key={i} style={{ width: CELL, height: CELL, borderRadius: 'var(--radius-sm)', background: c, display: 'inline-block' }} />
      ))}
      <span>{t('legend.more')}</span>
      <span style={{ marginLeft: 12 }}>{t('legend.agents')}</span>
      {PURPLE.map((c, i) => (
        <span key={i} style={{ width: CELL, height: CELL, borderRadius: 'var(--radius-sm)', background: c, display: 'inline-block' }} />
      ))}
    </div>
  );
}
