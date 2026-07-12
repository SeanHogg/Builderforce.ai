/** toolId */ export const TOOL_STAKEHOLDER_ALIGNMENT = 'stakeholder-alignment';

import { type QuestionnaireTool } from './toolTypes';

export const stakeholderAlignmentToolDefinition: QuestionnaireTool = {
  id: TOOL_STAKEHOLDER_ALIGNMENT,
  name: 'Stakeholder Alignment',
  tagline: 'Are priorities clear and agreed across key stakeholders?',
  icon: '🤝',
  category: 'governance',
  kind: 'questionnaire',
  about:
    'Diagnose alignment gaps by scoring five canonical questions: Priority Clarity, Documentation & Access, Conflict Detection, Sign-Off Process, and Visibility & Audit. The tool surfaces top-of-funnel risks like competing P0s, missed deadlines, and outdated maps.',
  scale: [
    { value: 1, label: 'Very Low' },
    { value: 2, label: 'Low' },
    { value: 3, label: 'Moderate' },
    { value: 4, label: 'High' },
    { value: 5, label: 'Very High' },
  ],
  sections: [
    {
      key: 'clarity',
      name: 'Priority Clarity',
      description:
        'Do we maintain a single, versioned source of truth for agreed priorities?',
      questions: [
        {
          id: 'clarity_documented',
          text: 'Are priorities clearly documented and agreed across key stakeholders?',
        },
        {
          id: 'clarity_competing_reconciled',
          text: 'Have competing P0 requests been explicitly reconciled or escalated?',
        },
      ],
      recommendations: {
        3: 'Consider documenting the known gaps and tracking mitigations.',
        4: 'Your alignment record is robust — keep it fresh as work evolves.',
        5: 'Your alignment record is robust — keep it fresh as work evolves.',
        6:
          'Follow the alignment workflow: define, propose, sign off, and audit before committing.',
      },
    },
    {
      key: 'documentation',
      name: 'Documentation & Access',
      description:
        'How accessible and current are our documented stakeholders and sign-off rules?',
      questions: [
        {
          id: 'doc_stakeholder_map',
          text: 'Is the list of Required Approvers for key initiatives current and accessible?',
        },
        {
          id: 'doc_review_timing',
          text: 'Are sign-off windows (default 48 hours) enforced and acknowledged?',
        },
      ],
      recommendations: {
        3: 'Refresh the stakeholder map for at-risk initiatives and capture sign-off expectations.',
        4: 'Your documentation is current and enforced — easy for anyone to verify.',
        5: 'Your documentation is current and enforced — easy for anyone to verify.',
        6:
          'Audit and centralize stakeholder maps; publish the sign-off process as inline guidance.',
      },
    },
    {
      key: 'conflict_detection',
      name: 'Conflict Detection',
      description:
        'Are competitive priorities detected early and escalated when needed?',
      questions: [
        {
          id: 'conflict_p0_duplication',
          text: 'Do we detect when the same stakeholder team is targeted by competing P0 requests?',
        },
      ],
      recommendations: {
        3: 'Implement a lightweight flag: if two high-priority initiatives target the same capacity, raise an alert.',
        4: 'Your conflict detection flagging is solid — keep the SLA and reminder automation in place.',
        5:
          'Consider extending to P1 and P2 overlaps, and surface the detected conflicts in the dashboard.',
        6:
          'Establish a rule and flag layout to automatically surface priority competition.',
      },
    },
    {
      key: 'sign_off_process',
      name: 'Sign-Off Process',
      description:
        'Is the sign-off protocol enforced and adhered to?',
      questions: [
        {
          id: 'signoff_all_required',
          text: 'Is a version blocked until all Required Approvers have responded?',
        },
        {
          id: 'signoff_blocker_triggers',
          text: 'Does a single Block response halt approval and open an escalation thread?',
        },
      ],
      recommendations: {
        3: 'Define the gate, roles, and response types; enforce them in the workflow step.',
        4: 'Your gate enforces coverage and blockers correctly — maintain it.',
        5: 'Add a dashboard indicator for pending sign-offs and blocked versions.',
        6: 'Enforce that at least all required approvers have responded before a version can progress.',
      },
    },
    {
      key: 'visibility_and_audit',
      name: 'Visibility & Audit',
      description:
        'Are status updates, roadmaps, and decisions logged and visible to all?',
      questions: [
        {
          id: 'visibility_status_vs_agreement',
          text: 'Do recent status updates and roadmaps reflect the agreed priorities, or are there known divergence points?',
        },
      ],
      recommendations: {
        3: 'Create a status versus agreement view; tag updates that are not aligned with the register.',
        4: 'Your dashboard shows alignment metrics and divergences clearly — consider more drill-in items.',
        5: 'Add a quick-flip divergence capture for teams to surface drift across updates.',
        6: 'Publish the approved priority register as the true source; mark downstream updates with alignment tags.',
      },
    },
  ],
  score(answers) {
    return scoreQuestionnaire(this, answers as Record<string, number>);
  },
};