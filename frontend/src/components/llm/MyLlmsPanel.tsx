'use client';

import { useEffect, useState } from 'react';
import { tenantModelApi, type TenantModel, type TenantModelInput } from '@/lib/builderforceApi';
import { invalidateLlmModels } from '@/lib/useLlmModels';
import { ModelSelect } from '@/components/llm/ModelSelect';
import { Select } from '@/components/Select';

/**
 * My LLMs — CRUD over the tenant's named model configs (migration 0211).
 *
 * An "LLM" here is a reusable bundle: { base model + system prompt + sampling
 * params }. Once saved it appears in every model picker (run control, agent base
 * model, Designer Brain) as "Your LLMs" and is selected by its `tenant_model:<slug>`
 * ref — so a cloud agent, an on-prem host, or the IDE all run it the same way.
 */

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 };

interface DraftState {
  id?: string;
  name: string;
  baseModel: string;
  systemPrompt: string;
  temperature: string;
  visibility: 'private' | 'tenant';
}

const EMPTY_DRAFT: DraftState = { name: '', baseModel: '', systemPrompt: '', temperature: '', visibility: 'tenant' };

function draftFromModel(m: TenantModel): DraftState {
  const t = m.params?.temperature;
  return {
    id: m.id,
    name: m.name,
    baseModel: m.baseModel ?? '',
    systemPrompt: m.systemPrompt ?? '',
    temperature: typeof t === 'number' ? String(t) : '',
    visibility: m.visibility,
  };
}

function draftToInput(d: DraftState): TenantModelInput {
  const params: Record<string, unknown> = {};
  const temp = parseFloat(d.temperature);
  if (!Number.isNaN(temp)) params.temperature = temp;
  return {
    name: d.name.trim(),
    baseModel: d.baseModel.trim() || null,
    systemPrompt: d.systemPrompt.trim() || null,
    params,
    visibility: d.visibility,
  };
}

export function MyLlmsPanel() {
  const [models, setModels] = useState<TenantModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    tenantModelApi.list()
      .then((r) => setModels(r.models))
      .catch(() => setError('Failed to load your LLMs.'))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const save = async () => {
    if (!draft || !draft.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const input = draftToInput(draft);
      if (draft.id) await tenantModelApi.update(draft.id, input);
      else await tenantModelApi.create(input);
      invalidateLlmModels(); // so every picker shows the new/edited LLM
      setDraft(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save LLM');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: TenantModel) => {
    if (!confirm(`Delete LLM "${m.name}"?`)) return;
    try {
      await tenantModelApi.remove(m.id);
      invalidateLlmModels();
      setModels((prev) => prev.filter((x) => x.id !== m.id));
    } catch {
      setError('Failed to delete LLM');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Your LLMs</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Named model configs your cloud agents, self-hosted agents, and the IDE can all use.
          </p>
        </div>
        {!draft && (
          <button type="button" onClick={() => setDraft({ ...EMPTY_DRAFT })} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            + New LLM
          </button>
        )}
      </div>

      {error && <div style={{ fontSize: 13, color: 'var(--danger, #dc2626)', marginBottom: 12 }}>{error}</div>}

      {draft && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Acme Coder" autoFocus />
          </div>
          <div>
            <label style={labelStyle}>Base model</label>
            <ModelSelect
              variant="coding"
              value={draft.baseModel}
              onChange={(v) => setDraft({ ...draft, baseModel: v })}
              defaultLabel="builderforce.ai default (best coding model)"
              preserveValue={draft.baseModel}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>System prompt</label>
            <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical', fontFamily: 'inherit' }} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} placeholder="Instructions prepended to every run that uses this LLM…" />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={labelStyle}>Temperature</label>
              <input style={inputStyle} type="number" step="0.1" min="0" max="2" value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: e.target.value })} placeholder="default" />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={labelStyle}>Visibility</label>
              <Select style={inputStyle} value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as 'private' | 'tenant' })}>
                <option value="tenant">Whole workspace</option>
                <option value="private">Private (just me)</option>
              </Select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDraft(null)} style={{ padding: '8px 14px', fontSize: 13, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={save} disabled={saving || !draft.name.trim()} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 8, cursor: saving || !draft.name.trim() ? 'not-allowed' : 'pointer', opacity: saving || !draft.name.trim() ? 0.7 : 1 }}>
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create LLM'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading…</div>
      ) : models.length === 0 && !draft ? (
        <div style={{ textAlign: 'center', padding: 40, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🧠</div>
          <p style={{ color: 'var(--text-secondary)' }}>No LLMs yet. Create one to reuse a model + prompt across all your agents.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {models.map((m) => (
            <div key={m.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{m.name}</strong>
                <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.ref}</code>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.baseModel ?? 'Default base model'}</div>
              {m.systemPrompt && <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{m.systemPrompt}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="button" onClick={() => setDraft(draftFromModel(m))} style={{ fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: 'var(--coral-bright)', cursor: 'pointer', padding: 0 }}>Edit</button>
                <button type="button" onClick={() => remove(m)} style={{ fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
