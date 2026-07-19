'use client';

import { useTranslations } from 'next-intl';

import { Select } from '@/components/Select';

import type { AgentRuntimeSupport, AgentRuntimeSurface } from '@/lib/api';
import { ModelSelect } from '@/components/llm/ModelSelect';
import { PremiumModelUnlock } from '@/components/llm/PremiumModelUnlock';
import PsychometricEditor from '@/components/PsychometricEditor';
import { GithubActionsSurfaceNotice } from '@/components/repos/githubActionsSurface';
import type { PsychometricProfile } from '@/lib/psychometric';

/**
 * The cloud-agent identity field set, shared by the "Add agent" create modal
 * and the agent slide-out panel's Details tab. Keeping the fields (and their
 * form shape) in one place means the two surfaces never drift.
 */

export interface CloudAgentFormState {
  id?: string;
  name: string;
  title: string;
  bio: string;
  /**
   * Free-text discovery tags/labels (comma-separated in the form, an array on
   * the wire). Surfaced to the user as "Tags / Labels" — distinct from the
   * agent's real Skills, which are first-class capabilities assigned on the
   * Capabilities tab. These power marketplace search and SEO keywords, so they
   * persist to the established `skills` column on the agent record.
   */
  skills: string;
  baseModel: string;
  runtimeSupport: AgentRuntimeSupport;
  preferredRuntime: 'cloud' | 'host';
  /** Cloud execution surface — durable DO, long-lived node, or the repo's own
   *  GitHub Actions runners. (The engine is not user-selectable: every agent runs
   *  the current engine version.) */
  runtimeSurface: AgentRuntimeSurface;
  /** This agent's OWN personality (Pro). Compiled at run time into prompt directives,
   *  sampling temperature, and limbic setpoints. Undefined = no personality set. */
  psychometric?: PsychometricProfile;
}

export const EMPTY_CLOUD_AGENT_FORM: CloudAgentFormState = {
  name: '', title: '', bio: '', skills: '', baseModel: '', runtimeSupport: 'cloud', preferredRuntime: 'cloud',
  runtimeSurface: 'durable',
};

/**
 * Plain-string runtime-support labels, consumed OUTSIDE the form by AgentCard /
 * AgentManifestSection (which are not yet localized). The form itself renders
 * these via `useTranslations('cloudAgentForm')` (`runtime.*`). Engine + surface
 * labels are form-only and live solely in the catalogs.
 */
export const RUNTIME_LABELS: Record<AgentRuntimeSupport, string> = {
  cloud: 'Cloud only',
  host: 'Remote (self-hosted) only',
  both: 'Cloud + Remote',
};

const RUNTIME_SUPPORT_KEYS: AgentRuntimeSupport[] = ['cloud', 'host', 'both'];
const RUNTIME_SURFACE_KEYS: AgentRuntimeSurface[] = ['durable', 'container', 'github_actions'];

export const btnPrimary: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
export const btnSubtle: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-strong)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
export const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6,
};

interface FieldGroupProps {
  form: CloudAgentFormState;
  onChange: (patch: Partial<CloudAgentFormState>) => void;
  autoFocus?: boolean;
}

/** Identity fields: name, title, description, discovery tags. The slide-out panel
 *  renders this alone on its "Details" tab. */
export function CloudAgentDetailsFields({ form, onChange, autoFocus }: FieldGroupProps) {
  const t = useTranslations('cloudAgentForm');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={labelStyle}>{t('name')}</label>
        <input style={inputStyle} value={form.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={t('namePlaceholder')} autoFocus={autoFocus} />
      </div>
      <div>
        <label style={labelStyle}>{t('title')}</label>
        <input style={inputStyle} value={form.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('titlePlaceholder')} />
      </div>
      <div>
        <label style={labelStyle}>{t('description')}</label>
        <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.bio} onChange={(e) => onChange({ bio: e.target.value })} placeholder={t('descriptionPlaceholder')} />
      </div>
      <div>
        <label style={labelStyle}>{t('tags')}</label>
        <input style={inputStyle} value={form.skills} onChange={(e) => onChange({ skills: e.target.value })} placeholder={t('tagsPlaceholder')} />
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{t('tagsHelp')}</p>
      </div>
    </div>
  );
}

/** Runtime fields: where + how the agent executes (support, preferred runtime,
 *  cloud surface, base model). The slide-out panel renders this on its own
 *  "Runtime" tab. */
