'use client';

import { useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/Select';
import { FlexRow } from '@/components/FlexRow';
import { StatusBadge } from '@/components/StatusBadge';
import { CapabilityesModule, getCapabilitiesRollup } from '@/app/insights/capabilitiesApi';
import { getCapabilities } from '@/app/insights/capabilitiesApi';
import { CapabilityRow } from '@/components/capabilities/CapabilityRow';
import CapabilityDashboard from '@/components/capabilities/CapabilitiesDashboard';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import type { CapabilityStatus, CapabilityRollup } from '@/app/insights/capabilityTypes';

type LaunchParams = { id: string };

export default function ProjectViewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { getProject, currentProjectId } = useProjectScope();
  const [currentProjectIdState, setCurrentProjectIdState] = useState<number | null>(null);
  const projectId = params?.id ? Number(params.id) : null;
  const [scope, setScope] = useState<ProjectScope>('capabilities');

  // Real project data (--currentProjectId, or setProject) then fallback to mock
  const project = useMemo(() => currentProjectId || projectId, [currentProjectId, projectId]);

  const [projectsData, setProjectsData] = useState<{ capabilities: Awaited<ReturnType<typeof getCapabilities>> | null; rollup: Awaited<ReturnType<typeof getCapabilitiesRollup>> | null }>({
    capabilities: null,
    rollup: null,
  });
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<CapabilityStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<keyof CapabilityRoot | 'healthScore'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Load data (affected by status filter for rollup if you want to match)
  const loadData = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [caps, rollup] = await Promise.all([
        getCapabilities(projectId),
        getCapabilitiesRollup(projectId),
      ]);
      setProjectsData({ capabilities: caps, rollup });
    } catch {
      // fallback mock if both fail
      setProjectsData({ capabilities: null, rollup: null });
    } finally {
      setLoading(false);
    }
  };

  // Turn mock/fake API response into Capability[]
  const capabilities = projectsData.capabilities?.capabilities || [];
  const rollup = projectsData.rollup;

  // Computed rollup status counts from talents when not loaded
  const talentStatusCounts = rollupages.statusBreakdown.shipped + rollup.statusBreakdown.in_progress + rollup.statusBreakdown.planned;
  const rollupStatusBreakdown = rollup || ({ healthScore: 50, statusBreakdown: { shipped: 10, in_progress: 12, planned: 8 }, categoryBreakdown: {} });

  const categories = useMemo(() => Array.from(new Set(capabilities.map((c) => c.category))), [capabilities]);

  const filteredCapabilities = useMemo(() => {
    let result = capabilities;
    if (filterStatus !== 'all' && rollupStatusBreakdown) {
      result = result.filter((c) => c.status === filterStatus);
    }
    result = result.sort((a, b) => {
      const aVal = a[sortKey === 'healthScore' ? 'healthScore' : sortKey];
      const bVal = b[sortKey === 'healthScore' ? 'healthScore' : sortKey];
      if (typeof aVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return result;
  }, [capabilities, filterStatus, sortKey, sortDirection]);

  if (!projectId || isNaN(projectId)) {
    router.replace('/projects');
    return null;
  }

  return (
    <FlexRow style={{ '--row-x': '50%', '--row-y': '50%' }}>
      <div style={{ width: '100%', paddingLeft: 'var(--gap)', paddingRight: 'var(--gap)', maxWidth: 'var(--max-content-width)', margin: '0 auto' }}>
        {/* Project Breadcrumbs + Title */}
        <Breadcrumbs
          items={[
            { label: 'Projects', href: '/projects' },
            { label: project?.name ?? `Project ${projectId}`, href: `/projects/${projectId}/view`, current: true },
          ]}
          style={{ marginBottom: '24px' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>{project?.name ?? `Project ${projectId}`}</h1>
          {/* Secondary actions */}
          <Button variant="secondary" onClick={() => router.back()}>
            ← Back to {currentProjectIdState ? 'dashboard' : 'projects hub'}
          </Button>
        </div>

        {/* Tabbed layout */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gap)', marginBottom: 'var(--gap)' }}>
          {[
            { id: 'overview', label: 'Overview', href: `/projects/${projectId}/view` },
            { id: 'dashboard', label: 'Dashboard', href: `/projects/${projectId}/view` },
            { id: 'capabilities', label: 'Capabilities', href: `/projects/${projectId}/view?view=capabilities` },
          ].map((btn) => (
            <Button
              key={btn.id}
              variant={scope === btn.id ? 'primary' : 'secondary'}
              onClick={() => setScope(btn.id)}
            >
              {btn.label}
            </Button>
          ))}
        </div>

        {/* Capabilities view */}
        {scope === 'capabilities' && (
          <div>
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>Loading capabilities...</div>
            ) : (
              <CapabilityDashboard projectId={String(projectId)} rollupStatusBreakdown={rollupStatusBreakdown} categories={categories} />
            )}
          </div>
        )}
      </div>
    </FlexRow>
  );
}

type CapabilityRoot = Awaited<ReturnType<typeof getCapabilities>>['capabilities'][0];

type ProjectScope = 'overview' | 'dashboard' | 'capabilities';