'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import type { ManagerPolicy, PrMergePolicy } from '@/lib/builderforceApi';

/**
 * The AI Manager's autonomy controls — ONE control set rendered at TWO scopes.
 *
 * The policy has three tiers (built-in default ← workspace defaults ← this project), and
 * a user configures the middle two. Rather than build two forms that drift apart, both
 * scopes render this component; `tier` decides only which fields may be left UNSET.
 *
 *   • tier 'workspace' — every field is tri-state. Leaving one on "use the built-in
 *     default" is a real, stored state (a null column), not an absence of configuration.
 *   • tier 'project'   — the legacy columns (0265) are NOT NULL, so they are plain
 *     on/off; merge authority (0363) is tri-state and defaults to inheriting the
 *     workspace answer.
 *
 * PRECEDENCE IS NEVER COMPUTED HERE. `effective` is the server's resolved verdict from
 * the single shared fold (`resolveTieredManagerPolicy`), and this component only displays
 * it. A client-side re-derivation would be a second implementation of a rule that is
 * deliberately not "nearest tier wins" — the authority gates resolve
 * most-restrictive-wins — i.e. a second chance to tell the user something the manager
 * will not actually do.
 *
 * All colours come from theme vars (light + dark), and every group wraps rather than
 * overflowing at ~360px.
 */

/** An opinion at one tier: true/false, or `null` = "no opinion, inherit downward". */
export type TriState = boolean | null;

/** The editable autonomy fields, as stored at one tier. */
export interface ManagerAutonomyValue {
  enabled: TriState;
  allowAutoMerge: TriState;
  requireSignoffToComplete: TriState;
  prMergePolicy: PrMergePolicy | null;
  autoAssign: TriState;
  autoBusinessValue: TriState;
  autoPrioritize: TriState;
  /** May the manager place UNDATED tickets on the timeline (0364)? Ranking answers
   *  "what first", this answers "when" — and until it existed nothing wrote a date. */
  autoSchedule: TriState;
  /** Ceremony autonomy (0365) — may the manager run a standup without its people, and
   *  may it move an absent person's stale work onto an agent? */
  allowUnattendedCeremonies: TriState;
  allowAgentReassignment: TriState;
  /** May the manager configure a lane that authorises NO role (0386)? Withheld by
   *  default: staffing an unconfigured stage starts every ticket sitting in it. */
  allowAutoStaffLanes: TriState;
  /** null = inherit the tier below. */
  agentReassignIdleHours: number | null;
  agentReassignMaxPerSession: number | null;
}

/** Server-side clamps, mirrored so the inputs cannot offer an ignored value. */
const IDLE_HOURS = { min: 1, max: 24 * 90 } as const;
const MAX_PER_SESSION = { min: 0, max: 50 } as const;

const PR_POLICIES: PrMergePolicy[] = ['immediate', 'on_green', 'queue'];

const mutedStyle: CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' };
const fieldLabelStyle: CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)',
};
const segmentGroupStyle: CSSProperties = {
  display: 'inline-flex', flexWrap: 'wrap', gap: 6,
  border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 4, maxWidth: '100%',
};

