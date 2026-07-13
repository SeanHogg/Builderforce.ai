/**
 * Curated "standard knowledge library" — the SOPs, processes and reference docs
 * that most operating teams are expected to have. It powers TWO things from one
 * source of truth:
 *
 *   1. Gap analysis — match a tenant's existing documents against this list to
 *      compute a coverage score and surface "standard SOPs you're missing".
 *   2. The template gallery — each item is a one-click starter (title + docType +
 *      tags + skeleton Markdown) so authors begin from structure, not a blank page.
 *
 * Matching is intentionally fuzzy (title/summary/tag keyword containment) so a
 * tenant that already wrote "New hire onboarding" counts as covering the
 * "Employee onboarding" standard without an exact title.
 */

export type StandardDocType = 'sop' | 'process' | 'doc';

export interface StandardItem {
  /** Stable key referenced by the template gallery + create endpoint. */
  key: string;
  title: string;
  docType: StandardDocType;
  summary: string;
  /** Suggested tags applied when created from this template. */
  tags: string[];
  /** Lowercase keywords; a tenant doc matches this item if any appears in its
   *  title, summary or tags. */
  keywords: string[];
  /** Skeleton Markdown the author starts editing from. */
  starter: string;
}

function skeleton(title: string, sections: string[]): string {
  return [`# ${title}`, '', ...sections.flatMap((s) => [`## ${s}`, '', '', ''])].join('\n').trimEnd() + '\n';
}

export const STANDARD_LIBRARY: StandardItem[] = [
  {
    key: 'employee-onboarding',
    title: 'Employee Onboarding',
    docType: 'sop',
    summary: 'How a new hire is set up, granted access, and ramped in their first week.',
    tags: ['people', 'onboarding'],
    keywords: ['onboard', 'new hire', 'new joiner', 'ramp'],
    starter: skeleton('Employee Onboarding', ['Purpose', 'Before day one', 'Access & accounts', 'First week goals', 'Owner & review cadence']),
  },
  {
    key: 'employee-offboarding',
    title: 'Offboarding & Access Revocation',
    docType: 'sop',
    summary: 'Steps to revoke access, recover assets, and close out a departing team member.',
    tags: ['people', 'security'],
    keywords: ['offboard', 'departure', 'leaver', 'revoke access', 'termination'],
    starter: skeleton('Offboarding & Access Revocation', ['Purpose', 'Access revocation checklist', 'Asset recovery', 'Knowledge handover', 'Final confirmation']),
  },
  {
    key: 'incident-response',
    title: 'Incident Response',
    docType: 'process',
    summary: 'How the team detects, triages, communicates and resolves a production incident.',
    tags: ['engineering', 'security', 'incident'],
    keywords: ['incident', 'outage', 'sev', 'postmortem', 'on-call', 'oncall'],
    starter: skeleton('Incident Response', ['Severity levels', 'Detection & triage', 'Communication', 'Resolution', 'Post-incident review']),
  },
  {
    key: 'code-review',
    title: 'Code Review',
    docType: 'process',
    summary: 'Expectations for opening, reviewing and merging changes.',
    tags: ['engineering', 'quality'],
    keywords: ['code review', 'pull request', 'pr review', 'merge'],
    starter: skeleton('Code Review', ['When a review is required', 'Author responsibilities', 'Reviewer checklist', 'Merge criteria']),
  },
  {
    key: 'release-deployment',
    title: 'Release & Deployment',
    docType: 'process',
    summary: 'How changes are versioned, released and rolled back safely.',
    tags: ['engineering', 'release'],
    keywords: ['release', 'deploy', 'rollback', 'ship', 'cut a version'],
    starter: skeleton('Release & Deployment', ['Release cadence', 'Pre-release checklist', 'Deploy steps', 'Rollback plan', 'Verification']),
  },
  {
    key: 'backup-recovery',
    title: 'Data Backup & Recovery',
    docType: 'sop',
    summary: 'What is backed up, how often, and how to restore from backup.',
    tags: ['security', 'data'],
    keywords: ['backup', 'restore', 'recovery', 'disaster recovery', 'rpo', 'rto'],
    starter: skeleton('Data Backup & Recovery', ['Scope', 'Backup schedule', 'Restore procedure', 'Recovery objectives (RPO/RTO)', 'Testing']),
  },
  {
    key: 'access-control',
    title: 'Security & Access Control',
    docType: 'sop',
    summary: 'How access is requested, granted, reviewed and revoked across systems.',
    tags: ['security'],
    keywords: ['access control', 'permissions', 'least privilege', 'access review', 'rbac'],
    starter: skeleton('Security & Access Control', ['Principles', 'Requesting access', 'Approval', 'Periodic access review', 'Revocation']),
  },
  {
    key: 'support-escalation',
    title: 'Customer Support Escalation',
    docType: 'process',
    summary: 'How support tickets are triaged and escalated to the right team.',
    tags: ['support', 'customer'],
    keywords: ['support', 'escalation', 'ticket', 'customer issue', 'tier 2'],
    starter: skeleton('Customer Support Escalation', ['Triage', 'Escalation tiers', 'Response targets (SLA)', 'Hand-off to engineering']),
  },
  {
    key: 'leave-request',
    title: 'Time Off & Leave',
    docType: 'process',
    summary: 'How team members request, approve and record time off.',
    tags: ['people'],
    keywords: ['pto', 'leave', 'time off', 'vacation', 'holiday request'],
    starter: skeleton('Time Off & Leave', ['Requesting time off', 'Approval', 'Coverage', 'Recording']),
  },
  {
    key: 'expense-approval',
    title: 'Expense & Procurement Approval',
    docType: 'process',
    summary: 'Approval thresholds and steps for spending company money.',
    tags: ['finance'],
    keywords: ['expense', 'procurement', 'purchase', 'reimbursement', 'spend approval', 'vendor'],
    starter: skeleton('Expense & Procurement Approval', ['Approval thresholds', 'How to submit', 'Approver responsibilities', 'Reimbursement']),
  },
  {
    key: 'performance-review',
    title: 'Performance Review',
    docType: 'process',
    summary: 'The cadence and format for performance feedback and reviews.',
    tags: ['people'],
    keywords: ['performance review', 'appraisal', 'feedback cycle', '1:1', 'one on one'],
    starter: skeleton('Performance Review', ['Cadence', 'Self-assessment', 'Manager review', 'Calibration', 'Outcomes']),
  },
  {
    key: 'document-control',
    title: 'Knowledge & Document Control',
    docType: 'doc',
    summary: 'How knowledge is authored, reviewed, versioned and retired.',
    tags: ['knowledge', 'compliance'],
    keywords: ['document control', 'knowledge management', 'versioning', 'doc review', 'retention'],
    starter: skeleton('Knowledge & Document Control', ['Ownership', 'Authoring & review', 'Publishing & versioning', 'Acknowledgement', 'Retirement']),
  },
];

