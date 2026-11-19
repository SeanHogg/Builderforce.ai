import Link from 'next/link';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { RAG_TONE, type PortfolioHealthItem } from '@/lib/pm/portfolioHealth';
import { statusColor } from '@/lib/statusTone';
import { PortfolioHealthCard } from './PortfolioHealthCard';

/**
 * The Collection descriptor for Portfolio → Health. Read-only (`entity: null`):
 * a health read has no bulk actions. The card renderer is `PortfolioHealthCard`
 * itself; the List columns are a compact projection of the same derived row.
 */

const RAG_ORDER: Record<PortfolioHealthItem['rag'], number> = { red: 0, amber: 1, green: 2 };

export interface PortfolioHealthLabels {
  project: string;
  health: string;
  progress: string;
  blocker: string;
  action: string;
  rag: (item: PortfolioHealthItem) => string;
  progressText: (item: PortfolioHealthItem) => string;
  blockerText: (item: PortfolioHealthItem) => string;
  actionText: (item: PortfolioHealthItem) => string;
}

export function portfolioHealthDescriptor(labels: PortfolioHealthLabels): CollectionDescriptor<PortfolioHealthItem> {
  return {
    entity: null,
    surfaceKey: 'pm.portfolio.health',
    rowId: (item) => String(item.id),
    label: (item) => item.name,
    defaultView: 'card',
    defaultSort: { key: 'health', dir: 'asc' },
    emptyKey: 'empty',
    card: (item) => <PortfolioHealthCard item={item} />,
    columns: [
      {
        key: 'project',
        header: labels.project,
        sortKey: 'project',
        compare: (a, b) => a.name.localeCompare(b.name),
        cell: (item) => (
          <Link
            href={`/projects?project=${item.id}&panel=analytics`}
            style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}
          >
            {item.name}
          </Link>
        ),
      },
      {
        key: 'health',
        header: labels.health,
        sortKey: 'health',
        compare: (a, b) => RAG_ORDER[a.rag] - RAG_ORDER[b.rag],
        cell: (item) => <span style={{ color: statusColor(RAG_TONE, item.rag), fontWeight: 700 }}>{labels.rag(item)}</span>,
      },
      {
        key: 'progress',
        header: labels.progress,
        sortKey: 'progress',
        compare: (a, b) => a.health.completed - b.health.completed,
        cell: (item) => labels.progressText(item),
      },
      { key: 'blocker', header: labels.blocker, cell: (item) => labels.blockerText(item) },
      { key: 'action', header: labels.action, cell: (item) => labels.actionText(item) },
    ],
  };
}
