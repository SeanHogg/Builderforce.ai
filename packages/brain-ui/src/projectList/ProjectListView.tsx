import { useMemo } from 'react';
import {
  DEFAULT_PROJECT_LIST_LABELS,
  type ProjectListAction,
  type ProjectListItem,
  type ProjectListLabels,
  type ProjectListModel,
} from './types';

/**
 * <ProjectListView> — the shared, presentational surface for every list-shaped
 * project page (Backlog, PRDs, …). It takes a {@link ProjectListModel} (groups of
 * rows with badges + a per-row action) and a single `onAction` callback, so the VS
 * Code webview and the web app drive it identically. Themed via `--bf-*` variables
 * → works in light and dark, and reflows to one column on a narrow panel. Loading,
 * error, and empty are all handled here so a page never renders blank.
 */
export interface ProjectListViewProps {
  title: string;
  subtitle?: string;
  data: ProjectListModel | null;
  loading?: boolean;
  error?: string | null;
  labels?: Partial<ProjectListLabels>;
  onAction?: (action: ProjectListAction) => void;
  onRefresh?: () => void;
}

export function ProjectListView({ title, subtitle, data, loading, error, labels, onAction, onRefresh }: ProjectListViewProps) {
  const L = useMemo<ProjectListLabels>(() => ({ ...DEFAULT_PROJECT_LIST_LABELS, ...(labels ?? {}) }), [labels]);

  const header = (
    <header className="bf-list-head">
      <div className="bf-list-head__id">
        <span className="bf-list-head__title">{title}</span>
        {data && <span className="bf-list-head__count">{data.total} {L.items}</span>}
      </div>
      {subtitle && <div className="bf-list-head__sub">{subtitle}</div>}
      <div className="bf-list-head__spacer" />
      {onRefresh && (
        <button className="bf-btn bf-btn--icon" title={L.refresh} aria-label={L.refresh} onClick={onRefresh}>⟳</button>
      )}
    </header>
  );

  if (error) {
    return (
      <div className="bf-list">
        {header}
        <div className="bf-360-state">
          <div className="bf-360-state__title">{L.loadError}</div>
          <div className="bf-360-state__hint">{error}</div>
          {onRefresh && <button className="bf-btn" onClick={onRefresh}>{L.refresh}</button>}
        </div>
      </div>
    );
  }

  if (!data || loading) {
    return (
      <div className="bf-list">
        {header}
        <div className="bf-360-state"><div className="bf-360-spinner" />{L.connecting}</div>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="bf-list">
        {header}
        <div className="bf-360-state">
          <div className="bf-360-state__title">{L.empty}</div>
          {L.emptyHint && <div className="bf-360-state__hint">{L.emptyHint}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="bf-list">
      {header}
      {data.groups.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.key} className="bf-list-group">
          <h3 className="bf-list-group__title">
            <span className={`bf-list-group__dot bf-list-tone--${g.tone ?? 'default'}`} aria-hidden />
            {g.label}
            <span className="bf-360-section__count">{g.items.length}</span>
          </h3>
          <ul className="bf-list-rows">
            {g.items.map((it) => (
              <Row key={it.id} item={it} onAction={onAction} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ item, onAction }: { item: ProjectListItem; onAction?: (a: ProjectListAction) => void }) {
  const act = item.action;
  const clickable = !!act && !!onAction;
  return (
    <li className="bf-list-row">
      <button
        className="bf-list-row__main"
        disabled={!clickable}
        onClick={clickable ? () => onAction!(act!) : undefined}
        title={clickable ? act!.label : undefined}
      >
        {item.key && <span className="bf-list-row__key">{item.key}</span>}
        <span className="bf-list-row__body">
          <span className="bf-list-row__title">{item.title}</span>
          {item.subtitle && <span className="bf-list-row__sub">{item.subtitle}</span>}
        </span>
        {item.badges && item.badges.length > 0 && (
          <span className="bf-list-row__badges">
            {item.badges.map((b, i) => (
              <span key={i} className={`bf-list-badge bf-list-tone--${b.tone ?? 'default'}`}>{b.label}</span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}
