'use client';

/** /insights/capabilities — Capabilities Dashboard (capabilities + health breakdown) */
import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import CapabilityCard from '@/components/insights/capabilities/CapabilityCard';
import { Skeleton, Spinner, Alert, Button, PillBadge } from '@/apps/builderforce/ui-shadcn';
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
/* Component: CapabilityCard (reuse via CapabilityCard + Canvas charts) */
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
  const filtered = loadedWithItems
    ? filterCapabilities(capabilities, { status: statusFilter, category: categoryFilter, min: healthMin, max: healthMax })
    : [];
  const sorted = loadedWithItems ? sortCapabilities(filtered, { key: sortBy, order: sortOrder }) : [];
  const isEmpty = loadedWithItems && sorted.length === 0;

  const loadedWithItems = !loading && capabilities.length > 0;

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
      // On mock success:
      // resetFilters(); // optional: clear filters on reload
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
        <Alert variant="destructive">
          Please select a tenant to view this page.
        </Alert>
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
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm col-span-2">
            <Skeleton className="h-40 w-full" />
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
          <Button variant="outline" size="sm" onClick={() => setPathForReload(pathname)}>
            重试
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <PillBadge className="font-semibold text-background">
          {t('capabilityCount', { count: capabilities.length })}
        </PillBadge>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        <BlurBackdrop onFocusBlurb sx={{ pb: 1, mb: -1.5 }}>
          <FieldLabel title="状态" pillWidth={100}>
            <SelectControl
              value={statusFilter}
              onChange={(t) => {
                setStatusFilter(t || null);
              }}
              options={[
                { value: 'shipped', label: '已交付' },
                { value: 'in_progress', label: '进行中' },
                { value: 'planned', label: '计划中' },
                { value: null, label: '全部' },
              ]}
            />
          </FieldLabel>
        </BlurBackdrop>

        <BlurBackdrop onFocusBlurb sx={{ pb: 1, mb: -1.5 }}>
          <FieldLabel title="类别" pillWidth={100}>
            <SelectControl
              value={categoryFilter}
              onChange={(t) => {
                setCategoryFilter(t || null);
              }}
              options={[
                { value: 'Engineering', label: '工程' },
                { value: 'Security', label: '安全' },
                { value: 'Finance', label: '财务' },
                { value: null, label: '全部' },
              ]}
            />
          </FieldLabel>
        </BlurBackdrop>

        <BlurBackdrop onFocusBlurb sx={{ pb: 1, mb: -1.5 }}>
          <FieldLabel title="健康分" pillWidth={100}>
            <div className="flex gap-2">
              <BlurBackdrop onFocusBlurb sx={{ pb: 1, mb: -1.5 }}>
                <InputControl width={80}>
                  <Input
                    type="number"
                    placeholder="最小"
                    value={healthMin || ''}
                    onChange={(e) => setHealthMin((e.target.valueAsNumber ?? healthMin) || null)}
                    className="w-full"
                  />
                </InputControl>
              </BlurBackdrop>
              <BlurBackdrop onFocusBlurb sx={{ pb: 1, mb: -1.5 }}>
                <InputControl width={80}>
                  <Input
                    type="number"
                    placeholder="最大"
                    value={healthMax || ''}
                    onChange={(e) => setHealthMax((e.target.valueAsNumber ?? healthMax) || null)}
                    className="w-full"
                  />
                </InputControl>
              </BlurBackdrop>
            </div>
          </FieldLabel>
        </BlurBackdrop>

        <Bl窗户Backdrop onFocusBlurb sx={{ pb: 1, mb: -1.5 }}>
          <FieldLabel title="排序" pillWidth={130}>
            <SelectControl
              value={sortBy}
              onChange={(t) => {
                setSortBy(t as typeof sortBy);
              }}
              options={[
                { value: 'name', label: '名称' },
                { value: 'status', label: '状态' },
                { value: 'category', label: '类别' },
                { value: 'healthScore', label: '健康分' },
                { value: 'lastUpdated', label: '最后更新' },
              ]}
            />
          </FieldLabel>
        </BlurBackdrop>

        <BlurBackdrop onFocusBlurb sx={{ pb: 1, mb: -1.5 }}>
          <FieldLabel title="方向" pillWidth={60}>
            <SelectControl
              value={sortOrder}
              onChange={(t) => {
                setSortOrder(t as 'asc' | 'desc');
              }}
              options={[{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]}
            />
          </FieldLabel>
        </BlurBackdrop>
      </div>

      {(mode === 'dashboard' || mode === null) && (
        <div className="grid gap-8 sm:grid-cols-2">
          {/* Health Score Gauge */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-5 text-lg font-semibold">{t('healthScore')}</h2>
            {/* TA: HealthGauge gauge */}
            <div>
              <Gauge
                value={rollup.healthScore}
                min={0}
                max={100}
                size={240}
                strokeWidth={26}
                trackColor="hsl(214 32% 20%)"
                gaugeColors={{ left: 'hsl(142 72% 51%)', center: '#fbbf24', right: 'hsl(0 80% 50%)' }}
                textSize={{ fontSize: 64 }}
                textSizeUnit="px"
                showText={true}
                text={String(rollup.healthScore)}
                animate={true}
                animateSpeed={1.5}
                animateOnLoad={true}
                strokeLinecap="round"
              />
            </div>
          </div>

          {/* Status Breakdown */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-5 text-lg font-semibold">{t('statusBreakdown')}</h2>
            <CanvasPieChart
              keys={['shipped', 'in_progress', 'planned']}
              values={rollup}
              defaultValue={0}
            />
          </div>

          {/* Category Breakdown */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm col-span-2">
            <h2 className="mb-5 text-lg font-semibold">按类别</h2>
            <CanvasBarChart
              categories={Object.keys(rollup.categoryCounts)}
              counts={Object.values(rollup.categoryCounts)}
              yAxisExtraLabel={'能力数'}
              tooltipSuffix={'项'}
            />
          </div>
        </div>
      )}

      {/* Table view */}
      {mode === 'table' && (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <CapabilityTable
            capabilities={sorted}
            onSave={(c) => {
              setCapabilities((prev) =>
                prev.map((item) => (item.id === c.id ? { ...item, ...c } : item))
              );
            }}
          />
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Alert variant="info" className="mb-4 max-w-md">
            <span className="mr-2">*</span>
            {t('noCapabilitiesFound')}
          </Alert>
          <Button variant="outline" size="sm" onClick={() => setPathForReload(pathname)}>
            {t('tryAnotherFilters')}
          </Button>
        </div>
      )}

      {/* Footer / mode switch */}
      <div className="mt-8 flex justify-center">
        <div className="flex items-center gap-4">
          <Button
            variant={mode === 'dashboard' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode(mode === 'dashboard' ? null : 'dashboard')}
          >
            {/* TA: 当前视图: */}
            {mode === 'dashboard' ? '返回概览' : '概览'}
          </Button>

          <Button
            variant={mode === 'table' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode(mode === 'table' ? null : 'table')}
          >
            {/* TA: 切换至表格视图: */}
            {mode === 'table' ? '返回概览' : '表格'}
          </Button>
        </div>
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

function filterCapabilities(
  items: Capability[],
  opts: FilterOptions
): Capability[] {
  return items.filter((item) => {
    if (opts.status && item.status !== opts.status) return false;
    if (opts.category && item.category !== opts.category) return false;
    if (opts.min != null && (item.healthScore ?? 0) < opts.min) return false;
    if (opts.max != null && (item.healthScore ?? 0) > opts.max) return false;
    return true;
  });
}

function sortCapabilities(
  items: Capability[],
  opts: {
    key: 'name' | 'status' | 'category' | 'healthScore' | 'lastUpdated';
    order: 'asc' | 'desc';
  }
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

function setPathForReload(pathname: string | null): void {
  // optional; router.replace(`/insights/capabilities`) on next call
  if (pathname) {
    // ToolInvocation not provided; omitted SSR-safe router.replace.
  }
}