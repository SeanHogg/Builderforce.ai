/**
 * Governance policy packs — the authoring surface for the gates the agent runtime
 * hard-enforces.
 *
 * A pack is a named, toggleable bundle of gates scoped tenant-wide (the default)
 * or narrowed to a project and/or a specific agent. Each gate mirrors the runtime
 * `PolicyGate` exactly: a tool matcher (`*` = every tool, which is how a broad
 * deny-by-default posture is authored), one of three effects, and the directive or
 * reason text the agent is shown.
 *
 * Once saved, a gate is picked up on the NEXT run dispatched in its scope — the
 * server resolves packs at submit time and stamps them onto the run payload, where
 * the engine's `evaluatePolicyGate` seam enforces them. The "effective gates"
 * strip previews exactly that resolution.
 *
 * Reads are open to any member; every write is manager+ (RoleGate mirrors the
 * server's requireRole, and disables rather than hides).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  policyPacksApi,
  type EffectivePolicyGate,
  type PolicyGate,
  type PolicyGateEffect,
  type PolicyGateInput,
  type PolicyGateSideEffect,
  type PolicyPack,
} from '@/lib/builderforceApi';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { useConfirm } from '@/components/ConfirmProvider';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { faultMessage } from '@/lib/apiClient';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import PolicyGateEditor from './PolicyGateEditor';
import { inputStyle, labelStyle, optionStyle, primaryButton } from './policyPanelStyles';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  minWidth: 0,
};


const subtleButton: React.CSSProperties = {
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  cursor: 'pointer',
};

/** Effect → badge colours. Kept as rgba over the theme surface so both modes read. */
function effectBadgeStyle(effect: PolicyGateEffect): React.CSSProperties {
  const tone =
    effect === 'block' ? { bg: 'rgba(239,68,68,0.14)', fg: 'rgb(220,80,80)' }
      : effect === 'require-approval' ? { bg: 'rgba(234,179,8,0.16)', fg: 'rgb(190,140,20)' }
        : { bg: 'rgba(59,130,246,0.14)', fg: 'rgb(90,130,220)' };
  return {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 'var(--radius-sm)',
    whiteSpace: 'nowrap',
    background: tone.bg,
    color: tone.fg,
  };
}

interface PackDraft {
  name: string;
  description: string;
  enabled: boolean;
  projectId: number | null;
  agentRef: string;
}


