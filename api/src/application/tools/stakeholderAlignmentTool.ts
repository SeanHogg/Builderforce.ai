/** toolId */ export const TOOL_STAKEHOLDER_ALIGNMENT = 'stakeholder-alignment';

export const stakeholderAlignmentToolDefinition: import('./toolTypes').QuestionnaireTool = {
  id: TOOL_STAKEHOLDER_ALIGNMENT,
  name: 'Stakeholder Alignment',
  tagline: 'Are priorities clear and agreed across key stakeholders?',
  icon: '🤝',
  category: 'governance',
  kind: 'questionnaire',
  about:
    'Diagnose alignment gaps by scoring five canonical questions: Priority Clarity, Documentation & Access, Conflict Detection, Sign-Off Process, and Visibility & Audit. The tool surfaces top-of-funnel risks like competing P0s, missed deadlines, and outdated maps.',
  scale: [
    { value: 5, label: 'Very High' },
    { value: 4, label: 'High' },
    { value: 3, label: 'Moderate' },
    { value: 2, label: 'Low' },
    { value: 1, label: 'Very Low' },
  ],
  sections: [
    {
      key: 'clarity',
      name: 'Priority Clarity',
      description: 'Do we maintain a single, versioned source of truth for agreed priorities?',
      questions: [
        { id: 'clarity_documented', text: 'Are priorities clearly documented and agreed across key stakeholders?', dimension: 'Alignment' },
        {
          id: 'clarity_competing_reconciled',
          text: 'Have competing P0 requests been explicitly reconciled or escalated?',
          dimension: 'Alignment',
        },
      ],
      recommendations: {
        4: 'Your alignment record is robust — keep it fresh as work evolves.',
        3: 'Consider documenting the known gaps and tracking mitigations.',
        2: 'Create a single source of truth (Priority Register) and expand stakeholder agreement closes.',
        1: 'Follow the alignment workflow: define, propose, sign off, and audit before committing.',
      },
    },
    {
      key: 'documentation',
      name: 'Documentation & Access',
      description: 'How accessible and current are our documented stakeholders and sign-off rules?',
      questions: [
        {
          id: 'doc_stakeholder_map',
          text: 'Is the list of Required Approvers for key initiatives current and accessible?',
          dimension: 'Stakeholder Map',
        },
        {
          id: 'doc_review_timing',
          text: 'Are sign-off windows (default 48 hours) enforced and acknowledged?',
          dimension: 'Process',
        },
      ],
      recommendations: {
        4: 'Your documentation is current and enforced — easy for anyone to verify.',
        3: 'Consider adding frequency and owners to the review window documentation.',
        2: 'Refresh the stakeholder map for at-risk initiatives and capture sign-off expectations.',
        1: 'Audit and centralize stakeholder maps; publish the sign-off process as inline guidance.',
      },
    },
    {
      key: 'conflict_detection',
      name: 'Conflict Detection',
      description: 'Are competitive priorities detected early and escalated when needed?',
      questions: [
        {
          id: 'conflict_p0_duplication',
          text: 'Do we detect when the same stakeholder team is targeted by competing P0 requests?',
          dimension: 'Conflict',
        },
      ],
      recommendations: {
        4: 'Your conflict detection flagging is solid — keep the SLA and reminder automation in place.',
        3: 'Consider extending to P1 and P2 overlaps, and surface the detected conflicts in the dashboard.',
        2: 'Implement a lightweight flag: if two high-priority initiatives target the same capacity, raise an alert.',
        1: 'Establish a rule and flag layout to automatically surface priority competition.',
      },
    },
    {
      key: 'sign_off_process',
      name: 'Sign-Off Process',
      description: 'Is the sign-off protocol enforced and adhered to?',
      questions: [
        {
          id: 'signoff_all_required',
          text: 'Is a version blocked until all Required Approvers have responded?',
          dimension: 'Process',
        },
        {
          id: 'signoff_blocker_triggers',
          text: 'Does a single Block response halt approval and open an escalation thread?',
          dimension: 'Process',
        },
      ],
      recommendations: {
        4: 'Your gate enforces coverage and blockers correctly — maintain it.',
        3: 'Add a dashboard indicator for pending sign-offs and blocked versions.',
        2: 'Enforce that at least all required approvers have responded before a version can progress.',
        1: 'Define the gate, roles, and response types; enforce them in the workflow step.',
      },
    },
    {
      key: 'visibility_and_audit',
      name: 'Visibility & Audit',
      description: 'Are status updates, roadmaps, and decisions logged and visible to all?',
      questions: [
        {
          id: 'visibility_status_vs_agreement',
          text: 'Do recent status updates and roadmaps reflect the agreed priorities, or are there known divergence points?',
          dimension: 'Alignment',
        },
      ],
      recommendations: {
        4: 'Your dashboard shows alignment metrics and divergences clearly — consider more drill-in items.',
        3: 'Add a quick-flip divergence capture for teams to surface drift across updates.',
        2: 'Create a status versus agreement view; tag updates that are not aligned with the register.',
        1: 'Publish the approved priority register as the true source; mark downstream updates with alignment tags.',
      },
    },
  ],
};

// Public compute endpoint (stub) matching agentic-maturity; real scoring is via the score() method.
export const stakeholderAlignmentComputeEndpoint = '/api/tools/stakeholder-alignment/compute';

/** For public GET /api/tools returns summaries only. This file defines the full tool. */