/** One segment of a segmented control. Theme-token colours only, wraps at narrow widths. */
function Segment({ label, title, active, disabled, onClick }: {
  label: string; title?: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        padding: '6px 11px', borderRadius: 7, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: active ? 'var(--accent, #2563eb)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/**
 * A boolean with an optional third "inherit" choice.
 *
 * Deliberately NOT a two-state switch with an "inherited" tint: "off" and "not set" are
 * different answers (one is a decision that survives a change to the workspace default,
 * the other tracks it), and a switch cannot express that difference — which is how
 * inheriting silently becomes refusing.
 */
export function TriStateRow({
  label, help, value, inheritable, inheritedAs, disabled, onChange,
}: {
  label: string;
  help: string;
  value: TriState;
  /** When false the control is a plain on/off pair (the column cannot be null). */
  inheritable: boolean;
  /** What "inherit" currently resolves to — shown so the choice is never a mystery. */
  inheritedAs?: string;
  disabled?: boolean;
  onChange: (v: TriState) => void;
}) {
  const t = useTranslations('manager');
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <span style={fieldLabelStyle}>{label}</span>
          <span style={{ display: 'block', ...mutedStyle, marginTop: 2 }}>{help}</span>
        </div>
        <div role="radiogroup" aria-label={label} style={segmentGroupStyle}>
          {inheritable && (
            <Segment
              label={t('policy.tri.inherit')}
              title={inheritedAs}
              active={value === null}
              disabled={disabled}
              onClick={() => onChange(null)}
            />
          )}
          <Segment label={t('policy.tri.on')} active={value === true} disabled={disabled} onClick={() => onChange(true)} />
          <Segment label={t('policy.tri.off')} active={value === false} disabled={disabled} onClick={() => onChange(false)} />
        </div>
      </div>
      {inheritable && value === null && inheritedAs && (
        <div style={{ ...mutedStyle, marginTop: 6, fontSize: '0.72rem' }}>{inheritedAs}</div>
      )}
    </div>
  );
}

/**
 * A GUARDRAIL NUMBER with the same "or inherit" third state as {@link TriStateRow}.
 *
 * The empty input IS the inherit state — deliberately, rather than a separate checkbox:
 * a number field that shows the inherited value as its content would make "I typed 48"
 * indistinguishable from "the tier below happens to say 48", and those diverge the moment
 * the workspace changes its mind.
 */
function NumberRow({
  label, help, value, unit, min, max, inheritedAs, disabled, onChange,
}: {
  label: string;
  help: string;
  value: number | null;
  unit: string;
  min: number;
  max: number;
  inheritedAs: string;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <span style={fieldLabelStyle}>{label}</span>
          <span style={{ display: 'block', ...mutedStyle, marginTop: 2 }}>{help}</span>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={value ?? ''}
            placeholder="—"
            disabled={disabled}
            aria-label={label}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') return onChange(null);
              const n = Number(raw);
              if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
            }}
            style={{
              width: 88, minHeight: 40, padding: '6px 10px', borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              fontSize: '0.85rem', fontWeight: 600,
            }}
          />
          <span style={mutedStyle}>{unit}</span>
        </label>
      </div>
      {value === null && <div style={{ ...mutedStyle, marginTop: 6, fontSize: '0.72rem' }}>{inheritedAs}</div>}
    </div>
  );
}

/**
 * "What the manager will actually do" — the resolved verdict, read straight off the
 * server's fold. This strip exists because a tiered policy is otherwise guessable-only:
 * a project row and a workspace default can each look permissive while the combination is
 * not, and the two settings that decide whether code lands unattended are exactly the
 * ones a user must not have to infer.
 */
