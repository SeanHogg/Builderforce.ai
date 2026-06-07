'use client';

import type { AgentRuntimeSupport, AgentEngine } from '@/lib/api';

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
}

export const EMPTY_CLOUD_AGENT_FORM: CloudAgentFormState = {
  name: '', title: '', bio: '', skills: '', baseModel: '', runtimeSupport: 'cloud', preferredRuntime: 'cloud',
  engine: 'builderforce-v1',
};

export const RUNTIME_LABELS: Record<AgentRuntimeSupport, string> = {
  cloud: 'Cloud only',
  host: 'Remote (self-hosted) only',
  both: 'Cloud + Remote',
};

export const ENGINE_LABELS: Record<AgentEngine, string> = {
  'builderforce-v1': 'BuilderForce-V1 (pi-coding-agent)',
  'builderforce-v2': 'BuilderForce-V2 (Anthropic — Claude Agent SDK)',
};

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={labelStyle}>Name</label>
        <input style={inputStyle} value={form.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Release Notes Writer" autoFocus={autoFocus} />
      </div>
      <div>
        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={form.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Short tagline" />
      </div>
      <div>
        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.bio} onChange={(e) => onChange({ bio: e.target.value })} placeholder="What does this agent do?" />
      </div>
      <div>
        <label style={labelStyle}>Tags / Labels (comma-separated)</label>
        <input style={inputStyle} value={form.skills} onChange={(e) => onChange({ skills: e.target.value })} placeholder="code-review, release-notes, summarization" />
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>
          Keywords used for marketplace search and SEO discovery. These are tags, not the agent’s Skills — assign Skills on the Capabilities tab.
        </p>
      </div>
      <div>
        <label style={labelStyle}>Runtime support</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(Object.keys(RUNTIME_LABELS) as AgentRuntimeSupport[]).map((rs) => (
            <label key={rs} style={{ fontSize: 13, color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="radio" name="runtimeSupport" checked={form.runtimeSupport === rs} onChange={() => onChange({ runtimeSupport: rs })} />
              {RUNTIME_LABELS[rs]}
            </label>
          ))}
        </div>
      </div>
      {form.runtimeSupport === 'both' && (
        <div>
          <label style={labelStyle}>Best experience on</label>
          <select style={inputStyle} value={form.preferredRuntime} onChange={(e) => onChange({ preferredRuntime: e.target.value as 'cloud' | 'host' })}>
            <option value="cloud">Cloud</option>
            <option value="host">Remote (agentHost)</option>
          </select>
        </div>
      )}
      <div>
        <label style={labelStyle}>Agent runtime engine</label>
        <select style={inputStyle} value={form.engine} onChange={(e) => onChange({ engine: e.target.value as AgentEngine })}>
          {(Object.keys(ENGINE_LABELS) as AgentEngine[]).map((eng) => (
            <option key={eng} value={eng}>{ENGINE_LABELS[eng]}</option>
          ))}
        </select>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>
          V1 runs the pi-coding-agent loop. V2 runs the Claude Agent SDK; models route through the gateway with your tenant’s Anthropic key.
        </p>
      </div>
      <div>
        <label style={labelStyle}>Base model (optional)</label>
        <input style={inputStyle} value={form.baseModel} onChange={(e) => onChange({ baseModel: e.target.value })} placeholder="builderforce.ai default" />
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
  };
}
