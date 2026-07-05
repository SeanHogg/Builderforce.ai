import { useMemo, useState } from 'react';
import { Sunburst } from './Sunburst';
import {
  DEFAULT_PROJECT360_LABELS,
  type Project360,
  type Project360Action,
  type Project360Gap,
  type Project360Labels,
  type Project360Member,
} from './types';

/**
 * <Project360View> — the whole-picture project management surface. A two-ring
 * health wheel, the overall score + counts, a severity-ranked "missing items"
 * checklist whose every row carries a one-click improve action, and the live
 * workforce (who is working / idle and why). Presentational + reusable: it takes
 * the {@link Project360} model and a single `onAction` callback, so the VS Code
 * webview and the web app drive it identically. Themed via `--bf-*` variables →
 * works in light and dark, and reflows to one column on a narrow panel.
 */

export interface Project360ViewProps {
  data: Project360 | null;
  loading?: boolean;
  error?: string | null;
  labels?: Partial<Project360Labels>;
  /** Perform a gap/workforce/header action (open board, ask Brain, run/open a task…). */
  onAction?: (action: Project360Action) => void;
  onRefresh?: () => void;
}

const STATUS_ORDER: Project360Member['status'][] = ['working', 'awaiting', 'blocked', 'idle', 'available'];

export function Project360View({ data, loading, error, labels, onAction, onRefresh }: Project360ViewProps) {
  const L = useMemo<Project360Labels>(() => ({ ...DEFAULT_PROJECT360_LABELS, ...(labels ?? {}) }), [labels]);
  const [selected, setSelected] = useState<string | null>(null);
  // Sort the roster once per data change, not on every render (e.g. dimension clicks).
  // Hoisted above the early returns below to keep hook order stable.
  const sortedWorkforce = useMemo(
    () => [...(data?.workforce ?? [])].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [data?.workforce],
  );

  if (error) {
    return (
      <div className="bf-360-state">
        <div className="bf-360-state__title">{L.loadError}</div>
        <div className="bf-360-state__hint">{error}</div>
        {onRefresh && (
          <button className="bf-btn" onClick={onRefresh}>{L.refresh}</button>
        )}
      </div>
    );
  }
  if (!data || loading) {
    return <div className="bf-360-state"><div className="bf-360-spinner" />{L.connecting}</div>;
  }

  const { project, overall, counts, pillars, dimensions, gaps, workforce, hasData } = data;
  const selectedDim = selected ? dimensions.find((d) => d.key === selected) ?? null : null;
  const shownGaps = selectedDim ? gaps.filter((g) => g.dimension === selected) : gaps;

  const improveAll = () => {
    if (!gaps.length) return;
    const lines = gaps.map((g) => `- ${g.title}`).join('\n');
    onAction?.({
      kind: 'brain',
      label: L.improveAll,
      text: `${L.improveSeedIntro}\n\nProject: "${project.name}" (overall health ${overall.score}/100).\nGaps:\n${lines}`,
    });
  };

  return (
    <div className="bf-360">
      <header className="bf-360-head">
        <div className="bf-360-head__id">
          <span className="bf-360-head__title">{project.name}</span>
          {project.key && <span className="bf-360-head__key">{project.key}</span>}
        </div>
        <div className="bf-360-head__spacer" />
        <button className="bf-btn" onClick={() => onAction?.({ kind: 'board', label: L.openBoard })}>{L.openBoard}</button>
        {gaps.length > 0 && (
          <button className="bf-btn bf-btn--primary" onClick={improveAll}>{L.improveAll}</button>
        )}
        {onRefresh && (
          <button className="bf-btn bf-btn--icon" title={L.refresh} aria-label={L.refresh} onClick={onRefresh}>⟳</button>
        )}
      </header>

      {!hasData ? (
        <div className="bf-360-state">
          <div className="bf-360-state__title">{L.noData}</div>
          <div className="bf-360-state__hint">{L.noDataHint}</div>
          <button className="bf-btn" onClick={() => onAction?.({ kind: 'board', label: L.openBoard })}>{L.openBoard}</button>
        </div>
      ) : (
        <div className="bf-360-grid">
          {/* Wheel + overall */}
          <section className="bf-360-col bf-360-col--wheel">
            <Sunburst
              pillars={pillars}
              dimensions={dimensions}
              overall={overall}
              selected={selected}
              onSelect={setSelected}
              ariaLabel={`${project.name} health wheel`}
            />
            <div className="bf-360-overall">
              <div className="bf-360-progress" aria-label={`${L.progress} ${overall.progressPct}%`}>
                <div className="bf-360-progress__fill" style={{ width: `${overall.progressPct}%`, background: overall.color }} />
              </div>
              <div className="bf-360-progress__label">{L.progress}: {overall.progressPct}%</div>
              <div className="bf-360-counts">
                <Count n={counts.open} label={L.counts_open} />
                <Count n={counts.blocked} label={L.counts_blocked} tone={counts.blocked ? 'warn' : undefined} />
                <Count n={counts.overdue} label={L.counts_overdue} tone={counts.overdue ? 'bad' : undefined} />
                <Count n={counts.activeRuns} label={L.counts_running} tone={counts.activeRuns ? 'good' : undefined} />
              </div>
            </div>
          </section>

          {/* Detail: selected dimension or all pillars/dimensions legend */}
          <section className="bf-360-col bf-360-col--detail">
            <div className="bf-360-legend-head">
              <span>{selectedDim ? selectedDim.label : L.allDimensions}</span>
              {selectedDim && (
                <button className="bf-360-clear" onClick={() => setSelected(null)}>{L.allDimensions} ✕</button>
              )}
            </div>
            {selectedDim ? (
              <div className="bf-360-dim-detail">
                <ScoreDot score={selectedDim.score} color={selectedDim.color} />
                <div className="bf-360-dim-detail__summary">{selectedDim.summary}</div>
              </div>
            ) : (
              <ul className="bf-360-dim-list">
                {dimensions.map((d) => (
                  <li key={d.key}>
                    <button
                      className="bf-360-dim-row"
                      onClick={() => setSelected(d.key)}
                    >
                      <ScoreDot score={d.score} color={d.color} />
                      <span className="bf-360-dim-row__label">{d.label}</span>
                      <span className="bf-360-dim-row__summary">{d.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {hasData && (
        <>
          {/* Missing items — improve health */}
          <section className="bf-360-section">
            <h3 className="bf-360-section__title">
              {L.missingItems}
              {shownGaps.length > 0 && <span className="bf-360-section__count">{shownGaps.length}</span>}
            </h3>
            {shownGaps.length === 0 ? (
              <p className="bf-360-empty">{L.noGaps}</p>
            ) : (
              <ul className="bf-360-gaps">
                {shownGaps.map((g) => (
                  <GapRow key={g.id} gap={g} onAction={onAction} />
                ))}
              </ul>
            )}
          </section>

          {/* Who's working / idle */}
          <section className="bf-360-section">
            <h3 className="bf-360-section__title">
              {L.workforce}
              {workforce.length > 0 && <span className="bf-360-section__count">{workforce.length}</span>}
            </h3>
            {workforce.length === 0 ? (
              <p className="bf-360-empty">{L.noWorkforce}</p>
            ) : (
              <ul className="bf-360-people">
                {sortedWorkforce.map((m) => (
                  <MemberRow key={m.ref} member={m} labels={L} onAction={onAction} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <span className={`bf-360-count${tone ? ` bf-360-count--${tone}` : ''}`}>
      <b>{n}</b> {label}
    </span>
  );
}

function ScoreDot({ score, color }: { score: number; color: string }) {
  return (
    <span className="bf-360-scoredot" style={{ borderColor: color, color }}>{score}</span>
  );
}

function GapRow({ gap, onAction }: { gap: Project360Gap; onAction?: (a: Project360Action) => void }) {
  return (
    <li className={`bf-360-gap bf-360-gap--${gap.severity}`}>
      <span className={`bf-360-sev bf-360-sev--${gap.severity}`} aria-hidden />
      <div className="bf-360-gap__body">
        <div className="bf-360-gap__title">{gap.title}</div>
        {gap.detail && <div className="bf-360-gap__detail">{gap.detail}</div>}
      </div>
      {gap.action && (
        <button className="bf-btn bf-360-gap__cta" onClick={() => onAction?.(gap.action!)}>
          {gap.action.label}
        </button>
      )}
    </li>
  );
}

function MemberRow({ member, labels, onAction }: { member: Project360Member; labels: Project360Labels; onAction?: (a: Project360Action) => void }) {
  const statusLabel = ({
    working: labels.status_working,
    awaiting: labels.status_awaiting,
    blocked: labels.status_blocked,
    idle: labels.status_idle,
    available: labels.status_available,
  } as const)[member.status];
  const task = member.taskId != null ? { id: member.taskId, key: member.taskKey, title: member.taskTitle ?? '' } : undefined;
  return (
    <li className="bf-360-person">
      <span className={`bf-360-dot bf-360-dot--${member.status}`} title={statusLabel} aria-label={statusLabel} />
      <div className="bf-360-person__body">
        <div className="bf-360-person__top">
          <span className="bf-360-person__name">{member.name}</span>
          <span className={`bf-360-kind bf-360-kind--${member.kind}`}>{member.kind}</span>
          <span className="bf-360-person__status">{statusLabel}</span>
        </div>
        <div className="bf-360-person__reason">{member.reason}</div>
      </div>
      {task && (
        <div className="bf-360-person__actions">
          {(member.status === 'idle' || member.status === 'available') && member.kind !== 'human' && (
            <button className="bf-btn bf-360-person__btn" onClick={() => onAction?.({ kind: 'run-task', label: labels.member_run, task })}>{labels.member_run}</button>
          )}
          <button className="bf-btn bf-360-person__btn" onClick={() => onAction?.({ kind: 'open-task', label: labels.member_open, task })}>{labels.member_open}</button>
        </div>
      )}
    </li>
  );
}
