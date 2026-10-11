/**
 * The chat's LIVE sub-agents, above the composer — who is working for whom, what each is
 * doing right now, and the owner's levers: redirect, approve a write, stop.
 *
 * Every row is a run of its own (mirrored by run key), so its activity, its approval
 * prompt and its Stop are the run store's, exactly as for the chat's own run — this strip
 * only lays them out. Renders nothing while the chat has no live child.
 */

import { useState } from 'react';
import { resolveRunConfirm, stopRun } from '@seanhogg/builderforce-brain-embedded';
import { LiveActivity, type LiveActivityLabels } from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';
import { makeT } from './chatLabels';
import { steerRun, useChatChildren, useRunSnapshotOf, type ChildView } from './chatChildren';

interface Props {
  chatId: number | null;
  labels: LabelBundle;
  liveLabels?: Partial<LiveActivityLabels>;
}

export function SubagentStrip({ chatId, labels, liveLabels }: Props) {
  const children = useChatChildren(chatId);
  const t = makeT(labels);
  if (children.length === 0) return null;
  return (
    <section className="bf-subagents" aria-label={t('sub.region', 'Sub-agents working in this chat')}>
      <header className="bf-subagents__head">
        <span>{t('sub.title', 'Sub-agents ({count})').replace('{count}', String(children.length))}</span>
        {children.length > 1 && (
          <button className="bf-btn" onClick={() => children.forEach((c) => stopRun(c.key))}>
            {t('sub.stopAll', 'Stop all')}
          </button>
        )}
      </header>
      <ul className="bf-subagents__list">
        {children.map((child) => (
          <SubagentRow key={child.key} child={child} t={t} liveLabels={liveLabels} />
        ))}
      </ul>
    </section>
  );
}

function SubagentRow({ child, t, liveLabels }: { child: ChildView; t: ReturnType<typeof makeT>; liveLabels?: Partial<LiveActivityLabels> }) {
  const run = useRunSnapshotOf(child.key);
  const [draft, setDraft] = useState<string | null>(null);
  const send = () => {
    if (draft?.trim()) steerRun(child.key, draft.trim());
    setDraft(null);
  };
  return (
    <li className="bf-subagents__row">
      <div className="bf-subagents__who">
        <strong>{child.name}</strong>
        <span className="bf-subagents__handle">{child.handle}</span>
        <span className="bf-subagents__owner">{t('tl.subagentOf', 'sub-agent of {owner}').replace('{owner}', child.owner)}</span>
        {child.readOnly && <span className="bf-subagents__tag">{t('sub.readOnly', 'read-only')}</span>}
      </div>
      <div className="bf-subagents__label">{child.ticket ? `#${child.ticket} · ${child.label}` : child.label}</div>
      <LiveActivity activity={run.activity} isRunning={run.running} labels={liveLabels} />
      {run.pendingConfirm && (
        <div className="bf-confirm bf-subagents__confirm">
          <span>
            {t('sub.asks', '{name} wants to run').replace('{name}', child.name)} <code>{run.pendingConfirm.name}</code>
          </span>
          <div className="bf-confirm__actions">
            <button className="bf-btn bf-btn--primary" onClick={() => resolveRunConfirm(child.key, true)}>{t('app.approve', 'Approve')}</button>
            <button className="bf-btn" onClick={() => resolveRunConfirm(child.key, false)}>{t('app.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}
      {draft === null ? (
        <div className="bf-subagents__actions">
          <button className="bf-btn" onClick={() => setDraft('')}>{t('sub.redirect', 'Redirect')}</button>
          <button className="bf-btn" onClick={() => stopRun(child.key)}>{t('sub.stop', 'Stop')}</button>
        </div>
      ) : (
        <form
          className="bf-subagents__steer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }}
            placeholder={t('sub.redirectPlaceholder', 'Tell {name} what to do differently…').replace('{name}', child.name)}
            aria-label={t('sub.redirectAria', 'Direction for {name}').replace('{name}', child.name)}
          />
          <button className="bf-btn bf-btn--primary" type="submit" disabled={!draft.trim()}>{t('sub.send', 'Send')}</button>
          <button className="bf-btn" type="button" onClick={() => setDraft(null)}>{t('app.cancel', 'Cancel')}</button>
        </form>
      )}
    </li>
  );
}
