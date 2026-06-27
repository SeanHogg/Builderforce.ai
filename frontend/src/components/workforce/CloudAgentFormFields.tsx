'use client';

import { useTranslations } from 'next-intl';

import { Select } from '@/components/Select';

import type { AgentRuntimeSupport, AgentEngine, AgentRuntimeSurface } from '@/lib/api';
import { ModelSelect } from '@/components/llm/ModelSelect';

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
  /** Agent runtime engine — which agent loop runs this agent's tasks. */
  engine: AgentEngine;
  /** Execution surface for a V2 agent — durable DO vs long-lived node. */
  runtimeSurface: AgentRuntimeSurface;
}

export const EMPTY_CLOUD_AGENT_FORM: CloudAgentFormState = {
  name: '', title: '', bio: '', skills: '', baseModel: '', runtimeSupport: 'cloud', preferredRuntime: 'cloud',
  engine: 'builderforce-v2', runtimeSurface: 'durable',
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
const ENGINE_KEYS: AgentEngine[] = ['builderforce-v2', 'builderforce-v3'];
const RUNTIME_SURFACE_KEYS: AgentRuntimeSurface[] = ['durable', 'container'];

export const btnPrimary: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
export const btnSubtle: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-strong)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
export const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6,
};

export function CloudAgentFormFields({
  form,
  onChange,
  autoFocus,
}: {
  form: CloudAgentFormState;
  onChange: (patch: Partial<CloudAgentFormState>) => void;
  autoFocus?: boolean;
}) {
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
        <label style={labelStyle}>{t('engine')}</label>
        <Select style={inputStyle} value={form.engine} onChange={(e) => onChange({ engine: e.target.value as AgentEngine })}>
          {ENGINE_KEYS.map((eng) => (
            <option key={eng} value={eng}>{t(`engineLabel.${eng}`)}</option>
          ))}
        </Select>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{t('engineHelp')}</p>
      </div>
      {(form.engine === 'builderforce-v2' || form.engine === 'builderforce-v3') && (
        <div>
          <label style={labelStyle}>{t('surface')}</label>
          <Select style={inputStyle} value={form.runtimeSurface} onChange={(e) => onChange({ runtimeSurface: e.target.value as AgentRuntimeSurface })}>
            {RUNTIME_SURFACE_KEYS.map((rs) => (
              <option key={rs} value={rs}>{t(`surfaceLabel.${rs}`)}</option>
            ))}
          </Select>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{t('surfaceHelp')}</p>
        </div>
      )}
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
      </div>
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
    engine: form.engine,
    // V2 and V3 (which wraps V2) both run on a cloud surface; legacy/other engines don't.
    runtimeSurface:
      form.engine === 'builderforce-v2' || form.engine === 'builderforce-v3' ? form.runtimeSurface : undefined,
  };
}