export function CloudAgentRuntimeFields({ form, onChange }: FieldGroupProps) {
  const t = useTranslations('cloudAgentForm');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={labelStyle}>{t('runtimeSupport')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {RUNTIME_SUPPORT_KEYS.map((rs) => (
            <label key={rs} style={{ fontSize: 13, color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="radio" name="runtimeSupport" checked={form.runtimeSupport === rs} onChange={() => onChange({ runtimeSupport: rs })} />
              {t(`runtime.${rs}`)}
            </label>
          ))}
        </div>
      </div>
      {form.runtimeSupport === 'both' && (
        <div>
          <label style={labelStyle}>{t('bestExperience')}</label>
          <Select style={inputStyle} value={form.preferredRuntime} onChange={(e) => onChange({ preferredRuntime: e.target.value as 'cloud' | 'host' })}>
            <option value="cloud">{t('bestCloud')}</option>
            <option value="host">{t('bestHost')}</option>
          </Select>
        </div>
      )}
      <div>
        <label style={labelStyle}>{t('surface')}</label>
        <Select style={inputStyle} value={form.runtimeSurface} onChange={(e) => onChange({ runtimeSurface: e.target.value as AgentRuntimeSurface })}>
          {RUNTIME_SURFACE_KEYS.map((rs) => (
            <option key={rs} value={rs}>{t(`surfaceLabel.${rs}`)}</option>
          ))}
        </Select>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{t('surfaceHelp')}</p>
        {/* Warns when "GitHub Actions" is picked for a project whose repo has no
            agent workflow — otherwise dispatch silently degrades to the durable
            executor and only says so in the run timeline afterwards. Resolves its
            own readiness (no canX prop to compute or get stale). */}
        <GithubActionsSurfaceNotice surface={form.runtimeSurface} />
      </div>
      <div>
        <label style={labelStyle}>{t('baseModel')}</label>
        <ModelSelect
          variant="coding"
          value={form.baseModel}
          onChange={(v) => onChange({ baseModel: v })}
          defaultLabel={t('baseModelDefault')}
          preserveValue={form.baseModel}
          style={inputStyle}
        />
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{t('baseModelHelp')}</p>
        {/* Renders only when premium is unlockable (paid plan + card, or upgrade) —
            it decides its own visibility, so no entitlement prop-drilling here. */}
        <div style={{ marginTop: 10 }}><PremiumModelUnlock /></div>
      </div>
    </div>
  );
}

/** Personality field: this agent's own psychometric profile. The slide-out panel
 *  renders this on its own "Personality" tab. */
export function CloudAgentPersonalityFields({ form, onChange }: FieldGroupProps) {
  const t = useTranslations('cloudAgentForm');
  return (
    <div>
      <label style={labelStyle}>{t('personality')}</label>
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 8px' }}>{t('personalityHelp')}</p>
      {/* Self-gates on the Pro entitlement (renders a locked upsell when not entitled). */}
      <PsychometricEditor value={form.psychometric} onChange={(p) => onChange({ psychometric: p })} />
    </div>
  );
}

/**
 * The full field set (Details + Runtime + Personality) stacked in one column —
 * used by the "Add agent" create modal, where everything is captured at once. The
 * slide-out panel instead renders the three groups above as separate tabs.
 */
export function CloudAgentFormFields({ form, onChange, autoFocus }: FieldGroupProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CloudAgentDetailsFields form={form} onChange={onChange} autoFocus={autoFocus} />
      <CloudAgentRuntimeFields form={form} onChange={onChange} />
      <CloudAgentPersonalityFields form={form} onChange={onChange} />
    </div>
  );
}

/**
 * Map a form back to the API input shape, shared by both create and edit paths.
 */
export function cloudAgentFormToInput(form: CloudAgentFormState) {
  return {
    name: form.name.trim(),
    title: form.title.trim() || form.name.trim(),
    bio: form.bio.trim(),
    skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
    baseModel: form.baseModel.trim() || undefined,
    runtimeSupport: form.runtimeSupport,
    preferredRuntime: form.runtimeSupport === 'both' ? form.preferredRuntime : null,
    // The engine is not sent — the server always runs the current engine version.
    runtimeSurface: form.runtimeSurface,
    // null explicitly clears a previously-set personality; undefined omits the field.
    psychometric: form.psychometric ?? null,
  };
}
