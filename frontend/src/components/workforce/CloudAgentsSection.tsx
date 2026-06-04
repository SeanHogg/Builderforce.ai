'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listMyAgents,
  createCloudAgent,
  updateAgent,
  deleteAgent,
  type CloudAgentInput,
  type AgentRuntimeSupport,
  type AgentPricingModel,
} from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';

/**
 * Workforce → "Your agents". Create a cloud agent, declare which runtime(s) it
 * supports (cloud / remote agentHost / both + a best-experience hint), and publish it
 * to the marketplace with a price to generate revenue.
 */

const RUNTIME_LABELS: Record<AgentRuntimeSupport, string> = {
  cloud: 'Cloud only',
  host: 'Remote (self-hosted) only',
  both: 'Cloud + Remote',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6 };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const btnSubtle: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-strong)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };

function priceLabel(a: PublishedAgent): string {
  if (!a.price_cents) return 'Free';
  const dollars = (a.price_cents / 100).toFixed(2);
  return a.pricing_model === 'consumption' ? `$${dollars}${a.price_unit ? ` / ${a.price_unit}` : ' / unit'}` : `$${dollars}`;
}

interface FormState {
  id?: string;
  name: string;
  title: string;
  bio: string;
  skills: string;
  baseModel: string;
  runtimeSupport: AgentRuntimeSupport;
  preferredRuntime: 'cloud' | 'host';
}

const EMPTY_FORM: FormState = {
  name: '', title: '', bio: '', skills: '', baseModel: '', runtimeSupport: 'cloud', preferredRuntime: 'cloud',
};

