/**
 * escalationRuleConfig — rule configuration for governance escalations.
 *
 * The PRD deliverable: "Escalation Rule Configuration File". This is the low-level
 * static configuration that feeds GovernanceEscalationService and the frontend icon/clock
 * layer — team-scoped chain templates, default SLA windows, reminder cadence, icon keys,
 * and level authority mapping (PM→Director→VP→C-suite).
 *
 * These templates seed governance_escalation_chains when a tenant is bootstrapped,
 * but the DB is the source of truth once customized — see GovernanceEscalationService.bootstrap().
 */

export type GovernanceChainLevelTemplate = {
  sequenceIndex: number;
  effectiveLevel: number; // authority tier: 1=PM,2=Director,3=VP,4=C-suite,5=Board
  levelName: string;      // e.g. 'PM', 'Director', 'VP', 'C-suite', 'Board'
  ownerKind: string;      // 'user' | 'role' | 'group_email' | 'team' | 'board_coordinator'
  ownerId?: string | null;
  slaDays?: number | null; // null → chain default (3 business days)
  autoEscalate?: boolean;
  iconKey: string; // maps to escalationIcons
  isTerminal?: boolean;
};

export type GovernanceChainTemplate = {
  teamScope: string; // e.g. 'default', 'engineering', 'compliance', 'product'
  initiativeId?: string | null;
  name: string;
  description?: string;
  defaultSlaDays: number; // FR.2 — 3 business days
  levels: GovernanceChainLevelTemplate[];
};

export type EscalationRuleConfig = {
  /** The maximum wall-clock budget allowed between trigger and the SLA timer start (FR.3). */
  maxTimerStartDelayMinutes: number;
  /** SLA breach auto-escalation retry guard (cron). */
  escalationSweepIntervalMinutes: number;
  /** Reminder guards — AC.4. */
  reminder24hAdvanceMinutes: number; // 24h
  reminder4hAdvanceMinutes: number;  // 4h
  /** Deadline computation: whether to count business days only (skip Sat/Sun). */
  useBusinessDays: boolean;
  /** Chain templates (seeded per-tenant). */
  chainTemplates: GovernanceChainTemplate[];
};

const DEFAULT_LEVELS: GovernanceChainLevelTemplate[] = [
  { sequenceIndex: 0, effectiveLevel: 1, levelName: 'PM',        ownerKind: 'role', ownerId: 'project_manager', iconKey: 'pm',       slaDays: 3, autoEscalate: true },
  { sequenceIndex: 1, effectiveLevel: 2, levelName: 'Director',  ownerKind: 'role', ownerId: 'director',        iconKey: 'director', slaDays: 3, autoEscalate: true },
  { sequenceIndex: 2, effectiveLevel: 3, levelName: 'VP',        ownerKind: 'role', ownerId: 'vp',              iconKey: 'vp',       slaDays: 3, autoEscalate: true },
  { sequenceIndex: 3, effectiveLevel: 4, levelName: 'C-suite',   ownerKind: 'role', ownerId: 'c_suite',         iconKey: 'c-suite',  slaDays: 3, autoEscalate: true, isTerminal: true },
];

export const ESCALATION_RULE_CONFIG: EscalationRuleConfig = {
  maxTimerStartDelayMinutes: 15,   // FR.3 — timer must begin within 15 minutes of trigger
  escalationSweepIntervalMinutes: 15, // AC.3 sweep cadence
  reminder24hAdvanceMinutes: 24 * 60,
  reminder4hAdvanceMinutes: 4 * 60,
  useBusinessDays: true,
  chainTemplates: [
    {
      teamScope: 'default',
      name: 'Default Governance Escalation',
      description: 'PM → Director → VP → C-suite chain with 3 business-day SLA per level.',
      defaultSlaDays: 3,
      levels: DEFAULT_LEVELS,
    },
    {
      teamScope: 'engineering',
      name: 'Engineering Escalation Chain',
      description: 'Team lead → Engineering Director → VP Eng → CTO chain.',
      defaultSlaDays: 3,
      levels: [
        { sequenceIndex: 0, effectiveLevel: 1, levelName: 'Team Lead', ownerKind: 'role', ownerId: 'team_lead',       iconKey: 'team-lead', slaDays: 3, autoEscalate: true },
        { sequenceIndex: 1, effectiveLevel: 2, levelName: 'Director',  ownerKind: 'role', ownerId: 'director',        iconKey: 'director', slaDays: 3, autoEscalate: true },
        { sequenceIndex: 2, effectiveLevel: 3, levelName: 'VP Eng',    ownerKind: 'role', ownerId: 'vp_eng',          iconKey: 'vp-eng',   slaDays: 3, autoEscalate: true },
        { sequenceIndex: 3, effectiveLevel: 4, levelName: 'CTO',       ownerKind: 'role', ownerId: 'c_suite',         iconKey: 'c-suite',  slaDays: 3, autoEscalate: true, isTerminal: true },
      ],
    },
    {
      teamScope: 'compliance',
      name: 'Compliance Escalation Chain',
      description: 'Compliance lead → Compliance director → General counsel → C-suite / Board.',
      defaultSlaDays: 3,
      levels: [
        { sequenceIndex: 0, effectiveLevel: 1, levelName: 'Compliance Lead', ownerKind: 'role', ownerId: 'compliance_lead', iconKey: 'compliance', slaDays: 2, autoEscalate: true  },
        { sequenceIndex: 1, effectiveLevel: 2, levelName: 'Compliance Dir',  ownerKind: 'role', ownerId: 'director',        iconKey: 'director',    slaDays: 3, autoEscalate: true  },
        { sequenceIndex: 2, effectiveLevel: 3, levelName: 'General Counsel', ownerKind: 'role', ownerId: 'general_counsel', iconKey: 'legal',       slaDays: 3, autoEscalate: true  },
        { sequenceIndex: 3, effectiveLevel: 4, levelName: 'Board',           ownerKind: 'role', ownerId: 'board',           iconKey: 'board',       slaDays: 3, autoEscalate: true, isTerminal: true },
      ],
    },
  ],
};

/**
 * Mapping: escalation chain data model addresses (initiativeId/effectiveLevel/sequence).
 * A caller addressing a specific level uses { initiativeId?, teamScope?, effectiveLevel?, sequenceIndex? }.
 */
export type EscalationLevelAddress = {
  initiativeId?: string | null;
  teamScope?: string | null;
  effectiveLevel?: number;
  sequenceIndex?: number;
};

/** Return the chain template for a given teamScope or the default when not found. */
export function resolveChainTemplate(teamScope: string, initiativeId?: string | null): GovernanceChainTemplate {
  const byInitiative = initiativeId
    ? ESCALATION_RULE_CONFIG.chainTemplates.find((c) => c.initiativeId === initiativeId)
    : undefined;
  if (byInitiative) return byInitiative;
  return (
    ESCALATION_RULE_CONFIG.chainTemplates.find((c) => c.teamScope === teamScope) ??
    ESCALATION_RULE_CONFIG.chainTemplates[0]!
  );
}
