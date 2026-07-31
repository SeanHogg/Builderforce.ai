'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { listIdeContainers, updateIdeProject } from '@/lib/api';
import { workflowDefinitions, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import type { IdeProject, IdeContainerOption } from '@/lib/types';

/**
 * IDE project details — rename and (re)assign the parent Project.
 *
 * The optional-parent decision means an IDE project can be created ungrouped and
 * later associated with a Project here, or moved between Projects. Saves via
 * PATCH /api/ide-projects/:id and hands the updated row back to the caller so the
 * dashboard list refreshes without a full reload.
 */
export function IdeProjectDetailsModal({
  ideProject,
  onClose,
  onSaved,
}: {
  ideProject: IdeProject;
  onClose: () => void;
  onSaved: (updated: IdeProject) => void;
}) {
  const t = useTranslations('ide');
  const m = useModalityCopy()(ideProject.modality);

  // Evermind projects (incl. legacy `llm`, which getModality aliases to evermind)
  // can attach an optional automation workflow.
  const isEvermind = m.id === 'evermind';

  const [name, setName] = useState(ideProject.name);
  const [containerProjectId, setContainerProjectId] = useState<number | null>(ideProject.containerProjectId);
  const [workflowDefinitionId, setWorkflowDefinitionId] = useState<string | null>(ideProject.workflowDefinitionId);
  const [containers, setContainers] = useState<IdeContainerOption[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<'fork' | 'run' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedWorkflow = workflows.find((w) => w.id === workflowDefinitionId) ?? null;
  // A shared/global definition can be customized (forked) for this project; an
  // already project-scoped one is the custom copy and just runs.
  const canCustomize = !!selectedWorkflow && selectedWorkflow.executionScope !== 'project';

  // Fork the assigned shared workflow into a project-scoped custom copy and
  // re-point this project at it — the "modify → custom workflow" path.
  const customize = async () => {
    if (!selectedWorkflow || busy) return;
    setBusy('fork');
    setError(null);
    try {
      const fork = await workflowDefinitions.fork(selectedWorkflow.id, { projectId: containerProjectId });
      setWorkflows((prev) => [fork as WorkflowDefinitionSummary, ...prev]);
      setWorkflowDefinitionId(fork.id);
      setNotice(t('workflowForked'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  // Run the assigned workflow using its own saved run target.
  const run = async () => {
    if (!selectedWorkflow || busy) return;
    setBusy('run');
    setError(null);
    try {
      await workflowDefinitions.run(selectedWorkflow.id, {
        runtime: selectedWorkflow.runTargetRuntime ?? 'host',
        agentHostId: selectedWorkflow.runTargetAgentHostId ?? null,
        cloudAgentRef: selectedWorkflow.runTargetCloudAgentRef ?? null,
      });
      setNotice(t('workflowRunStarted'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    listIdeContainers()
      .then((rows) => { if (!cancelled) setContainers(rows); })
      .catch(() => { if (!cancelled) setContainers([]); });
    // Evermind projects assign a workflow — load the tenant's definitions to pick from.
    if (isEvermind) {
      workflowDefinitions.list()
        .then((rows) => { if (!cancelled) setWorkflows(rows); })
        .catch(() => { if (!cancelled) setWorkflows([]); });
    }
    return () => { cancelled = true; };
  }, [isEvermind]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateIdeProject(ideProject.id, {
        name: name.trim(),
        containerProjectId,
        ...(isEvermind ? { workflowDefinitionId } : {}),
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOutPanel
      open
      onClose={onClose}
      width="min(480px, 96vw)"
      title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span aria-hidden>{m.icon}</span> {t('ideProjectSettings')}</span>}
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
          {m.label} · <span style={{ fontFamily: 'monospace' }}>{ideProject.storageProjectKey}</span>
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          {t('detailedConfigHint')}
        </p>

        {error && (
          <div style={{ borderRadius: 8, padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}>
            {error}
          </div>
        )}

        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('nameLabel')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('parentProject')}</label>
            <Select
              value={containerProjectId ?? ''}
              onChange={(e) => setContainerProjectId(e.target.value ? Number(e.target.value) : null)}
              style={inputStyle}
            >
              <option value="">{t('ungrouped')}</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{t('parentProjectHint')}</p>
          </div>

          {isEvermind && (
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('workflowLabel')}</label>
              <Select
                value={workflowDefinitionId ?? ''}
                onChange={(e) => { setWorkflowDefinitionId(e.target.value || null); setNotice(null); }}
                style={inputStyle}
              >
                <option value="">{t('noWorkflow')}</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.executionScope === 'project' ? ` · ${t('customTag')}` : ''}</option>
                ))}
              </Select>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{t('workflowHint')}</p>
              {selectedWorkflow && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {canCustomize && (
                    <button type="button" onClick={customize} disabled={busy !== null} style={secondaryBtn}>
                      {busy === 'fork' ? t('working') : t('customizeWorkflow')}
                    </button>
                  )}
                  <button type="button" onClick={run} disabled={busy !== null} style={secondaryBtn}>
                    {busy === 'run' ? t('working') : t('runWorkflow')}
                  </button>
                </div>
              )}
              {notice && <p style={{ fontSize: 12, color: 'var(--success-text, var(--coral-bright))', marginTop: 8 }}>{notice}</p>}
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              style={{
                padding: '8px 18px', fontSize: '0.875rem', fontWeight: 600,
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: '#fff', border: 'none', borderRadius: 10,
                cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || !name.trim() ? 0.7 : 1,
              }}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      </div>
    </SlideOutPanel>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  padding: '10px 14px',
  outline: 'none',
};

const secondaryBtn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--coral-bright)',
  cursor: 'pointer',
};
