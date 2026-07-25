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
}

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
  tier, value, effective, disabled, onChange,
}: {
  tier: 'workspace' | 'project';
  /** The opinions stored AT THIS TIER (not the resolved policy). */
  value: ManagerAutonomyValue;
  /** The server-resolved policy — used only for the "inherit resolves to…" hints. */
  effective: ManagerPolicy;
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
        inheritedAs={inheritHint(effective.allowAutoMerge)}
        disabled={disabled}
        onChange={(v) => onChange({ allowAutoMerge: v })}
      />
      <TriStateRow
        label={t('policy.requireSignoff.label')}
        help={t('policy.requireSignoff.help')}
        value={value.requireSignoffToComplete}
        inheritable={workspace}
        inheritedAs={inheritHint(effective.requireSignoffToComplete)}
        disabled={disabled}
        onChange={(v) => onChange({ requireSignoffToComplete: v })}
      />
      <TriStateRow
        label={t('policy.enabled.label')}
        help={t('policy.enabled.help')}
        value={value.enabled}
        inheritable={workspace}
        inheritedAs={inheritHint(effective.enabled)}
        disabled={disabled}
        onChange={(v) => onChange({ enabled: v })}
      />
      <TriStateRow
        label={t('policy.autoBusinessValue.label')}
        help={t('policy.autoBusinessValue.help')}
        value={value.autoBusinessValue}
        inheritable={workspace}
        inheritedAs={inheritHint(effective.autoBusinessValue)}
        disabled={disabled}
        onChange={(v) => onChange({ autoBusinessValue: v })}
      />
      <TriStateRow
        label={t('policy.autoPrioritize.label')}
        help={t('policy.autoPrioritize.help')}
        value={value.autoPrioritize}
        inheritable={workspace}
        inheritedAs={inheritHint(effective.autoPrioritize)}
        disabled={disabled}
        onChange={(v) => onChange({ autoPrioritize: v })}
      />
      <TriStateRow
        label={t('policy.autoAssign.label')}
        help={t('policy.autoAssign.help')}
        value={value.autoAssign}
        inheritable={workspace}
        inheritedAs={inheritHint(effective.autoAssign)}
        disabled={disabled}
        onChange={(v) => onChange({ autoAssign: v })}
      />

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
          {t(`policy.prMerge.${value.prMergePolicy ?? effective.prMergePolicy}.help`)}
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