const BY_KEY = new Map(STANDARD_LIBRARY.map((i) => [i.key, i]));

export function standardItem(key: string): StandardItem | undefined {
  return BY_KEY.get(key);
}

/** Haystack for one document used to test standard-library presence. */
export interface DocLite {
  title: string;
  summary: string | null;
  tags: string[];
}

/** True if any of the item's keywords appears in the doc's title/summary/tags. */
function docMatchesItem(doc: DocLite, item: StandardItem): boolean {
  const hay = `${doc.title} ${doc.summary ?? ''} ${doc.tags.join(' ')}`.toLowerCase();
  return item.keywords.some((kw) => hay.includes(kw));
}

export interface CoverageItem extends Omit<StandardItem, 'starter' | 'keywords'> {
  present: boolean;
}

export interface Coverage {
  /** 0..100 share of the standard library the tenant has at least one doc for. */
  score: number;
  present: number;
  total: number;
  items: CoverageItem[];
}

/** Compute standard-library coverage for a tenant's documents. */
export function computeCoverage(docs: DocLite[]): Coverage {
  const items: CoverageItem[] = STANDARD_LIBRARY.map((item) => ({
    key: item.key,
    title: item.title,
    docType: item.docType,
    summary: item.summary,
    tags: item.tags,
    present: docs.some((d) => docMatchesItem(d, item)),
  }));
  const present = items.filter((i) => i.present).length;
  const total = items.length;
  return { score: total === 0 ? 100 : Math.round((present / total) * 100), present, total, items };
}