export function CloudAgentsSection() {
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Publish modal
  const [publishTarget, setPublishTarget] = useState<PublishedAgent | null>(null);
  const [priceDollars, setPriceDollars] = useState('0');
  const [pricingModel, setPricingModel] = useState<AgentPricingModel>('flat_fee');
  const [priceUnit, setPriceUnit] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    listMyAgents()
      .then(setAgents)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load agents'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY_FORM); setFormOpen(true); setError(''); };
  const openEdit = (a: PublishedAgent) => {
    setForm({
      id: a.id, name: a.name, title: a.title, bio: a.bio,
      skills: (a.skills ?? []).join(', '),
      baseModel: a.base_model === 'builderforce-default' ? '' : a.base_model,
      runtimeSupport: a.runtime_support ?? 'cloud',
      preferredRuntime: (a.preferred_runtime as 'cloud' | 'host') ?? 'cloud',
    });
    setFormOpen(true); setError('');
  };

  const saveForm = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    const payload: CloudAgentInput = {
      name: form.name.trim(),
      title: form.title.trim() || form.name.trim(),
      bio: form.bio.trim(),
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      baseModel: form.baseModel.trim() || undefined,
      runtimeSupport: form.runtimeSupport,
      preferredRuntime: form.runtimeSupport === 'both' ? form.preferredRuntime : null,
    };
    try {
      if (form.id) await updateAgent(form.id, payload);
      else await createCloudAgent(payload);
      setFormOpen(false); setForm(EMPTY_FORM); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const openPublish = (a: PublishedAgent) => {
    setPublishTarget(a);
    setPriceDollars(((a.price_cents ?? 0) / 100).toFixed(2));
    setPricingModel(a.pricing_model ?? 'flat_fee');
    setPriceUnit(a.price_unit ?? '');
  };

  const confirmPublish = async () => {
    if (!publishTarget) return;
    const priceCents = Math.max(0, Math.round(parseFloat(priceDollars || '0') * 100));
    await updateAgent(publishTarget.id, {
      published: true,
      priceCents,
      pricingModel,
      priceUnit: pricingModel === 'consumption' ? (priceUnit.trim() || 'request') : null,
    });
    setPublishTarget(null); load();
  };

  const unpublish = async (a: PublishedAgent) => { await updateAgent(a.id, { published: false }); load(); };
  const remove = async (a: PublishedAgent) => { if (confirm(`Delete agent "${a.name}"?`)) { await deleteAgent(a.id); load(); } };

  return (
    <section style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Your agents</h2>
        <button type="button" onClick={openCreate} style={btnPrimary}>+ Create cloud agent</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Build a cloud agent, choose which runtime(s) it supports, and publish it to the marketplace to earn revenue.
      </p>

      {error && !formOpen && !publishTarget && (
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading agents…</div>
      ) : agents.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No agents yet. Create one to start building your workforce.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {agents.map((a) => (
            <div key={a.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{a.name}</span>
                {a.published
                  ? <span className="badge-green">PUBLISHED</span>
                  : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: 'var(--bg-elevated)', color: 'var(--muted)' }}>DRAFT</span>}
              </div>
              {a.title && a.title !== a.name && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.title}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                <span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--accent)' }}>
                  {RUNTIME_LABELS[a.runtime_support ?? 'cloud']}
                  {a.runtime_support === 'both' && a.preferred_runtime ? ` · prefers ${a.preferred_runtime}` : ''}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-strong)' }}>{priceLabel(a)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {a.published
                  ? <button type="button" style={btnSubtle} onClick={() => unpublish(a)}>Unpublish</button>
                  : <button type="button" style={btnPrimary} onClick={() => openPublish(a)}>Publish</button>}
                {a.published && <button type="button" style={btnSubtle} onClick={() => openPublish(a)}>Edit price</button>}
                <button type="button" style={btnSubtle} onClick={() => openEdit(a)}>Edit</button>
                <button type="button" style={{ ...btnSubtle, color: 'var(--error-text)' }} onClick={() => remove(a)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit agent modal */}
      {formOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setFormOpen(false)}>
          <div className="card" style={{ maxWidth: 480, width: '100%', padding: 28, maxHeight: '88vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 16 }}>
              {form.id ? 'Edit agent' : 'Create cloud agent'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Release Notes Writer" autoFocus />
              </div>
              <div>
                <label style={labelStyle}>Title</label>
                <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short tagline" />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="What does this agent do?" />
              </div>
              <div>
                <label style={labelStyle}>Skills (comma-separated)</label>
                <input style={inputStyle} value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="code-review, summarization" />
              </div>
              <div>
                <label style={labelStyle}>Runtime support</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(Object.keys(RUNTIME_LABELS) as AgentRuntimeSupport[]).map((rs) => (
                    <label key={rs} style={{ fontSize: 13, color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="radio" name="runtimeSupport" checked={form.runtimeSupport === rs} onChange={() => setForm({ ...form, runtimeSupport: rs })} />
                      {RUNTIME_LABELS[rs]}
                    </label>
                  ))}
                </div>
              </div>
              {form.runtimeSupport === 'both' && (
                <div>
                  <label style={labelStyle}>Best experience on</label>
                  <select style={inputStyle} value={form.preferredRuntime} onChange={(e) => setForm({ ...form, preferredRuntime: e.target.value as 'cloud' | 'host' })}>
                    <option value="cloud">Cloud</option>
                    <option value="host">Remote (agentHost)</option>
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>Base model (optional)</label>
                <input style={inputStyle} value={form.baseModel} onChange={(e) => setForm({ ...form, baseModel: e.target.value })} placeholder="builderforce.ai default" />
              </div>
              {error && <div style={{ fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setFormOpen(false)} style={{ ...btnSubtle, background: 'none', border: 'none' }}>Cancel</button>
                <button type="button" onClick={saveForm} disabled={saving || !form.name.trim()} style={btnPrimary}>
                  {saving ? 'Saving…' : form.id ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Publish (set price) modal */}
      {publishTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setPublishTarget(null)}>
          <div className="card" style={{ maxWidth: 420, width: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Publish to marketplace</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Set a price for <strong>{publishTarget.name}</strong>. Use 0 to list it for free.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Pricing model</label>
                <select style={inputStyle} value={pricingModel} onChange={(e) => setPricingModel(e.target.value as AgentPricingModel)}>
                  <option value="flat_fee">Flat fee</option>
                  <option value="consumption">Consumption (per unit)</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Price (USD)</label>
                <input style={inputStyle} type="number" min="0" step="0.01" value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} />
              </div>
              {pricingModel === 'consumption' && (
                <div>
                  <label style={labelStyle}>Per unit</label>
                  <input style={inputStyle} value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="request, 1k tokens, task…" />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setPublishTarget(null)} style={{ ...btnSubtle, background: 'none', border: 'none' }}>Cancel</button>
                <button type="button" onClick={confirmPublish} style={btnPrimary}>{publishTarget.published ? 'Save price' : 'Publish'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
