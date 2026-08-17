'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  MarkerType,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { ManagerAction, ManagerOverview } from '@/lib/builderforceApi';
import { managerActionIcon } from '@/lib/managerActions';
import styles from './ManagerCanvas.module.css';
import { Icon } from '@/components/ui/Icon';
import { WorkspaceCanvas, type WorkspaceCanvasPanel } from '@/components/workspace-canvas/WorkspaceCanvas';

interface CanvasMetric { label: string; value: string | number; alert?: boolean }
interface CanvasItem { icon: string; title: string; detail?: string | null; when?: string }
interface ManagerCanvasNodeData extends Record<string, unknown> {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  href?: string;
  footer?: string;
  badge?: string;
  tone?: 'manager' | 'warning' | 'activity';
  metrics?: CanvasMetric[];
  items?: CanvasItem[];
  emptyLabel?: string;
  openLabel?: string;
  runLabel?: string;
  running?: boolean;
  onRun?: () => void;
  openCanvasLabel?: string;
  openingCanvas?: boolean;
  onOpenCanvas?: () => void;
}

type ManagerMapNode = Node<ManagerCanvasNodeData, 'managerMap'>;

function ManagerArtifactBody({ data }: { data: ManagerCanvasNodeData }) {
  return (
    <div data-tone={data.tone}>
      <div className={styles.artifactIntro}><p className={styles.description}>{data.description}</p>{data.badge && <span className={styles.badge}>{data.badge}</span>}</div>
      {data.metrics && data.metrics.length > 0 && (
        <div className={styles.metrics}>
          {data.metrics.map((metric) => (
            <div className={styles.metric} data-alert={metric.alert || undefined} key={metric.label}>
              <b>{metric.value}</b><span>{metric.label}</span>
            </div>
          ))}
        </div>
      )}
      {data.items && (
        <div className={styles.body}>
          {data.items.length > 0 ? (
            <ul className={styles.list}>
              {data.items.map((item, index) => (
                <li className={styles.listItem} key={`${item.title}-${index}`}>
                  <span className={styles.listIcon} aria-hidden><Icon source={item.icon} size={18} /></span>
                  <span className={styles.listCopy}><b>{item.title}</b>{item.detail && <span>{item.detail}</span>}</span>
                  {item.when && <time>{item.when}</time>}
                </li>
              ))}
            </ul>
          ) : <p className={styles.empty}>{data.emptyLabel}</p>}
        </div>
      )}
      {data.onRun && (
        <div className={`${styles.body} nodrag nopan`}>
          <button className={styles.run} type="button" disabled={data.running} onClick={data.onRun}>
            {data.runLabel}
          </button>
          {data.onOpenCanvas && (
            <button className={styles.run} type="button" disabled={data.openingCanvas} onClick={data.onOpenCanvas}>
              {data.openCanvasLabel}
            </button>
          )}
        </div>
      )}
      {(data.href || data.footer) && (
        <footer className={`${styles.footer} nodrag nopan`}>
          <span>{data.footer}</span>
          {data.href && <Link className={styles.open} href={data.href}>{data.openLabel ?? 'Open'} →</Link>}
        </footer>
      )}
    </div>
  );
}

export interface ManagerCanvasProps {
  overview: ManagerOverview;
  managerName: string;
  managerType: string;
  lastManaged: string;
  running: boolean;
  canManage: boolean;
  onRun: () => void;
  openingCanvas?: boolean;
  onOpenCanvas?: () => void;
  relative: (iso: string | null) => string;
  actionLabel: (action: ManagerAction) => string;
  labels: {
    canvas: string;
    live: string;
    open: string;
    run: string;
    running: string;
    openCanvas: string;
    openingCanvas: string;
    policy: string;
    policyDescription: string;
    backlog: string;
    backlogDescription: string;
    stuck: string;
    stuckDescription: string;
    ask: string;
    askDescription: string;
    today: string;
    todayDescription: string;
    activity: string;
    activityDescription: string;
    total: string;
    unscored: string;
    unowned: string;
    flagged: string;
    runTasks: string;
    actions: string;
    directives: string;
    autoAssign: string;
    autoMerge: string;
    openPullRequests: string;
    blockedPullRequests: string;
    enabled: string;
    paused: string;
    emptyActivity: string;
  };
}

