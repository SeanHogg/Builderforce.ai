/**
 * escalationIcons — workflow icons for the governance escalation path.
 *
 * PRD deliverable: "Escalation Workflow Icons". Maps the static iconKey from
 * escalationRuleConfig → a normalized icon/emoji + lucide keypack for the frontend.
 *
 * The frontend reads this map client-side (imported via shared lib) or receives the
 * resolved key inside EscalationStatusDto.timeline[].iconKey. For true SVG assets the
 * frontend emits them from frontend/src/components/escalation/EscalationIcons.tsx which
 * mirrors these keys — this file is the BACKEND source of truth so the API DTO can
 * always produce a timeline with an icon.
 */

export type EscalationIconKey =
  | 'pm'
  | 'director'
  | 'vp'
  | 'c-suite'
  | 'team-lead'
  | 'vp-eng'
  | 'compliance'
  | 'legal'
  | 'board'
  | 'default'
  | 'triggered'
  | 'reminder'
  | 'escalated'
  | 'resolving'
  | 'resolved'
  | 'closed'
  | 'breach'
  | 'sla-clock';

export type EscalationIconDef = {
  key: EscalationIconKey;
  label: string;
  emoji: string;
  lucide: string; // lucide-react icon name (the frontend resolves it)
  color: string;  // Tailwind class triad root
};

export const ESCALATION_ICONS: Record<EscalationIconKey, EscalationIconDef> = {
  triggered:  { key: 'triggered',  label: 'Triggered',  emoji: '🚀', lucide: 'AlertTriangle',  color: 'text-amber-500' },
  reminder:   { key: 'reminder',   label: 'Reminder',   emoji: '⏰', lucide: 'Bell',           color: 'text-sky-600' },
  escalated:  { key: 'escalated',  label: 'Escalated',  emoji: '📣', lucide: 'ArrowUpCircle',  color: 'text-orange-600' },
  resolving:  { key: 'resolving',  label: 'Resolving',  emoji: '🧭', lucide: 'Wrench',         color: 'text-indigo-700' },
  resolved:   { key: 'resolved',   label: 'Resolved',   emoji: '✅', lucide: 'CheckCircle2',   color: 'text-emerald-600' },
  closed:     { key: 'closed',     label: 'Closed',     emoji: '🔒', lucide: 'Archive',        color: 'text-zinc-500' },
  breach:     { key: 'breach',     label: 'SLA Breach', emoji: '🔥', lucide: 'AlarmClock',     color: 'text-red-600' },
  'sla-clock':{ key: 'sla-clock',  label: 'SLA Clock',  emoji: '⏳', lucide: 'Timer',          color: 'text-zinc-700' },
  pm:         { key: 'pm',         label: 'Project Manager',       emoji: '👤', lucide: 'UserCog',        color: 'text-sky-700'  },
  director:   { key: 'director',   label: 'Director',              emoji: '🎖️', lucide: 'UserCheck',     color: 'text-purple-700' },
  vp:         { key: 'vp',         label: 'VP',                    emoji: '👑', lucide: 'Crown',          color: 'text-indigo-700' },
  'c-suite':  { key: 'c-suite',    label: 'C-suite',               emoji: '🏛️', lucide: 'Landmark',       color: 'text-zinc-900' },
  'team-lead':{ key: 'team-lead',  label: 'Team Lead',             emoji: '🛠️', lucide: 'Hammer',        color: 'text-emerald-700' },
  'vp-eng':   { key: 'vp-eng',     label: 'VP Engineering',        emoji: '⚙️', lucide: 'Settings2',      color: 'text-indigo-500' },
  compliance: { key: 'compliance', label: 'Compliance Lead',       emoji: '📋', lucide: 'ClipboardList', color: 'text-amber-700' },
  legal:      { key: 'legal',      label: 'General Counsel',       emoji: '⚖️', lucide: 'Scale',         color: 'text-slate-800' },
  board:      { key: 'board',      label: 'Board',                 emoji: '🏦', lucide: 'Building2',      color: 'text-zinc-900' },
  default:    { key: 'default',    label: 'Escalation Level',      emoji: '🔼', lucide: 'Layers3',         color: 'text-zinc-600' },
};

export function iconForLevel(levelName: string | undefined | null, iconKeyHint?: string | null): EscalationIconDef {
  if (iconKeyHint && iconKeyHint in ESCALATION_ICONS) {
    return ESCALATION_ICONS[iconKeyHint as EscalationIconKey];
  }
  if (!levelName) return ESCALATION_ICONS.default;
  const norm = levelName.toLowerCase().replace(/[\s()]/g, ' ').trim();
  if (norm.includes('board')) return ESCALATION_ICONS.board;
  if (norm.includes('general counsel') || norm.includes('legal') || norm.includes('gc')) return ESCALATION_ICONS.legal;
  if (norm.includes('c-suite') || norm.includes('cto') || norm.includes('csuite') || norm.includes('ceo') || norm.includes('cfo') || norm.includes('coo')) return ESCALATION_ICONS['c-suite'];
  if (norm.includes('vp') && (norm.includes('eng') || norm.includes('engineering'))) return ESCALATION_ICONS['vp-eng'];
  if (norm.includes('vp')) return ESCALATION_ICONS.vp;
  if (norm.includes('director') || norm.includes('dir')) return ESCALATION_ICONS.director;
  if (norm.includes('compliance')) return ESCALATION_ICONS.compliance;
  if (norm.includes('team lead') || norm.includes('team-lead') || norm.includes('lead')) return ESCALATION_ICONS['team-lead'];
  if (norm.includes('pm') || norm.includes('project manager') || norm.includes('manager')) return ESCALATION_ICONS.pm;
  return ESCALATION_ICONS.default;
}