export default function PolicyPacksPanel() {
  const errorMessage = useErrorMessage();
  const t = useTranslations('policyPacks');
  const confirm = useConfirm();
  const projectScope = useOptionalProjectScope();
  const projects = projectScope?.projects ?? [];

  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [effective, setEffective] = useState<EffectivePolicyGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [packDraft, setPackDraft] = useState<PackDraft | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([policyPacksApi.list(), policyPacksApi.effective()])
      .then(([list, eff]) => { setPacks(list); setEffective(eff); })
      .catch((e: Error) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [errorMessage]);

  useEffect(() => { load(); }, [load]);

  const openPack = useMemo(
    () => packs.find((p) => p.id === openPackId) ?? null,
    [packs, openPackId],
  );

  const projectName = useCallback(
    (id: number | null) => projects.find((p) => Number(p.id) === id)?.name ?? `#${id}`,
    [projects],
  );

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      setError(faultMessage(e, t('genericError')));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startCreate = () => {
    setCreating(true);
    setOpenPackId(null);
    setPackDraft({ name: '', description: '', enabled: true, projectId: null, agentRef: '' });
  };

  const startEdit = (pack: PolicyPack) => {
    setCreating(false);
    setOpenPackId(pack.id);
    setPackDraft({
      name: pack.name,
      description: pack.description ?? '',
      enabled: pack.enabled,
      projectId: pack.projectId,
      agentRef: pack.agentRef ?? '',
    });
  };

  const closePanel = () => {
    setCreating(false);
    setOpenPackId(null);
    setPackDraft(null);
  };

  const savePack = async () => {
    if (!packDraft?.name.trim()) return;
    const input = {
      name: packDraft.name.trim(),
      description: packDraft.description.trim() || null,
      enabled: packDraft.enabled,
      projectId: packDraft.projectId,
      agentRef: packDraft.agentRef.trim() || null,
    };
    if (creating) {
      await run(async () => {
        const created = await policyPacksApi.create(input);
        setCreating(false);
        setOpenPackId(created.id);
      });
    } else if (openPackId) {
      await run(() => policyPacksApi.update(openPackId, input));
    }
  };

  const togglePack = (pack: PolicyPack) =>
    run(() => policyPacksApi.update(pack.id, { enabled: !pack.enabled }));

  const removePack = async (pack: PolicyPack) => {
    const ok = await confirm({
      title: t('deletePackTitle'),
      message: t('deletePackConfirm', { name: pack.name }),
      destructive: true,
    });
    if (!ok) return;
    closePanel();
    await run(() => policyPacksApi.remove(pack.id));
  };

  const addGate = async (input: PolicyGateInput): Promise<boolean> => {
    if (!openPackId) return false;
    return run(() => policyPacksApi.addGate(openPackId, input));
  };

  const removeGate = async (gate: PolicyGate) => {
    const ok = await confirm({
      title: t('deleteGateTitle'),
      message: t('deleteGateConfirm', { key: gate.gateKey }),
      destructive: true,
    });
    if (!ok) return;
    await run(() => policyPacksApi.removeGate(gate.id));
  };

  const scopeLabel = (pack: PolicyPack): string => {
    if (pack.projectId != null && pack.agentRef) {
      return t('scopeProjectAgent', { project: projectName(pack.projectId), agent: pack.agentRef });
    }
    if (pack.projectId != null) return t('scopeProject', { project: projectName(pack.projectId) });
    if (pack.agentRef) return t('scopeAgent', { agent: pack.agentRef });
    return t('scopeTenant');
  };

  const toolLabel = (tool: string | null, sideEffect?: PolicyGateSideEffect | null) => {
    const base = !tool || tool === '*' ? (sideEffect ? '' : t('anyTool')) : tool;
    return sideEffect ? `${base ? base + ' · ' : ''}${t(`sideEffect.${sideEffect}`)}` : base;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 240px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{t('subtitle')}</p>
        </div>
        <RoleGate capability="policies.manage">
          <button type="button" onClick={startCreate} disabled={saving} style={primaryButton}>
            {t('newPack')}
          </button>
        </RoleGate>
      </div>

      {error && (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--coral-bright)' }}>
          {t('error', { message: error })}
        </div>
      )}

      {/* What a tenant-wide run is actually gated by right now — the same resolver
          the dispatcher calls, so this can never disagree with enforcement. */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('effectiveTitle')}
        </div>
        {effective.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('effectiveEmpty')}</p>
        ) : (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
              {t('effectiveCount', { count: effective.length })}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {effective.map((g) => (
                <span
                  key={g.id}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
                    padding: '4px 8px', borderRadius: 'var(--radius-md)', fontSize: 11,
                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={effectBadgeStyle(g.effect)}>{t(`effect.${g.effect}`)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{toolLabel(g.tool ?? null, g.sideEffect)}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : packs.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, fontSize: 13, color: 'var(--text-muted)' }}>
          {t('empty')}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          }}
        >
          {packs.map((pack) => (
            <div key={pack.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => startEdit(pack)}
                  style={{
                    flex: '1 1 140px', minWidth: 0, textAlign: 'left',
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  }}
                >
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {pack.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {scopeLabel(pack)}
                  </div>
                </button>
                <RoleGate capability="policies.manage" silent>
                  <button
                    type="button"
                    onClick={() => togglePack(pack)}
                    disabled={saving}
                    style={{
                      ...subtleButton,
                      color: pack.enabled ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {pack.enabled ? t('enabled') : t('disabled')}
                  </button>
                </RoleGate>
              </div>

              {pack.description && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>{pack.description}</p>
              )}

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pack.gates.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('noGates')}</span>
                ) : (
                  pack.gates.map((g) => (
                    <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={effectBadgeStyle(g.effect)}>{t(`effect.${g.effect}`)}</span>
                      <span style={{
                        fontSize: 12, color: 'var(--text-secondary)', minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {toolLabel(g.tool, g.sideEffect)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <SlideOutPanel
        open={creating || openPack != null}
        onClose={closePanel}
        title={creating ? t('newPack') : openPack?.name}
        widthStorageKey="policy-pack"
      >
        {packDraft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div>
              <label style={labelStyle} htmlFor="policy-pack-name">{t('fieldName')}</label>
              <input
                id="policy-pack-name"
                value={packDraft.name}
                onChange={(e) => setPackDraft({ ...packDraft, name: e.target.value })}
                placeholder={t('fieldNamePlaceholder')}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="policy-pack-desc">{t('fieldDescription')}</label>
              <textarea
                id="policy-pack-desc"
                value={packDraft.description}
                onChange={(e) => setPackDraft({ ...packDraft, description: e.target.value })}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <label style={labelStyle} htmlFor="policy-pack-project">{t('fieldProject')}</label>
                <select
                  id="policy-pack-project"
                  value={packDraft.projectId ?? ''}
                  onChange={(e) => setPackDraft({
                    ...packDraft,
                    projectId: e.target.value ? Number(e.target.value) : null,
                  })}
                  style={inputStyle}
                >
                  <option value="" style={optionStyle}>{t('allProjects')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)} style={optionStyle}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <label style={labelStyle} htmlFor="policy-pack-agent">{t('fieldAgent')}</label>
                <input
                  id="policy-pack-agent"
                  value={packDraft.agentRef}
                  onChange={(e) => setPackDraft({ ...packDraft, agentRef: e.target.value })}
                  placeholder={t('allAgents')}
                  style={inputStyle}
                />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={packDraft.enabled}
                onChange={(e) => setPackDraft({ ...packDraft, enabled: e.target.checked })}
              />
              {t('fieldEnabled')}
            </label>

            <RoleGate capability="policies.manage">
              <button
                type="button"
                onClick={savePack}
                disabled={saving || !packDraft.name.trim()}
                style={{ ...primaryButton, opacity: packDraft.name.trim() ? 1 : 0.5 }}
              >
                {saving ? t('saving') : creating ? t('createPack') : t('savePack')}
              </button>
            </RoleGate>

            {openPack && (
              <>
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('gatesTitle')}</div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 12px' }}>{t('gatesHelp')}</p>

                  {openPack.gates.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('noGates')}</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {openPack.gates.map((g) => (
                        <div
                          key={g.id}
                          style={{
                            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                            padding: 10, background: 'var(--bg-elevated)', minWidth: 0,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={effectBadgeStyle(g.effect)}>{t(`effect.${g.effect}`)}</span>
                            <span style={{
                              fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {g.gateKey}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: '1 1 auto', minWidth: 0 }}>
                              {toolLabel(g.tool, g.sideEffect)}
                            </span>
                            <RoleGate capability="policies.manage" silent>
                              <button
                                type="button"
                                onClick={() => removeGate(g)}
                                disabled={saving}
                                style={{ ...subtleButton, padding: '4px 8px', fontSize: 11 }}
                              >
                                {t('remove')}
                              </button>
                            </RoleGate>
                          </div>
                          {(g.directive || g.reason) && (
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0', wordBreak: 'break-word' }}>
                              {g.directive || g.reason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <PolicyGateEditor key={openPack.id} saving={saving} onAdd={addGate} />

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                  <RoleGate capability="policies.manage">
                    <button
                      type="button"
                      onClick={() => removePack(openPack)}
                      disabled={saving}
                      style={{
                        ...subtleButton,
                        color: 'var(--coral-bright)',
                        borderColor: 'var(--coral-bright)',
                      }}
                    >
                      {t('deletePack')}
                    </button>
                  </RoleGate>
                </div>
              </>
            )}
          </div>
        )}
      </SlideOutPanel>
    </div>
  );
}
