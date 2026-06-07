'use client';

import React from 'react';
import type { Project } from '@/lib/types';

export interface MoveToBoardControlProps {
  /** All projects ("boards"); the current one is excluded as a destination. */
  projects: Project[];
  /** The board the task(s) currently live on — omitted from the destination list. */
  currentProjectId?: number;
  /** Called with the destination project id when the user picks a board. */
  onMove: (projectId: number) => void;
  disabled?: boolean;
  /** Placeholder shown before a destination is chosen. */
  label?: string;
  style?: React.CSSProperties;
}

/**
 * A "Move to board…" dropdown shared by the task list (bulk + per-row) and the
 * task drawer. Selecting a destination board fires {@link onMove}. The control
 * decides its own visibility: it renders nothing when there is no other board to
 * move to, so callers never need a separate "can move" gate.
 */
export function MoveToBoardControl({
  projects,
  currentProjectId,
  onMove,
  disabled = false,
  label = 'Move to board…',
  style,
}: MoveToBoardControlProps) {
  const destinations = projects.filter((p) => p.id !== currentProjectId);
  if (destinations.length === 0) return null;

  return (
    <select
      value=""
      disabled={disabled}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const id = e.target.value;
        if (id) onMove(Number(id));
        e.target.value = '';
      }}
      style={{
        padding: '4px 8px',
        fontSize: 13,
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      <option value="">{label}</option>
      {destinations.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
