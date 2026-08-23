'use client';

/**
 * Board SETTINGS — the rules that hold for the whole board rather than one lane.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { boardsApi, kanbanApi, type Board } from '@/lib/builderforceApi';
import type { TemplateSummary } from '@/lib/kanban';
import { btnPrimary, btnSubtle, inputStyle, sectionPad } from './configStyles';

export function SettingsTab({ board, projectId, onSaved }: { board: Board; projectId: number; onSaved: () => void }) {
  const t = useTranslations('boardConfig');
  const confirm = useConfirm();
  const [maxConcurrent, setMaxConcurrent] = useState(board.maxConcurrentTickets);
  const [name, setName] = useState(board.name);
  const [turnMode, setTurnMode] = useState<'facilitator' | 'timeboxed'>(board.standupTurnMode ?? 'facilitator');
  const [turnSeconds, setTurnSeconds] = useState(board.standupTurnSeconds ?? 90);
  // The round table's POWER METER measured every member against a hardcoded 8 whenever
  // their profile set no cap — which is almost always. 8 stays the default so no board's
  // meter changes reading; what changes is that it is now a decision.
  const [wipCap, setWipCap] = useState(board.defaultMemberWipCap ?? 8);
  const [hideDoneItems, setHideDoneItems] = useState(board.hideDoneItems ?? false);
  // Default true: a board with the flag unset still gates high/urgent work.
  const [requireApproval, setRequireApproval] = useState(board.requireExecutionApproval ?? true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([kanbanApi.listTemplates(), kanbanApi.roster(projectId)])
      .then(([available, roster]) => {
        if (!live) return;
        setTemplates(available);
        setActiveTemplateId(roster.templateId);
        setSelectedTemplateId(roster.templateId);
      })
      .catch((e) => { if (live) setTemplateError(e instanceof Error ? e.message : t('templateLoadError')); });
    return () => { live = false; };
  }, [projectId, t]);

  const applyTemplate = async () => {
    if (!selectedTemplateId || selectedTemplateId === activeTemplateId) return;
    const selected = templates.find((template) => template.id === selectedTemplateId);
    const accepted = await confirm({
      title: t('templateConfirmTitle'),
      message: t('templateConfirmMessage', { name: selected?.name ?? selectedTemplateId }),
      confirmLabel: t('templateApply'),
      destructive: true,
    });
    if (!accepted) return;
    setTemplateBusy(true);
    setTemplateError(null);
    try {
      await kanbanApi.applyTemplate(projectId, selectedTemplateId);
      setActiveTemplateId(selectedTemplateId);
      onSaved();
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : t('templateApplyError'));
    } finally {
      setTemplateBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await boardsApi.update(board.id, {
        name: name.trim() || board.name,
        maxConcurrentTickets: maxConcurrent,
        standupTurnMode: turnMode,
        standupTurnSeconds: turnSeconds,
        defaultMemberWipCap: wipCap,
        hideDoneItems,
        requireExecutionApproval: requireApproval,
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ ...sectionPad, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
      <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)' }}>{t('templateHeading')}</div>
        <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 3 }}>{t('templateHint')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <Select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            disabled={templateBusy || templates.length === 0}
            aria-label={t('templateLabel')}
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          >
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </Select>
          <RoleGate capability="manager.manage" variant="block">
            <button
              type="button"
              style={{ ...btnPrimary, opacity: !selectedTemplateId || selectedTemplateId === activeTemplateId || templateBusy ? 0.6 : 1 }}
              disabled={!selectedTemplateId || selectedTemplateId === activeTemplateId || templateBusy}
              onClick={() => void applyTemplate()}
            >
              {templateBusy ? t('templateApplying') : t('templateApply')}
            </button>
          </RoleGate>
        </div>
        {templateError && <div style={{ marginTop: 6, fontSize: 'var(--font-size-eyebrow)', color: 'var(--danger)' }}>{templateError}</div>}
      </div>
      <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {t('boardNameLabel')}
        <input style={{ ...inputStyle, width: '100%', marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {/* Autonomy is implicit now: a lane with agents + an auto gate advances on
          its own; a human gate waits. There is no board-level autonomous toggle. */}
      <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {t('maxConcurrent')}
        <input type="number" min={1} style={{ ...inputStyle, width: 120, marginTop: 4 }} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} />
      </label>

      {/* Hide tickets sitting in a terminal (Done) lane so the board shows only
          live work. Display-only — the tickets and their history are untouched. */}
      <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={hideDoneItems} onChange={(e) => setHideDoneItems(e.target.checked)} />
        {t('hideDoneItems')}
      </label>

      {/* Governance: whether HIGH/URGENT tickets must clear a manager-approval
          request before an agent runs them. Manager-gated (disabled, not hidden,
          for non-managers) — the same control the board banner points to when it
          blocks a run. Off = the override: high/urgent work runs without approval. */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          {t('approvalHeading')}
        </div>
        <RoleGate capability="board.manageApproval" variant="block">
          <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              {t('approvalToggle')}
              <span style={{ display: 'block', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2 }}>
                {requireApproval ? t('approvalOnHint') : t('approvalOffHint')}
              </span>
            </span>
          </label>
        </RoleGate>
      </div>

      {/* Standup turn timer — drives the ceremony round-table's "who's next". */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{t('standupTimer')}</div>
        <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', display: 'block' }}>
          {t('mode')}
          <Select
            style={{ ...inputStyle, width: '100%', marginTop: 4 }}
            value={turnMode}
            onChange={(e) => setTurnMode(e.target.value as 'facilitator' | 'timeboxed')}
          >
            <option value="facilitator">{t('modeFacilitator')}</option>
            <option value="timeboxed">{t('modeTimeboxed')}</option>
          </Select>
        </label>
        {turnMode === 'timeboxed' && (
          <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', display: 'block', marginTop: 10 }}>
            {t('secondsPerPerson')}
            <input type="number" min={10} step={5} style={{ ...inputStyle, width: 120, marginTop: 4 }} value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value))} />
          </label>
        )}
        <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', display: 'block', marginTop: 10 }}>
          {t('wipCapLabel')}
          <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2 }}>{t('wipCapHint')}</div>
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            style={{ ...inputStyle, width: 120, marginTop: 4 }}
            value={wipCap}
            onChange={(e) => setWipCap(Number(e.target.value))}
          />
        </label>
      </div>

      <div>
        <button type="button" style={btnPrimary} disabled={saving} onClick={save}>{saving ? t('saving') : t('saveSettings')}</button>
      </div>
    </div>
  );
}