export function ManagerEffectiveSummary({ effective }: { effective: ManagerPolicy }) {
  const t = useTranslations('manager');
  const chips: { text: string; tone: 'on' | 'off' }[] = [
    {
      text: effective.enabled ? t('policy.effective.managingOn') : t('policy.effective.managingOff'),
      tone: effective.enabled ? 'on' : 'off',
    },
    {
      text: effective.allowAutoMerge ? t('policy.effective.mergeGranted') : t('policy.effective.mergeWithheld'),
      tone: effective.allowAutoMerge ? 'on' : 'off',
    },
    {
      text: effective.requireSignoffToComplete
        ? t('policy.effective.signoffRequired')
        : t('policy.effective.signoffOptional'),
      tone: effective.requireSignoffToComplete ? 'on' : 'off',
    },
    {
      text: effective.allowUnattendedCeremonies
        ? t('policy.effective.ceremoniesUnattended')
        : t('policy.effective.ceremoniesNeedPeople'),
      tone: effective.allowUnattendedCeremonies ? 'on' : 'off',
    },
    {
      text: effective.allowAgentReassignment
        ? t('policy.effective.reassignGranted', { hours: effective.agentReassignIdleHours })
        : t('policy.effective.reassignWithheld'),
      tone: effective.allowAgentReassignment ? 'on' : 'off',
    },
    { text: t(`policy.prMerge.${effective.prMergePolicy}.label`), tone: 'on' },
  ];
  return (
    <div style={{
      background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
      borderRadius: 10, padding: 12, marginBottom: 16,
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
        {t('policy.effective.title')}
      </div>
      <div style={{ ...mutedStyle, marginTop: 2 }}>{t('policy.effective.help')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {chips.map((chip) => (
          <span
            key={chip.text}
            style={{
              padding: '3px 9px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
              border: '1px solid var(--border-subtle)',
              background: chip.tone === 'on' ? 'var(--bg-elevated)' : 'transparent',
              color: chip.tone === 'on' ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {chip.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The autonomy control set for ONE tier.
 *
 * `onChange` receives a single-field patch and the caller persists it (both surfaces save
 * on change, matching the rest of the manager policy form).
 */
export function ManagerAutonomyControls({
  tier, value, effective, inherited, disabled, onChange,
}: {
  tier: 'workspace' | 'project';
  /** The opinions stored AT THIS TIER (not the resolved policy). */
  value: ManagerAutonomyValue;
  /** The resolved policy INCLUDING this tier — drives the merge-authority caveat below. */
  effective: ManagerPolicy;
  /**
   * The tier BELOW this one, already resolved by the server — what a field left on
   * "use default" actually becomes. It must NOT be `effective`: for a project that has
   * turned something off, `effective` reports the project's own answer, so using it would
   * label the inherit option with the very value inheriting would replace.
   */
  inherited: ManagerPolicy;
  disabled?: boolean;
  onChange: (patch: Partial<ManagerAutonomyValue>) => void;
}) {
  const t = useTranslations('manager');
  // The workspace tier can leave anything unset. The project tier can only leave merge
  // authority unset — its other columns are NOT NULL (0265), so "unset" is not a state
  // they can hold, and offering it would be a control that silently does nothing.
  const workspace = tier === 'workspace';
  const inheritHint = (resolved: boolean) =>
    t(workspace ? 'policy.tri.builtinIs' : 'policy.tri.workspaceIs', {
      value: resolved ? t('policy.tri.on') : t('policy.tri.off'),
    });

  return (
    <div>
      {/* Merge authority first: it is the one setting that decides whether code reaches
          a default branch without a person, so it should not be the last thing found. */}
      <TriStateRow
        label={t('policy.allowAutoMerge.label')}
        help={t('policy.allowAutoMerge.help')}
        value={value.allowAutoMerge}
        inheritable
        inheritedAs={inheritHint(inherited.allowAutoMerge)}
        disabled={disabled}
        onChange={(v) => onChange({ allowAutoMerge: v })}
      />
      <TriStateRow
        label={t('policy.requireSignoff.label')}
        help={t('policy.requireSignoff.help')}
        value={value.requireSignoffToComplete}
        inheritable={workspace}
        inheritedAs={inheritHint(inherited.requireSignoffToComplete)}
        disabled={disabled}
        onChange={(v) => onChange({ requireSignoffToComplete: v })}
      />
      <TriStateRow
        label={t('policy.enabled.label')}
        help={t('policy.enabled.help')}
        value={value.enabled}
        inheritable={workspace}
        inheritedAs={inheritHint(inherited.enabled)}
        disabled={disabled}
        onChange={(v) => onChange({ enabled: v })}
      />
      <TriStateRow
        label={t('policy.autoBusinessValue.label')}
        help={t('policy.autoBusinessValue.help')}
        value={value.autoBusinessValue}
        inheritable={workspace}
        inheritedAs={inheritHint(inherited.autoBusinessValue)}
        disabled={disabled}
        onChange={(v) => onChange({ autoBusinessValue: v })}
      />
      <TriStateRow
        label={t('policy.autoPrioritize.label')}
        help={t('policy.autoPrioritize.help')}
        value={value.autoPrioritize}
        inheritable={workspace}
        inheritedAs={inheritHint(inherited.autoPrioritize)}
        disabled={disabled}
        onChange={(v) => onChange({ autoPrioritize: v })}
      />
      {/* Directly after ranking, because it is the other half of the same act: rank
          decides the order, schedule turns that order into dates. */}
      <TriStateRow
        label={t('policy.autoSchedule.label')}
        help={t('policy.autoSchedule.help')}
        value={value.autoSchedule}
        inheritable={workspace}
        inheritedAs={inheritHint(inherited.autoSchedule)}
        disabled={disabled}
        onChange={(v) => onChange({ autoSchedule: v })}
      />
      <TriStateRow
        label={t('policy.autoAssign.label')}
        help={t('policy.autoAssign.help')}
        value={value.autoAssign}
        inheritable={workspace}
        inheritedAs={inheritHint(inherited.autoAssign)}
        disabled={disabled}
        onChange={(v) => onChange({ autoAssign: v })}
      />
      {/* Directly after assignment, because it is the board-scope version of the same
          question. Assignment staffs a TICKET; this staffs a STAGE that names nobody at
          all — the one gap the manager reports every pass and cannot otherwise close. */}
      <TriStateRow
        label={t('policy.allowAutoStaffLanes.label')}
        help={t('policy.allowAutoStaffLanes.help')}
        value={value.allowAutoStaffLanes}
        inheritable
        inheritedAs={inheritHint(inherited.allowAutoStaffLanes)}
        disabled={disabled}
        onChange={(v) => onChange({ allowAutoStaffLanes: v })}
      />

      {/* CEREMONY AUTONOMY (0365) — the manager running a standup is the other thing it
          does without a person in the room, so it is governed here rather than in a
          settings screen of its own. Both grants are tri-state at BOTH tiers: unlike the
          0265 columns these are new, so "not set" is a state every project genuinely
          holds and offering only on/off would pin every project on first save. */}
      <div style={{ padding: '16px 0 0', borderTop: '1px solid var(--border-subtle)', marginTop: 4 }}>
        <span style={fieldLabelStyle}>{t('policy.ceremonies.sectionTitle')}</span>
        <div style={{ ...mutedStyle, margin: '2px 0 0' }}>{t('policy.ceremonies.sectionHelp')}</div>
      </div>
      <TriStateRow
        label={t('policy.allowUnattendedCeremonies.label')}
        help={t('policy.allowUnattendedCeremonies.help')}
        value={value.allowUnattendedCeremonies}
        inheritable
        inheritedAs={inheritHint(inherited.allowUnattendedCeremonies)}
        disabled={disabled}
        onChange={(v) => onChange({ allowUnattendedCeremonies: v })}
      />
      <TriStateRow
        label={t('policy.allowAgentReassignment.label')}
        help={t('policy.allowAgentReassignment.help')}
        value={value.allowAgentReassignment}
        inheritable
        inheritedAs={inheritHint(inherited.allowAgentReassignment)}
        disabled={disabled}
        onChange={(v) => onChange({ allowAgentReassignment: v })}
      />
      {/* The two conditions. Shown only once the grant above could actually apply —
          resolved, not local, so a project inheriting a workspace grant still sees them. */}
      {effective.allowAgentReassignment && (
        <>
          <NumberRow
            label={t('policy.agentReassignIdleHours.label')}
            help={t('policy.agentReassignIdleHours.help')}
            value={value.agentReassignIdleHours}
            unit={t('policy.agentReassignIdleHours.unit')}
            min={IDLE_HOURS.min}
            max={IDLE_HOURS.max}
            inheritedAs={t('policy.agentReassignIdleHours.inherited', { value: inherited.agentReassignIdleHours })}
            disabled={disabled}
            onChange={(v) => onChange({ agentReassignIdleHours: v })}
          />
          <NumberRow
            label={t('policy.agentReassignMaxPerSession.label')}
            help={t('policy.agentReassignMaxPerSession.help')}
            value={value.agentReassignMaxPerSession}
            unit={t('policy.agentReassignMaxPerSession.unit')}
            min={MAX_PER_SESSION.min}
            max={MAX_PER_SESSION.max}
            inheritedAs={t('policy.agentReassignMaxPerSession.inherited', { value: inherited.agentReassignMaxPerSession })}
            disabled={disabled}
            onChange={(v) => onChange({ agentReassignMaxPerSession: v })}
          />
        </>
      )}

      {/* PR merge TIMING — how a permitted merge happens, which is only meaningful once
          merge authority has been granted above. */}
      <div style={{ padding: '12px 0 0', borderTop: '1px solid var(--border-subtle)' }}>
        <span style={fieldLabelStyle}>{t('policy.prMerge.label')}</span>
        <div style={{ ...mutedStyle, margin: '2px 0 8px' }}>{t('policy.prMerge.help')}</div>
        <div role="radiogroup" aria-label={t('policy.prMerge.label')} style={segmentGroupStyle}>
          {workspace && (
            <Segment
              label={t('policy.tri.inherit')}
              active={value.prMergePolicy === null}
              disabled={disabled}
              onClick={() => onChange({ prMergePolicy: null })}
            />
          )}
          {PR_POLICIES.map((p) => (
            <Segment
              key={p}
              label={t(`policy.prMerge.${p}.label`)}
              title={t(`policy.prMerge.${p}.help`)}
              active={value.prMergePolicy === p}
              disabled={disabled}
              onClick={() => onChange({ prMergePolicy: p })}
            />
          ))}
        </div>
        <div style={{ ...mutedStyle, marginTop: 8 }}>
          {t(`policy.prMerge.${value.prMergePolicy ?? inherited.prMergePolicy}.help`)}
        </div>
        {!effective.allowAutoMerge && (
          <div style={{ ...mutedStyle, marginTop: 6, fontSize: '0.72rem' }}>
            {t('policy.prMerge.needsAuthority')}
          </div>
        )}
      </div>
    </div>
  );
}
