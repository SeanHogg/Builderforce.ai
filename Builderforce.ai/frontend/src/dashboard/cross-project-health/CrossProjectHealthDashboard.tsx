'use client';

import React, { useState } from 'react';
import styles from './CrossProjectHealthDashboard.module.css';

/* ─── Public interface (PRD §1) ──────────────────────────────────────────── */

export interface ProjectHealth {
  id: string;
  name: string;
  status: string; // expected: "On Track" | "At Risk" | "Off Track"
  riskLevel: string; // expected: "Low" | "Medium" | "High"
  keyBlocker: string | null;
  recommendation: string | null;
}

export interface CrossProjectHealthDashboardProps {
  projects: ProjectHealth[];
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const VALID_STATUSES = new Set(['On Track', 'At Risk', 'Off Track'] as const);
const VALID_RISK_LEVELS = new Set(['Low', 'Medium', 'High'] as const);

function normaliseStatus(raw: string): string {
  return VALID_STATUSES.has(raw as never) ? raw : 'Unknown';
}

function normaliseRisk(raw: string): string {
  return VALID_RISK_LEVELS.has(raw as never) ? raw : 'Unknown';
}

function statusCssClass(status: string): string {
  switch (status) {
    case 'On Track':
      return styles['status--on-track'];
    case 'At Risk':
      return styles['status--at-risk'];
    case 'Off Track':
      return styles['status--off-track'];
    default:
      return styles['status--unknown'];
  }
}

function riskCssClass(risk: string): string {
  switch (risk) {
    case 'Low':
      return styles['risk--low'];
    case 'Medium':
      return styles['risk--medium'];
    case 'High':
      return styles['risk--high'];
    default:
      return styles['risk--unknown'];
  }
}

/* ─── TruncatedText (PRD §2 — keyBlocker truncation at 80 chars) ──────────── */

interface TruncatedTextProps {
  text: string;
  maxLength?: number;
}

function TruncatedText({ text, maxLength = 80 }: TruncatedTextProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const needsTruncation = text.length > maxLength;
  const displayText = needsTruncation ? text.slice(0, maxLength) + '\u2026' : text;

  return (
    <span
      className={styles['truncated-text']}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      title={needsTruncation ? text : undefined}
    >
      {displayText}
      {showTooltip && needsTruncation && (
        <span className={styles['tooltip']} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/* ─── ProjectCard ────────────────────────────────────────────────────────── */

interface ProjectCardProps {
  project: ProjectHealth;
}

function ProjectCard({ project }: ProjectCardProps) {
  const status = normaliseStatus(project.status);
  const risk = normaliseRisk(project.riskLevel);
  const blocker = project.keyBlocker?.trim() || null;
  const recommendation = project.recommendation?.trim() || null;

  return (
    <div className={styles['card']} role="article" aria-label={`${project.name} health card`}>
      <h2 className={styles['card-name']}>{project.name}</h2>

      <div className={styles['card-meta']}>
        <span className={`${styles['badge']} ${statusCssClass(status)}`}>{status}</span>
        <span className={`${styles['badge']} ${riskCssClass(risk)}`}>{risk}</span>
      </div>

      <div className={styles['card-blocker']}>
        <span className={styles['card-label']}>Key Blocker</span>
        {blocker ? (
          <TruncatedText text={blocker} />
        ) : (
          <span className={styles['card-fallback']}>None</span>
        )}
      </div>

      <div className={styles['card-recommendation']}>
        <span className={styles['card-label']}>Recommendation</span>
        <span className={styles['card-recommendation-text']}>
          {recommendation || 'No recommendation'}
        </span>
      </div>
    </div>
  );
}

/* ─── CrossProjectHealthDashboard (default export) ────────────────────────── */

export default function CrossProjectHealthDashboard({
  projects,
}: CrossProjectHealthDashboardProps) {
  if (!projects || projects.length === 0) {
    return (
      <div className={styles['empty-state']}>
        <p className={styles['empty-state-text']}>No projects to display</p>
      </div>
    );
  }

  return (
    <div className={styles['dashboard']}>
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
