'use client';

import { useState, useEffect } from 'react';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { CapabilityRow } from './CapabilityRow';
import { getCapabilityRollup, getCapabilities } from '@/app/insights/capabilitiesApi';
import type {
  Capability,
  CapabilityStatus,
  CapabilityRollup,
} from '@/app/insights/capabilityTypes';

type LaunchParams = { projectId: string };

export function CapabilitiesDashboard({ projectId }: LaunchParams) {
  const [rollup, setRollup] = useState<CapabilityRollup | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'success'>('loading');
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterStatus, setFilterStatus] = useState<CapabilityStatus | 'all'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [sortKey, setSortKey] = useState<keyof Capability>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Toggle chart view state
  const [showBarForStatus, setShowBarForStatus] = useState(false);
  const [showBarForCategory, setShowBarForCategory] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setStatus('loading');
        setError(null);

        const [rollupData, capabilitiesData] = await Promise.all([
          getCapabilityRollup(projectId),
          getCapabilities(projectId),
        ]);

        setRollup(rollupData);
        setCapabilities(capabilitiesData);
        setStatus('success');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load capabilities');
        setStatus('error');
      }
    };

    void loadData();
  }, [projectId]);

  // Filtered and sorted capabilities
  const filteredCapabilities = useMemo(() => {
    let result = capabilities;

    // Apply status filter
    if (filterStatus !== 'all') {
      result = result.filter((c) => c.status === filterStatus);
    }

    // Apply category filter
    if (filterCategory !== 'all') {
      result = result.filter((c) => c.category === filterCategory);
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortKey === 'lastUpdated') {
        return sortDirection === 'asc'
          ? new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime()
          : new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
      }
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    return result;
  }, [capabilities, filterStatus, filterCategory, sortKey, sortDirection]);

  // Fetch categories list for filter dropdown
  const categories = useMemo(() => {
    return Array.from(new Set(capabilities.map((c) => c.category)));
  }, [capabilities]);

  // Get status colors
  const getStatusColor = (score: number) => {
    if (score >= 80) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  };

  // Get gauge color based on health score
  const getGaugeColor = (score: number) => {
    if (score >= 80) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  };

  // Calculate total capabilities for bar chart calculations
  const totalCapabilities = rollup.statusBreakdown.shipped + rollup.statusBreakdown.in_progress + rollup.statusBreakdown.planned;

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Capabilities Dashboard</h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginTop: 6 }}>
          Visualizing project capability health, progress distribution, and category breakdown.
        </p>
      </div>

      {/* Error State */}
      {status === 'error' && error && (
        <div
          style={{
            padding: '16px',
            background: 'var(--danger, #fde8e8)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            color: 'var(--danger, #b91c1c)',
            marginBottom: 16,
          }}
        >
          <p>{error}</p>
          <button
            onClick={() => void loadData()}
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: 'var(--danger, #ef4444)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {status === 'loading' && (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-elevated)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 12,
          }}
        >
          <p>Loading capabilities data...</p>
        </div>
      )}

      {/* Success State */}
      {status === 'success' && rollup && (
        <>
          {/* Health Score Gauge */}
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: '24px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 32,
            }}
          >
            <div>
              <GaugeChart
                value={rollup.healthScore}
                min={0}
                max={100}
                color={getGaugeColor(rollup.healthScore)}
                size={140}
                centerValue={rollup.healthScore.toString()}
                centerLabel="Health Score"
                ariaLabel="Project health score gauge"
              />
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: 0 }}>Project Health</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                Overall capability health score based on shipped, in_progress, and planned capabilities.
              </p>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                    color: '#22c55e',
                  }}
                >
                  <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: 2 }} />
                  <span>Shipped: {rollup.statusBreakdown.shipped}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                    color: '#f59e0b',
                  }}
                >
                  <span style={{ width: 8, height: 8, background: '#f59e0b', borderRadius: 2 }} />
                  <span>In Progress: {rollup.statusBreakdown.in_progress}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: '#ef4444',
                  }}
                >
                  <span style={{ width: 8, height: 8, background: '#ef4444', borderRadius: 2 }} />
                  <span>Planned: {rollup.statusBreakdown.planned}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Charts Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            {/* Status Breakdown */}
            <div
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: '20px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                }}
              >
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 0 }}>Status Breakdown</h3>
                <button
                  onClick={() => setShowBarForStatus(!showBarForStatus)}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  {showBarForStatus ? 'Switch to Pie' : 'Switch to Bar'}
                </button>
              </div>

              {showBarForStatus ? (
                <div
                  style={{
                    height: 200,
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-around',
                    padding: '16px 0',
                  }}
                >
                  {/* Bar for shipped */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 48,
                        background: '#22c55e',
                        borderRadius: 4,
                        minHeight: `${Math.max(20, (rollup.statusBreakdown.shipped / totalCapabilities) * 100)}%`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {rollup.statusBreakdown.shipped} ({Math.round((rollup.statusBreakdown.shipped / totalCapabilities) * 100)}%)
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Shipped</span>
                  </div>

                  {/* Bar for in_progress */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 48,
                        background: '#f59e0b',
                        borderRadius: 4,
                        minHeight: `${Math.max(20, (rollup.statusBreakdown.in_progress / totalCapabilities) * 100)}%`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {rollup.statusBreakdown.in_progress} ({Math.round((rollup.statusBreakdown.in_progress / totalCapabilities) * 100)}%)
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>In Progress</span>
                  </div>

                  {/* Bar for planned */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 48,
                        background: '#ef4444',
                        borderRadius: 4,
                        minHeight: `${Math.max(20, (rollup.statusBreakdown.planned / totalCapabilities) * 100)}%`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {rollup.statusBreakdown.planned} ({Math.round((rollup.statusBreakdown.planned / totalCapabilities) * 100)}%)
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Planned</span>
                  </div>
                </div>
              ) : (
                <DonutChart
                  segments={[
                    {
                      key: 'shipped',
                      label: 'Shipped',
                      value: rollup.statusBreakdown.shipped,
                      color: '#22c55e',
                    },
                    {
                      key: 'in_progress',
                      label: 'In Progress',
                      value: rollup.statusBreakdown.in_progress,
                      color: '#f59e0b',
                    },
                    {
                      key: 'planned',
                      label: 'Planned',
                      value: rollup.statusBreakdown.planned,
                      color: '#ef4444',
                    },
                  ]}
                  ariaLabel="Capability status breakdown"
                />
              )}
            </div>

            {/* Category Breakdown */}
            <div
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: '20px',
              }}
            >
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 0 }}>Category Breakdown</h3>
              <DonutChart
                segments={Object.entries(rollup.categoryBreakdown)
                  .filter(([_, value]) => value > 0)
                  .map(([key, value], i) => ({
                    key,
                    label: key,
                    value,
                    color: `var(--coral-bright, #4d9eff)`,
                  }))}
                ariaLabel="Capability category distribution"
                legend={true}
              />
            </div>
          </div>

          {/* Capabilities Table */}
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: '20px',
            }}
          >
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 0 }}>Capabilities List</h3>

            {/* Filters */}
            <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Status Filter */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status:</span>
                <button
                  onClick={() => setFilterStatus(filterStatus === 'all' ? 'all' : 'all')}
                  style={{
                    padding: '6px 12px',
                    background: filterStatus === 'all' ? 'var(--coral-bright, #4d9eff)' : 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    color: filterStatus === 'all' ? '#fff' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  All
                </button>
                {(['shipped', 'in_progress', 'planned'] as CapabilityStatus[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(filterStatus === status ? 'all' : status)}
                    style={{
                      padding: '6px 12px',
                      background: filterStatus === status ? 'var(--coral-bright, #4d9eff)' : 'var(--bg-base)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      color: filterStatus === status ? '#fff' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>

              {/* Category Filter */}
              {categories.length > 0 && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Category:</span>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-base)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="all">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Sort */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Sort by:</span>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as keyof Capability)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-base)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  <option value="name">Name</option>
                  <option value="status">Status</option>
                  <option value="category">Category</option>
                  <option value="healthScore">Health Score</option>
                  <option value="lastUpdated">Last Updated</option>
                </select>
                <button
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                  aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>

            {/* Table */}
            {filteredCapabilities.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-base)',
                  borderRadius: 8,
                  marginTop: 12,
                }}
              >
                <p>No capabilities found matching your filters.</p>
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1.2fr 120px 140px',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'var(--border-subtle)',
                    borderRadius: 6,
                    marginTop: 12,
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
              }
              }
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Name
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>Status</div>
                <div style={{ display: 'flex', alignItems: 'center' }}>Category</div>
                <div style={{ display: 'flex', alignItems: 'center' }}>Health Score</div>
                <div style={{ display: 'flex', alignItems: 'center' }}>Last Updated</div>
              </div>

              {/* Table Body */}
              <div style={{ minHeight: filterCategory === 'all' && filterStatus === 'all' ? 300 : 0 }}>
                {filteredCapabilities.map((cap) => (
                  <CapabilityRow key={cap.id} capability={cap} />
                ))}
              </div>

              {/* Footer */}
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-subtle)',
                  textAlign: 'center',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                }}
              >
                Showing {filteredCapabilities.length} capability{filteredCapabilities.length !== 1 ? 's' : ''}
              </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}