export function buildManagerCanvasModel({ overview, managerName, managerType, lastManaged, running, canManage, onRun, openingCanvas, onOpenCanvas, relative, actionLabel, labels }: ManagerCanvasProps): { nodes: ManagerMapNode[]; edges: Edge[] } {
  const { stats, backlog, actions, runTasks, policy, directives, autonomy } = overview;
  const href = (sub: string) => `/projects?tab=manager${sub ? `&sub=${sub}` : ''}`;
  const recentActions: CanvasItem[] = actions.slice(0, 5).map((action) => ({
    icon: managerActionIcon(action.actionType),
    title: actionLabel(action),
    detail: action.summary,
    when: relative(action.createdAt),
  }));
  const common = { type: 'managerMap' as const, draggable: true };
  const nodes: ManagerMapNode[] = [
    { ...common, id: 'policy', position: { x: 0, y: 20 }, data: { eyebrow: labels.policy, title: labels.policy, description: labels.policyDescription, icon: '⚙️', href: canManage ? href('policy') : undefined, openLabel: labels.open, badge: policy.enabled ? labels.enabled : labels.paused, metrics: [{ label: labels.directives, value: directives.filter((d) => d.status === 'active').length }, { label: labels.autoAssign, value: policy.autoAssign ? labels.enabled : labels.paused }, { label: labels.autoMerge, value: policy.allowAutoMerge ? labels.enabled : labels.paused }] } },
    { ...common, id: 'backlog', position: { x: 0, y: 255 }, data: { eyebrow: labels.backlog, title: labels.backlog, description: labels.backlogDescription, icon: '📋', href: href('backlog'), openLabel: labels.open, badge: String(backlog.length), metrics: [{ label: labels.total, value: stats.total }, { label: labels.unscored, value: stats.unscored, alert: stats.unscored > 0 }, { label: labels.unowned, value: stats.unowned, alert: stats.unowned > 0 }] } },
    { ...common, id: 'stuck', position: { x: 0, y: 480 }, data: { eyebrow: labels.stuck, title: labels.stuck, description: labels.stuckDescription, icon: '🚧', href: href('stuck'), openLabel: labels.open, tone: stats.flagged > 0 ? 'warning' : undefined, badge: String(stats.flagged), metrics: [{ label: labels.flagged, value: stats.flagged, alert: stats.flagged > 0 }, { label: labels.blockedPullRequests, value: overview.blockedPrs?.length ?? 0 }, { label: labels.openPullRequests, value: stats.blockedPullRequests ?? 0 }] } },
    { ...common, id: 'manager', position: { x: 390, y: 245 }, data: { eyebrow: managerType, title: managerName, description: lastManaged, icon: '🧭', tone: 'manager', badge: running ? labels.live : (!policy.enabled || autonomy?.tokenBlocked ? labels.paused : labels.enabled), runLabel: running ? labels.running : labels.run, running, onRun: canManage && policy.enabled ? onRun : undefined, openCanvasLabel: openingCanvas ? labels.openingCanvas : labels.openCanvas, openingCanvas, onOpenCanvas, metrics: [{ label: labels.runTasks, value: runTasks.length }, { label: labels.actions, value: actions.length }, { label: labels.openPullRequests, value: stats.openPullRequests }] } },
    { ...common, id: 'ask', position: { x: 805, y: 20 }, data: { eyebrow: labels.ask, title: labels.ask, description: labels.askDescription, icon: '💬', href: href('ask'), openLabel: labels.open } },
    { ...common, id: 'today', position: { x: 805, y: 190 }, data: { eyebrow: labels.today, title: labels.today, description: labels.todayDescription, icon: '☀️', href: '#manager-today', openLabel: labels.open } },
    { ...common, id: 'activity', position: { x: 805, y: 365 }, data: { eyebrow: labels.activity, title: labels.activity, description: labels.activityDescription, icon: '📡', href: href('activity'), openLabel: labels.open, tone: 'activity', badge: String(actions.length), items: recentActions, emptyLabel: labels.emptyActivity, footer: `${actions.length} · ${labels.actions}` } },
  ];
  const edge = (id: string, source: string, target: string, label: string, animated = false): Edge => ({ id, source, target, label, animated, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } });
  const edges = [
    edge('policy-manager', 'policy', 'manager', labels.policy),
    edge('backlog-manager', 'backlog', 'manager', labels.backlog, true),
    edge('stuck-manager', 'stuck', 'manager', labels.stuck, true),
    edge('manager-ask', 'manager', 'ask', labels.ask),
    edge('manager-today', 'manager', 'today', labels.today, true),
    edge('manager-activity', 'manager', 'activity', labels.activity, true),
  ];
  return { nodes, edges };
}

export function ManagerCanvas(props: ManagerCanvasProps) {
  const model = useMemo(() => buildManagerCanvasModel(props), [props]);
  const panels = useMemo(() => buildManagerWorkspacePanels(model.nodes), [model.nodes]);
  return <WorkspaceCanvas panels={panels} className={styles.managerWorkspace} />;
}

export function buildManagerWorkspacePanels(nodes: ManagerMapNode[]): WorkspaceCanvasPanel[] {
  return nodes.map((node) => ({
    id: `manager-${node.id}`,
    title: node.data.title,
    subtitle: node.data.eyebrow,
    icon: node.data.icon,
    position: { x: node.position.x + 40, y: node.position.y + 40 },
    width: node.data.tone === 'activity' ? 430 : node.data.tone === 'manager' ? 370 : 330,
    height: node.data.items ? 330 : node.data.onRun ? 250 : 220,
    content: <ManagerArtifactBody data={node.data} />,
  }));
}
