'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { Skeleton, Spinner, Alert, Button } from '@/components/dashboard';
import type { Capability } from './capabilityTypes';

/* -------------------------------------------------------------------------- */
/* Capability types & demo data (mocked; backend endpoint /api/capabilities TBD) */
/* -------------------------------------------------------------------------- */

export interface CapabilityRollup {
  healthScore: number; // 0–100
  shipped: number;
  in_progress: number;
  planned: number;
  categoryCounts: Record<string, number>;
}

const MOCK_CAPABILITIES: Capability[] = [
  {
    id: 'cap-1',
    name: 'User Authentication',
    status: 'shipped',
    category: 'Security',
    healthScore: 95,
    lastUpdated: '2026-07-10',
  },
  {
    id: 'cap-2',
    name: 'Project Health Diagnostic',
    status: 'in_progress',
    category: 'Engineering',
    healthScore: 78,
    lastUpdated: '2026-07-12',
  },
  {
    id: 'cap-3',
    name: 'Budget Allocator',
    status: 'planned',
    category: 'Finance',
    healthScore: null,
    lastUpdated: null,
  },
  {
    id: 'cap-4',
    name: 'Agent Assignment Engine',
    status: 'in_progress',
    category: 'Engineering',
    healthScore: 82,
    lastUpdated: '2026-07-13',
  },
  {
    id: 'cap-5',
    name: 'Permissions Manager',
    status: 'shipped',
    category: 'Security',
    healthScore: 90,
    lastUpdated: '2026-07-08',
  },
  {
    id: 'cap-6',
    name: 'Resource Planner',
    status: 'planned',
    category: 'Finance',
    healthScore: null,
    lastUpdated: null,
  },
  {
    id: 'cap-7',
    name: 'Workflow Builder',
    status: 'shipped',
    category: 'Engineering',
    healthScore: 94,
    lastUpdated: '2026-07-05',
  },
  {
    id: 'cap-8',
    name: 'Validation Rules',
    status: 'in_progress',
    category: 'Engineering',
    healthScore: 71,
    lastUpdated: '2026-07-14',
  },
];

const MOCK_ROLLUP: CapabilityRollup = {
  healthScore: 84,
  shipped: 3,
  in_progress: 3,
  planned: 2,
  categoryCounts: {
    Security: 2,
    Engineering: 4,
    Finance: 2,
  },
};

/* -------------------------------------------------------------------------- */
/* Helper components for basic UI (no external shadcn dependency) */
/* -------------------------------------------------------------------------- */

function PillBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-background ${className || ''}`}
    >
      {children}
    </span>
  );
}

function SelectControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: any) => void;
  options: { value: any; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-border bg-background px-3 py-1.5 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function InputControl({ children }: { children: React.ReactNode }) {
  return <div className="inline-block">{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Mock Gauge component (replacing undefined Gauge) */
/* -------------------------------------------------------------------------- */

interface GaugeProps {
  value: number;
  min?: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  trackColor?: string;
  gaugeColors?: { left: string; center: string; right: string };
  textSize?: { fontSize: number };
  textSizeUnit?: string;
  showText?: boolean;
  text?: string;
  animate?: boolean;
  animateSpeed?: number;
  animateOnLoad?: boolean;
  strokeLinecap?: string;
}

function Gauge(props: GaugeProps) {
  const {
    value = 0,
    min = 0,
    max = 100,
    size = 120,
    strokeWidth = 26,
    trackColor = 'hsl(214 32% 20%)',
    gaugeColors = { left: 'hsl(142 72% 51%)', center: '#fbbf24', right: 'hsl(0 80% 50%)' },
    textSize = { fontSize: 64 },
    textSizeUnit = 'px',
    showText = false,
    text,
    animate = true,
    animateSpeed = 1.5,
    animateOnLoad = true,
    strokeLinecap = 'round',
  } = props;

  const frac = min < max ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const cx = size / 2;
  const r = (size - strokeWidth) / 2;
  const cy = r + strokeWidth / 2;
  const angle = (1 - frac) * Math.PI; // 180° sweep, left→right

  return (
    <div
      className="inline-flex flex-col items-center justify-center gap-4"
      style={{ width: `${size + 40}px`, height: `${size + 60}px` }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Health Score">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap={strokeLinecap}
        />
        {animateOnLoad && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${cx + r} ${cy}`}
            fill="none"
            stroke={gaugeColors.left}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeDasharray={((1 - frac) * Math.PI * r * 2).toString()}
            style={{ animation: `draw 1.5s ease-out forwards`, transformOrigin: `${cx}px ${cy}px` }}
          />
        )}
      </svg>
      {showText && text !== undefined && (
        <span
          style={{
            fontSize: textSize.fontSize,
            fontWeight: 700,
            color: gaugeColors.center,
            textAlign: 'center',
          }}
        >
          {text}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mock Chart Stepper/UI for pie/bar charts (replacing undefined CanvasPieChart) */
/* -------------------------------------------------------------------------- */

function PieChart({
  segments,
  size = 200,
  legend = true,
}: {
  segments: { key: string; label: string; value: number; color: string }[];
  size?: number;
  legend?: boolean;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - 40) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  let acc = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = total > 0 ? s.value / total : 0;
      const len = frac * c;
      const dash = `${len} ${c - len}`;
      const offset = -acc * c;
      acc += frac;
      return { ...s, dash, offset, frac };
    });

  return (
    <div
      className="flex items-center gap-4"
      style={{ width: 'fit-content', justifyContent: 'center' }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Status Breakdown">
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={20}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              strokeLinecap="butt"
            />
          ))}
        </g>
      </svg>

      {legend && (
        <div className="flex flex-col gap-2">
          {arcs.map((s) => {
            const frac = total > 0 ? s.value / total : 0;
            return (
              <div key={s.key} className="flex items-center gap-2 text-sm">
                <span
                  className="inline-block min-w-3 h-3 rounded-full bg-current"
                  style={{ color: s.color, background: s.color }}
                />
                <span className="truncate text-text-secondary">{s.label}</span>
                <span className="font-semibold">{Math.round(frac * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BarChart({
  data,
  labelWidth = 100,
  yAxisExtraLabel,
  tooltipSuffix,
  ariaLabel,
}: {
  data: { key: string; label: string; value: number }[];
  labelWidth?: number;
  yAxisExtraLabel?: string;
  tooltipSuffix?: string;
  ariaLabel?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={ariaLabel} className="flex flex-col gap-3">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        const suffix = tooltipSuffix ? ' ' + tooltipSuffix : '';

        return (
          <div key={d.key} className="flex items-center gap-3">
            <span
              className="truncate text-sm text-text-secondary min-w-[labelWidth]"
              style={{ width: `${labelWidth}px` }}
              title={d.label}
            >
              {d.label}
            </span>
            <div className="flex-1 h-6 rounded bg-border-subtle overflow-hidden">
              <div
                className="h-full inline-block transition-[width]"
                style={{ width: `${pct}%`, background: 'var(--chart-color)' }}
              />
            </div>
            <span className="text-sm font-semibold w-14 text-right">{d.value.toLocaleString()}{suffix}</span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Component: CapabilitiesPage */
/* -------------------------------------------------------------------------- */

export default function CapabilitiesPage() {
  const t = useTranslations('capabilities');
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, hasTenant } = useAuth();

  const [mode, setMode] = useState<'dashboard' | 'table' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>(MOCK_CAPABILITIES);
  const [rollup, setRollup] = useState<CapabilityRollup>(MOCK_ROLLUP);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [healthMin, setHealthMin] = useState<number | null>(null);
  const [healthMax, setHealthMax] = useState<number | null>(null);

  // Sorting
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'category' | 'healthScore' | 'lastUpdated'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Loading vs skeleton vs error vs empty
  const loadedWithItems = !loading && capabilities.length > 0;
  const filtered = loadedWithItems
    ? filterCapabilities(capabilities, { status: statusFilter, category: categoryFilter, min: healthMin, max: healthMax })
    : [];
  const sorted = loadedWithItems ? sortCapabilities(filtered, { key: sortBy, order: sortOrder }) : [];
  const isEmpty = loadedWithItems && sorted.length === 0;

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
    else void loadData();
  }, [isAuthenticated, hasTenant, reload]);

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // TODO: migrate to real endpoints
      // const [cRes, rRes] = await Promise.all([
      //   dashboardsApi.request<Capability[]>(`/api/projects/${projectId}/capabilities`),
      //   dashboardsApi.request<CapabilityRollup>(`/api/capabilities/rollup?projectId=${projectId}`)
      // ]);
      // setCapabilities(cRes);
      // setRollup(rRes);
      await new Promise((resolve) => setTimeout(resolve, 800)); // mock latency
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  if (!isAuthenticated) return null;
  if (!hasTenant) {
    return (
      <PageContainer>
        <Alert variant="destructive">Please select a tenant to view this page.</Alert>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer>
        <div className="grid gap-8 sm:grid-cols-2">
          {/* Mock gauge skeleton */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <Skeleton className="h-32 w-full" />
            <div className="mt-2 flex items-center justify-between">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="mt-4 h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-2/4" />
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm col-span-2">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="mt-4 h-6 w-full" />
            <Skeleton className="h-6 w-3/4 mt-2" />
            <Skeleton className="h-6 w-2/4 mt-2" />
          </div>
        </div>

        <div className="mt-8">
          <Skeleton className="mb-4 h-6 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Alert variant="destructive">
          <span className="mr-2">*</span>
          <span>{error}</span>
        </Alert>
        <div className="mt-6 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </PageContainer>
    );
  }

  const statusOptions = [
    { value: 'shipped', label: 'Shipped' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'planned', label: 'Planned' },
    { value: null, label: 'All' },
  ];

  const categoryOptions = [
    { value: 'Engineering', label: 'Engineering' },
    { value: 'Security', label: 'Security' },
    { value: 'Finance', label: 'Finance' },
    { value: null, label: 'All' },
  ];

  const sortByOptions = [
    { value: 'name', label: 'Name' },
    { value: 'status', label: 'Status' },
    { value: 'category', label: 'Category' },
    { value: 'healthScore', label: 'Health Score' },
    { value: 'lastUpdated', label: 'Last Updated' },
  ];

  const sortOrderOptions = [
    { value: 'asc', label: 'Ascending' },
    { value: 'desc', label: 'Descending' },
  ];

  return (
    <PageContainer>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <PillBadge>{t('capabilityCount', { count: capabilities.length })}</PillBadge>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div>
          <label className="text-sm font-semibold text-text-secondary">Status</label>
          <SelectControl value={statusFilter || ''} onChange={(v) => setStatusFilter(v || null)} options={statusOptions} />
        </div>

        <div>
          <label className="text-sm font-semibold text-text-secondary">Category</label>
          <SelectControl value={categoryFilter || ''} onChange={(v) => setCategoryFilter(v || null)} options={categoryOptions} />
        </div>

        <div>
          <label className="text-sm font-semibold text-text-secondary">Health Score Range</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              max={100}
              placeholder="Min"
              value={healthMin || ''}
              onChange={(e) => setHealthMin((e.target.valueAsNumber ?? healthMin) || null)}
              className="rounded border border-border px-2 py-1 text-sm w-16"
            />
            <span className="flex items-center text-text-muted">-</span>
            <input
              type="number"
              min={0}
              max={100}
              placeholder="Max"
              value={healthMax || ''}
              onChange={(e) => setHealthMax((e.target.valueAsNumber ?? healthMax) || null)}
              className="rounded border border-border px-2 py-1 text-sm w-16"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold text-text-secondary">Sort By</label>
          <SelectControl value={sortBy} onChange={setSortBy} options={sortByOptions} />
        </div>

        <div>
          <label className="text-sm font-semibold text-text-secondary">Order</label>
          <SelectControl value={sortOrder} onChange={setSortOrder} options={sortOrderOptions} />
        </div>
      </div>

      {/* Dashboard View */}
      {(mode === 'dashboard' || mode === null) && (
        <div className="grid gap-8 sm:grid-cols-2">
          {/* Health Score Gauge */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Health Score</h2>
            <div className="flex items-center justify-center">
              <Gauge
                value={rollup.healthScore}
                min={0}
                max={100}
                size={200}
                strokeWidth={30}
                gaugeColors={{ left: '#22c55e', center: '#eab308', right: '#ef4444' }}
                textSize={{ fontSize: 72 }}
                showText
                text={String(rollup.healthScore)}
                animateOnLoad={true}
              />
            </div>
            <div className="mt-4 text-center text-text-muted text-sm">
              A composite score based on capability delivery and health
            </div>
          </div>

          {/* Status Breakdown */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Status Breakdown</h2>
            <PieChart
              segments={[
                { key: 'shipped', label: 'Shipped', value: rollup.shipped || 0, color: '#22c55e' },
                { key: 'in_progress', label: 'In Progress', value: rollup.in_progress || 0, color: '#eab308' },
                { key: 'planned', label: 'Planned', value: rollup.planned || 0, color: '#6b7280' },
              ]}
              size={200}
            />
          </div>

          {/* Category Breakdown */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm col-span-2">
            <h2 className="mb-4 text-lg font-semibold">By Category</h2>
            <BarChart
              data={Object.keys(rollup.categoryCounts).map((cat) => ({
                key: cat,
                label: cat,
                value: rollup.categoryCounts[cat] || 0,
              }))}
              labelWidth={120}
              yAxisExtraLabel="Capabilities"
              tooltipSuffix="items"
              ariaLabel="Category breakdown"
            />
          </div>
        </div>
      )}

      {/* Table View */}
      {mode === 'table' && (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-4 py-3 text-left text-sm font-semibold">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Category</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Health Score</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((cap) => (
                  <tr key={cap.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 text-sm">{cap.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold text-background capitalize">
                        {cap.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{cap.category || '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      {cap.healthScore !== null ? `${cap.healthScore}%` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">{cap.lastUpdated || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length === 0 && (
            <div className="p-8 text-center text-text-muted">No capabilities match your filters</div>
          )}
        </div>
      )}

      {/* Empty State */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Alert variant="info" className="mb-4 max-w-md">
            <span className="mr-2">*</span>
            {t('noCapabilitiesFound')}
          </Alert>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Clear Filters
          </Button>
        </div>
      )}

      {/* Footer / mode switch */}
      <div className="mt-8 flex justify-center gap-4">
        <Button
          variant={mode === 'dashboard' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode(mode === 'dashboard' ? null : 'dashboard')}
        >
          {mode === 'dashboard' ? 'Switch to Table' : 'Switch to Dashboard'}
        </Button>

        <Button
          variant={mode === 'table' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode(mode === 'table' ? null : 'table')}
        >
          {mode === 'table' ? 'Switch to Dashboard' : 'Switch to Table'}
        </Button>
      </div>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers: filter, sort, etc. */
/* -------------------------------------------------------------------------- */

interface FilterOptions {
  status: string | null;
  category: string | null;
  min: number | null;
  max: number | null;
}

function filterCapabilities(items: Capability[], opts: FilterOptions): Capability[] {
  return items.filter((item) => {
    if (opts.status && item.status !== opts.status) return false;
    if (opts.category && item.category && item.category !== opts.category) return false;
    if (opts.min != null && (item.healthScore ?? 0) < opts.min) return false;
    if (opts.max != null && (item.healthScore ?? 0) > opts.max) return false;
    return true;
  });
}

function sortCapabilities(
  items: Capability[],
  opts: { key: 'name' | 'status' | 'category' | 'healthScore' | 'lastUpdated'; order: 'asc' | 'desc' }
): Capability[] {
  return [...items].sort((a, b) => {
    let left: any;
    let right: any;
    switch (opts.key) {
      case 'name':
        left = a.name.toLowerCase();
        right = b.name.toLowerCase();
        break;
      case 'status':
        left = a.status;
        right = b.status;
        break;
      case 'category':
        left = (a.category ?? '').toLowerCase();
        right = (b.category ?? '').toLowerCase();
        break;
      case 'healthScore':
        left = a.healthScore ?? 0;
        right = b.healthScore ?? 0;
        break;
      case 'lastUpdated':
        left = a.lastUpdated ?? '';
        right = b.lastUpdated ?? '';
        break;
    }
    if (left < right) return opts.order === 'asc' ? -1 : 1;
    if (left > right) return opts.order === 'asc' ? 1 : -1;
    return 0;
  });
}