import type { TrackerSurfaceProps } from './TrackerSurface';

/**
 * The field schema for every generic governance tracker — one entry drives the
 * whole CRUD surface (list + form). Field whitelists mirror the backend
 * (governanceRoutes TRACKERS); keep the two in sync.
 */
export const TRACKER_CONFIGS: Record<string, TrackerSurfaceProps> = {
  vendors: {
    title: 'Vendor / Subprocessor Register',
    path: '/vendors',
    fields: [
      { key: 'name', label: 'Vendor', required: true },
      { key: 'purpose', label: 'Purpose', type: 'textarea' },
      { key: 'region', label: 'Region' },
      { key: 'dataClasses', label: 'Data classes' },
      { key: 'isSubprocessor', label: 'Subprocessor', type: 'bool' },
      { key: 'dpaStatus', label: 'DPA status', type: 'select', options: ['pending', 'signed', 'expired', 'not_required'] },
      { key: 'dpaUrl', label: 'DPA URL', inList: false },
      { key: 'renewalDate', label: 'Renewal', type: 'date' },
      { key: 'contactEmail', label: 'Contact', inList: false },
      { key: 'website', label: 'Website', inList: false },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  incidents: {
    title: 'Security Incident Register',
    path: '/incidents',
    fields: [
      { key: 'title', label: 'Incident', required: true },
      { key: 'severity', label: 'Severity', type: 'select', options: ['critical', 'high', 'medium', 'low'] },
      { key: 'status', label: 'Status', type: 'select', options: ['open', 'investigating', 'contained', 'resolved'] },
      { key: 'detectionSource', label: 'Detected via' },
      { key: 'assignedTo', label: 'Assigned to' },
      { key: 'impact', label: 'Impact', type: 'textarea' },
      { key: 'rootCause', label: 'Root cause', type: 'textarea' },
      { key: 'postmortemUrl', label: 'Postmortem', inList: false },
      { key: 'reportedBy', label: 'Reported by', inList: false },
      { key: 'resolvedAt', label: 'Resolved', type: 'date', inList: false },
    ],
  },
  'data-inventory': {
    title: 'PII & Data Inventory',
    path: '/data-inventory',
    fields: [
      { key: 'name', label: 'Asset', required: true },
      { key: 'classification', label: 'Classification', type: 'select', options: ['public', 'internal', 'confidential', 'restricted'] },
      { key: 'dataCategories', label: 'Categories' },
      { key: 'storageLocation', label: 'Storage' },
      { key: 'retentionDays', label: 'Retention (days)', type: 'number' },
      { key: 'legalBasis', label: 'Legal basis', type: 'select', options: ['contract', 'consent', 'legitimate_interest', 'legal_obligation'], inList: false },
      { key: 'ownerTeam', label: 'Owner team', inList: false },
      { key: 'lastReviewedAt', label: 'Last reviewed', type: 'date', inList: false },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  dpa: {
    title: 'DPA Management',
    path: '/dpa',
    fields: [
      { key: 'counterpartyName', label: 'Counterparty', required: true },
      { key: 'counterpartyType', label: 'Type', type: 'select', options: ['vendor', 'customer', 'subprocessor'] },
      { key: 'status', label: 'Status', type: 'select', options: ['draft', 'signed', 'expired', 'terminated'] },
      { key: 'signedAt', label: 'Signed', type: 'date' },
      { key: 'effectiveDate', label: 'Effective', type: 'date', inList: false },
      { key: 'renewalDate', label: 'Renewal', type: 'date' },
      { key: 'dpaUrl', label: 'DPA URL', inList: false },
      { key: 'sccVersion', label: 'SCC version', inList: false },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  training: {
    title: 'Security Training Tracker',
    path: '/training',
    fields: [
      { key: 'userName', label: 'Person', required: true },
      { key: 'userEmail', label: 'Email', inList: false },
      { key: 'trainingType', label: 'Type', type: 'select', options: ['phishing', 'sec_awareness', 'soc2_ready', 'gdpr', 'custom'], required: true },
      { key: 'trainingName', label: 'Course', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['not_started', 'in_progress', 'completed', 'overdue'] },
      { key: 'dueDate', label: 'Due', type: 'date' },
      { key: 'completedAt', label: 'Completed', type: 'date', inList: false },
      { key: 'certificateUrl', label: 'Certificate', inList: false },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  'compliance-calendar': {
    title: 'Compliance Calendar',
    path: '/compliance-calendar',
    fields: [
      { key: 'title', label: 'Event', required: true },
      { key: 'framework', label: 'Framework', type: 'select', options: ['soc2', 'gdpr', 'ccpa', 'sox', 'hipaa', 'custom'], required: true },
      { key: 'eventType', label: 'Type', type: 'select', options: ['milestone', 'evidence_refresh', 'audit', 'renewal'] },
      { key: 'dueDate', label: 'Due', type: 'date', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['upcoming', 'in_progress', 'completed', 'overdue'] },
      { key: 'assignedTo', label: 'Owner', inList: false },
      { key: 'isRecurring', label: 'Recurring', type: 'bool', inList: false },
      { key: 'recurringEvery', label: 'Every', inList: false },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  dsr: {
    title: 'Data Subject Requests',
    path: '/dsr',
    fields: [
      { key: 'requestType', label: 'Type', type: 'select', options: ['access', 'erasure', 'rectification', 'portability', 'objection', 'opt_out'], required: true },
      { key: 'subjectEmail', label: 'Subject email', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['verifying_identity', 'pending', 'processing', 'completed', 'rejected'] },
      { key: 'jurisdiction', label: 'Jurisdiction' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  suppression: {
    title: 'Suppression List',
    path: '/suppression',
    fields: [
      { key: 'identifierType', label: 'Type', type: 'select', options: ['email', 'linkedin_url', 'github_login', 'phone_e164', 'domain'], required: true },
      { key: 'identifierValue', label: 'Identifier', required: true },
      { key: 'reason', label: 'Reason', type: 'select', options: ['erasure_request', 'user_opt_out', 'hard_bounce', 'spam_complaint', 'manual_admin_add'], required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};
