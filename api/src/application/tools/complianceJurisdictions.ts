/**
 * Jurisdiction matrix for the Compliance Audit Agent.
 *
 * This is deliberately an audit routing aid, not a claim that every law applies
 * to every customer. The deep pass must determine nexus, thresholds, data types,
 * user ages, and controller/processor roles before grading applicability.
 */

export interface ComplianceJurisdictionProfile {
  id: string;
  region: string;
  authorities: string[];
  auditFocus: string[];
  applicabilityNotes: string;
}

export const COMPLIANCE_JURISDICTIONS: ComplianceJurisdictionProfile[] = [
  {
    id: 'us-federal',
    region: 'United States — federal',
    authorities: ['FTC Act §5', 'COPPA Rule', 'CAN-SPAM Act', 'ADA Title III'],
    auditFocus: [
      'truthful privacy and AI claims',
      'verifiable parental consent and child-data minimization where under-13 users are in scope',
      'commercial-email identity, postal address, unsubscribe, and suppression',
      'keyboard, screen-reader, contrast, labeling, and error-recovery accessibility evidence',
    ],
    applicabilityNotes: 'FTC deception/unfairness risk is broad; COPPA, CAN-SPAM, and ADA coverage depends on audience and conduct.',
  },
  {
    id: 'us-comprehensive-state-privacy',
    region: 'United States — comprehensive state privacy laws',
    authorities: [
      'California CCPA/CPRA', 'Colorado CPA', 'Connecticut DPA', 'Delaware PDPA',
      'Indiana CDPA', 'Iowa CDPA', 'Kentucky CDPA', 'Maryland MODPA',
      'Minnesota MCDPA', 'Montana MCDPA', 'Nebraska DPA', 'New Hampshire SB 255',
      'New Jersey DPA', 'Oregon CPA', 'Rhode Island DTPPA', 'Tennessee TIPA',
      'Texas TDPSA', 'Utah UCPA', 'Virginia VCDPA',
    ],
    auditFocus: [
      'threshold and role analysis by state',
      'notice categories, purposes, sources, recipients, retention, and sensitive data',
      'access, correction, deletion, portability, opt-out, appeal, and non-discrimination workflows',
      'Global Privacy Control or other required universal opt-out signals',
      'processor contracts and data-protection assessments for high-risk processing',
    ],
    applicabilityNotes: 'Thresholds, exemptions, cure periods, appeal rights, and universal-signal duties differ by state; audit the current statute for each market.',
  },
  {
    id: 'california-admt-2026',
    region: 'California — risk, cybersecurity, and automated decisionmaking',
    authorities: ['2026 CCPA regulations on risk assessments, cybersecurity audits, and ADMT'],
    auditFocus: [
      'risk-assessment inventory and required submissions',
      'ADMT pre-use notice, access, and opt-out controls for significant decisions',
      'cybersecurity-audit scoping, evidence, and certification timetable',
    ],
    applicabilityNotes: 'The regulations took effect January 1, 2026, with phased compliance dates for ADMT and cybersecurity audits.',
  },
  {
    id: 'us-sensitive-and-minor-data',
    region: 'United States — consumer health, biometric, and minor data',
    authorities: [
      'Washington My Health My Data Act', 'Nevada SB 370 consumer health law',
      'Connecticut consumer-health and minor amendments', 'state biometric privacy laws',
    ],
    auditFocus: [
      'separate consumer-health notice and consent',
      'signed authorization before sale and processor-wide deletion',
      'biometric notice, consent, retention, and destruction',
      'age assurance, minor-safe defaults, and limits on targeted ads, profiling, messaging, and engagement design',
    ],
    applicabilityNotes: 'Some consumer-health and child protections apply without the thresholds found in general privacy statutes.',
  },
  {
    id: 'colorado-ai-2027',
    region: 'Colorado — automated decisions and chatbot safety',
    authorities: ['Colorado ADMT Act (effective January 1, 2027)', 'Colorado Chatbot Safety Act (effective January 1, 2027)'],
    auditFocus: [
      'developer/deployer role, consequential-decision notices, correction, and risk management',
      'clear AI-not-human disclosure',
      'age estimation, teen safety, self-harm response, account/privacy tools, and annual reporting readiness',
    ],
    applicabilityNotes: 'Upcoming requirements should be tracked now for a public conversational-agent platform serving Colorado.',
  },
  {
    id: 'eu-eea',
    region: 'European Union and EEA',
    authorities: ['GDPR', 'ePrivacy rules', 'EU AI Act'],
    auditFocus: [
      'controller/processor records, lawful basis, minimization, retention, rights, DPIAs, breach response, and DPO/representative analysis',
      'prior consent and records for non-essential cookies or similar storage',
      'SCC/adequacy transfer mechanism, transfer-impact assessment, DPA, and subprocessor notice',
      'AI literacy, prohibited-practice screening, transparency, GPAI/provider documentation, and high-risk-system controls where applicable',
    ],
    applicabilityNotes: 'GDPR can apply extraterritorially. AI Act duties phase in by role and risk category; verify the operative date for each obligation.',
  },
  {
    id: 'united-kingdom',
    region: 'United Kingdom',
    authorities: ['UK GDPR', 'Data Protection Act 2018', 'PECR'],
    auditFocus: [
      'UK lawful basis, rights, DPIA, breach, representative, and ICO complaint information',
      'UK transfer mechanism and International Data Transfer Addendum/Agreement',
      'positive consent before non-essential cookies and complete cookie disclosures',
      'fairness, explainability, and human review for AI processing',
    ],
    applicabilityNotes: 'UK documentation and transfer mechanisms must be evaluated separately from EU coverage.',
  },
  {
    id: 'canada',
    region: 'Canada, including Quebec',
    authorities: ['PIPEDA', 'Alberta PIPA', 'British Columbia PIPA', 'Quebec Law 25'],
    auditFocus: [
      'privacy officer and governance program',
      'meaningful consent, appropriate purposes, access/correction, safeguards, limited retention, and complaint process',
      'breach reporting, notification, and records',
      'Quebec privacy impact assessments, confidentiality-incident register, cross-border assessment, and automated-decision notice',
    ],
    applicabilityNotes: 'Provincial laws may replace PIPEDA for in-province processing while PIPEDA continues to cover cross-border commercial data flows.',
  },
  {
    id: 'brazil',
    region: 'Brazil',
    authorities: ['Lei Geral de Proteção de Dados (LGPD)'],
    auditFocus: [
      'legal basis, purpose limitation, data-subject rights, security, incident handling, and processor instructions',
      'international-transfer mechanism and ANPD requirements',
      'published encarregado/data-protection contact where required',
      'information and review channels for automated decisions affecting interests',
    ],
    applicabilityNotes: 'LGPD may apply to processing aimed at people in Brazil even when the service provider is abroad.',
  },
  {
    id: 'australia',
    region: 'Australia',
    authorities: ['Privacy Act 1988', 'Australian Privacy Principles', 'Notifiable Data Breaches scheme'],
    auditFocus: [
      'APP privacy policy, collection notice, access/correction, complaints, security, and destruction or de-identification',
      'likely overseas-recipient countries and APP 8 accountability',
      'direct-marketing controls and anonymity/pseudonymity where practicable',
      'eligible data-breach assessment and notification process',
    ],
    applicabilityNotes: 'Turnover and special-category thresholds determine coverage; some small businesses remain covered.',
  },
];

export function listComplianceJurisdictions(): ComplianceJurisdictionProfile[] {
  return COMPLIANCE_JURISDICTIONS.map((profile) => ({
    ...profile,
    authorities: [...profile.authorities],
    auditFocus: [...profile.auditFocus],
  }));
}
