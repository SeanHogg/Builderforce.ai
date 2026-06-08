'use client';

import { Select } from '@/components/Select';

import { useState, useEffect, useCallback } from 'react';
import {
  updateAgent,
  deleteAgent,
  ensureWorkforceAgentBridge,
  type AgentPricingModel,
} from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';
import { canDeleteAgent } from '@/lib/agentPermissions';
import { CapabilitiesContent } from '@/components/CapabilitiesContent';
import {
  CloudAgentFormFields,
  cloudAgentFormToInput,
  inputStyle,
  labelStyle,
  type CloudAgentFormState,
} from './CloudAgentFormFields';

/**
 * Manage an existing cloud agent in a right-side drawer (matches the remote
 * AgentHost slide-out). Replaces the cramped edit modal and folds the old
 * publish/price modal in as a tab. Capabilities (Skills/Personas/Content) are
 * assigned to the agent's canonical, project-independent identity, so they
 * follow it into any context — IDE, Workflow, on-prem or cloud.
 */

export type CloudAgentPanelTab = 'details' | 'capabilities' | 'pricing';

const TABS: { id: CloudAgentPanelTab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'pricing', label: 'Pricing' },
];

const panelOverlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 9998 };
const panelDrawerStyle: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(620px, 96vw)', maxWidth: '100%',
  borderLeft: '1px solid var(--border-subtle)', boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
  zIndex: 9999, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)',
};
const btnPrimary: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const btnSubtle: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-strong)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };

function formFromAgent(a: PublishedAgent): CloudAgentFormState {
  return {
    id: a.id,
    name: a.name,
    title: a.title,
    bio: a.bio,
    skills: (a.skills ?? []).join(', '),
    baseModel: a.base_model === 'builderforce-default' ? '' : a.base_model,
    runtimeSupport: a.runtime_support ?? 'cloud',
    preferredRuntime: (a.preferred_runtime as 'cloud' | 'host') ?? 'cloud',
    engine: a.engine ?? 'builderforce-v1',
  };
}

export interface CloudAgentSlideOutPanelProps {
  agent: PublishedAgent;
  open: boolean;
  onClose: () => void;
  tenantId?: number;
  initialTab?: CloudAgentPanelTab;
  /** Called after a save/publish so the parent list can refresh. */
  onSaved: () => void;
  onDeleted: (id: string) => void;
}

export function CloudAgentSlideOutPanel({
  agent,
  open,
  onClose,
  tenantId,
  initialTab = 'details',
  onSaved,
  onDeleted,
}: CloudAgentSlideOutPanelProps) {
  const [activeTab, setActiveTab] = useState<CloudAgentPanelTab>(initialTab);
  const [form, setForm] = useState<CloudAgentFormState>(() => formFromAgent(agent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Canonical (project-less) identity id — the scopeId for per-agent capabilities.
  const [bridgeId, setBridgeId] = useState<number | null>(null);
  const [bridgeError, setBridgeError] = useState('');

  // Pricing sub-state
  const [priceDollars, setPriceDollars] = useState('0');
  const [pricingModel, setPricingModel] = useState<AgentPricingModel>('flat_fee');
  const [priceUnit, setPriceUnit] = useState('');

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    setForm(formFromAgent(agent));
    setPriceDollars(((agent.price_cents ?? 0) / 100).toFixed(2));
    setPricingModel(agent.pricing_model ?? 'flat_fee');
    setPriceUnit(agent.price_unit ?? '');
    setError('');
  }, [open, agent, initialTab]);

  // Resolve the canonical identity once the panel opens, so the Capabilities
  // tab can assign skills/personas against it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBridgeError('');
    ensureWorkforceAgentBridge(agent.id)
      .then((id) => { if (!cancelled) setBridgeId(id); })
      .catch((e) => { if (!cancelled) setBridgeError(e instanceof Error ? e.message : 'Failed to load capabilities'); });
    return () => { cancelled = true; };
  }, [open, agent.id]);

  const saveDetails = useCallback(async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      await updateAgent(agent.id, cloudAgentFormToInput(form));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [agent.id, form, onSaved]);

  const savePricing = useCallback(async (publish: boolean) => {
    setSaving(true); setError('');
    const priceCents = Math.max(0, Math.round(parseFloat(priceDollars || '0') * 100));
    try {
      await updateAgent(agent.id, {
        published: publish,
        priceCents,
        pricingModel,
        priceUnit: pricingModel === 'consumption' ? (priceUnit.trim() || 'request') : null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [agent.id, priceDollars, pricingModel, priceUnit, onSaved]);

  const remove = useCallback(async () => {
    if (!confirm(`Delete agent "${agent.name}"? Its per-agent skills and personas will be cleared.`)) return;
    setSaving(true);
    try {
      await deleteAgent(agent.id);
      onDeleted(agent.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setSaving(false);
    }
  }, [agent.id, agent.name, onDeleted, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="project-panel-overlay slide-panel-overlay" role="presentation" style={panelOverlayStyle} onClick={onClose} aria-hidden />
      <div className="project-panel-drawer slide-panel-drawer" style={panelDrawerStyle} role="dialog" aria-label="Cloud agent">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} aria-label="Close panel" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-strong)' }}>{agent.name}</div>
            {agent.title && agent.title !== agent.name && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{agent.title}</div>
            )}
          </div>
          {agent.published
            ? <span className="badge-green">PUBLISHED</span>
            : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: 'var(--bg-elevated)', color: 'var(--muted)' }}>DRAFT</span>}
          {canDeleteAgent(agent) && (
            <button type="button" onClick={remove} disabled={saving} style={{ ...btnSubtle, color: 'var(--error-text)' }}>Delete</button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '0 20px', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto', flexShrink: 0 }}>
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)} style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: activeTab === id ? 'var(--coral-bright)' : 'var(--text-secondary)', background: 'none', border: 'none', borderBottom: activeTab === id ? '2px solid var(--coral-bright)' : '2px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {error && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}

          {activeTab === 'details' && (
            <>
              <CloudAgentFormFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
                <button type="button" onClick={saveDetails} disabled={saving || !form.name.trim()} style={btnPrimary}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}

          {activeTab === 'capabilities' && (
            bridgeError ? (
              <div style={{ fontSize: 13, color: 'var(--error-text)', padding: 16 }}>{bridgeError}</div>
            ) : bridgeId == null ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: 16 }}>Loading capabilities…</div>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0, marginBottom: 14 }}>
                  Skills and personas assigned here travel with this agent everywhere it runs — IDE, Workflow, on-prem or cloud — independent of any project.
                </p>
                <CapabilitiesContent
                  scope="agent"
                  scopeId={bridgeId}
                  tenantId={tenantId != null ? String(tenantId) : undefined}
                  hideSections={['governance']}
                />
              </>
            )
          )}

          {activeTab === 'pricing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                Set a price to publish <strong>{agent.name}</strong> to the marketplace. Use 0 to list it for free.
              </p>
              <div>
                <label style={labelStyle}>Pricing model</label>
                <Select style={inputStyle} value={pricingModel} onChange={(e) => setPricingModel(e.target.value as AgentPricingModel)}>
                  <option value="flat_fee">Flat fee</option>
                  <option value="consumption">Consumption (per unit)</option>
                </Select>
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
                {agent.published && (
                  <button type="button" onClick={() => savePricing(false)} disabled={saving} style={btnSubtle}>Unpublish</button>
                )}
                <button type="button" onClick={() => savePricing(true)} disabled={saving} style={btnPrimary}>
                  {saving ? 'Saving…' : agent.published ? 'Save price' : 'Publish'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
