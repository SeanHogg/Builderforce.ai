'use client';

import { useEffect, useState } from 'react';
import { DeadlineDTO, canRequireSlipReason } from '@/api/deadlines/dto';

// Types mirroring backend DTOs
export interface DeadlineHealth {
  status: 'on_track' | 'at_risk' | 'off_track' | 'missed';
  override?: { status: 'on_track' | 'at_risk' | 'off_track' | 'missed'; reason: string };
  lastEvaluatedAt: string;
}

export interface DeadlineDetail extends DeadlineDTO {
  health: DeadlineHealth;
}

export interface ExecutiveSummary {
  totals: {
    total: number;
    business: number;
    customer: number;
    on_track: number;
    at_risk: number;
    off_track: number;
    missed: number;
  };
  countByType: Array<{ type: 'business' | 'customer'; count: number; percent: number }>;
  expectedTrend: string;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  actor: string;
  field: string;
  oldValue: string;
  newValue: string;
  slipReason?: string | null;
}

const BASE_URL = '/api/deadlines';

export async function fetchDeadlinesByStatus(status?: string): Promise<DeadlineDetail[]> {
  const url = status ? `${BASE_URL}/status?status=${status}` : `${BASE_URL}/timeline`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch deadlines');
  const data = await res.json();
  // Return deadlines array with health merged in
  return (data.timelineView || data.countCombos || []).map((d: any) => ({
    ...d,
    health: {
      status: d.healthOverride || 'on_track',
      override: d.healthOverride ? { status: d.healthOverride!, reason: d.healthOverrideReason || '' } : undefined,
      lastEvaluatedAt: d.updatedAt,
    },
  })) as DeadlineDetail[];
}

export async function fetchExecutiveSummary(): Promise<ExecutiveSummary> {
  const res = await fetch(`${BASE_URL}/executive`);
  if (!res.ok) throw new Error('Failed to fetch executive summary');
  const data = await res.json();
  const counts = data.execSummary as any;
  return {
    totals: {
      total: counts.total || 0,
      business: counts.businessCount || 0,
      customer: counts.customerCount || 0,
      on_track: counts.onTrackCount || 0,
      at_risk: counts.atRiskCount || 0,
      off_track: counts.offTrackCount || 0,
      missed: counts.missedCount || 0,
    },
    countByType: [
      { type: 'business', count: counts.businessCount || 0, percent: counts.businessCount ? Math.round((counts.businessCount / counts.total) * 100) : 0 },
      { type: 'customer', count: counts.customerCount || 0, percent: counts.customerCount ? Math.round((counts.customerCount / counts.total) * 100) : 0 },
    ],
    expectedTrend: 'stable', // Simplified for initial impl
  };
}

export async function fetchCustomerDeadlines(customerTag: string): Promise<DeadlineDetail[]> {
  const res = await fetch(`${BASE_URL}/customer/${customerTag}`);
  if (!res.ok) throw new Error('Failed to fetch customer deadlines');
  const data = await res.json();
  return (data.deadlines || data.countCombos || []).map((d: any) => ({
    ...d,
    health: {
      status: d.healthOverride || 'on_track',
      override: d.healthOverride ? { status: d.healthOverride!, reason: d.healthOverrideReason || '' } : undefined,
      lastEvaluatedAt: d.updatedAt,
    },
  })) as DeadlineDetail[];
}

export async function fetchDeadlineDetail(id: number): Promise<DeadlineDetail> {
  const res = await fetch(`${BASE_URL}/timeline?status=all`);
  if (!res.ok) throw new Error('Failed to fetch deadline detail');
  const data = await res.json();
  const deadline = (data.timelineView || []).find((d: any) => d.id === id);
  if (!deadline) throw new Error('Deadline not found');
  return {
    ...deadline,
    health: {
      status: deadline.healthOverride || 'on_track',
      override: deadline.healthOverride ? { status: deadline.healthOverride!, reason: deadline.healthOverrideReason || '' } : undefined,
      lastEvaluatedAt: deadline.updatedAt,
    },
  };
}

export async function fetchAuditTrail(id: number): Promise<AuditEntry[]> {
  const res = await fetch(`${BASE_URL}/${id}/audit`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.auditLog || [];
}

export function useDeadlineDetail(id: number) {
  const [deadline, setDeadline] = useState<DeadlineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDeadlineDetail(id)
      .then(setDeadline)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return { data: deadline, loading, error };
}

// Create a deadline (ingest)
export async function createDeadline(dto: {
  tenantId?: number;
  projectId?: number;
  title: string;
  type: 'business' | 'customer';
  owner: string;
  dueDate: string | Date;
  priority: 'p1' | 'p2' | 'p3';
  tags: string[];
  description?: string;
  dependents?: number[];
}): Promise<DeadlineDetail> {
  const res = await fetch(`${BASE_URL}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!res.ok) throw new Error('Failed to create deadline');
  const created = await res.json();
  return fetchDeadlineDetail(created.id);
}

// Update a deadline
export async function updateDeadline(id: number, updates: {
  title?: string;
  type?: 'business' | 'customer';
  owner?: string;
  dueDate?: string | Date;
  priority?: 'p1' | 'p2' | 'p3';
  tags?: string[];
  description?: string;
  dependentDeadlineIds?: number[];
  slipReason?: string;
}): Promise<DeadlineDetail> {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update deadline');
  const updated = await res.json();
  return fetchDeadlineDetail(id);
}

export function triggerAlert(id: number, type: 'approaching' | 'status_change'): Promise<void> {
  return fetch(`${BASE_URL}/${id}/alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alertType: type, alertConfig: { channels: ['slack', 'email'] } }),
  })
    .then(() => {})
    .catch(() => {});
}

// Fetch widget overview (embeddable)
export async function fetchWidgetOverview(filters?: Record<string, string>) {
  const query = new URLSearchParams(filters).toString();
  const res = await fetch(`${BASE_URL}/widget${query ? `?${query}` : ''}`);
  if (!res.ok) return { overview: { counts: {} }, healthCounts: {} };
  return res.json();
}