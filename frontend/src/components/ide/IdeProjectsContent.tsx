'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { listIdeProjects, deleteIdeProject } from '@/lib/api';
import { persistLastProjectId } from '@/lib/auth';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import type { IdeProject } from '@/lib/types';
import { IdeProjectCard } from '@/components/IdeProjectCard';
import { IdeProjectDetailsModal } from '@/components/IdeProjectDetailsModal';

/**
 * Self-contained IDE-projects list — owns its own fetch, open/delete/details
 * wiring, and empty state, mirroring the ProjectsContent convention so it can be
 * dropped into the dashboard IDE tab AND anywhere else without prop-drilling. It
 * follows the global project scope: a selected project narrows to that parent's
 * IDE projects. Pass `limit` for a preview and `viewAllHref` for a "View all"
 * link.
 */
export function IdeProjectsContent({
  limit,
  viewAllHref,
  onCount,
}: {
  limit?: number;
  viewAllHref?: string;
  onCount?: (count: number) => void;
}) {
  const router = useRouter();
  const t = useTranslations('ide');
  const { currentProjectId } = useProjectScope();
  const [items, setItems] = useState<IdeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsFor, setDetailsFor] = useState<IdeProject | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listIdeProjects()
      .then((list) => { if (alive) setItems(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const scoped = useMemo(
    () => (currentProjectId != null ? items.filter((p) => p.containerProjectId === currentProjectId) : items),
    [items, currentProjectId],
  );

  useEffect(() => { onCount?.(scoped.length); }, [scoped.length, onCount]);

  const openIde = (p: IdeProject) => {
    persistLastProjectId(String(p.storageProjectId));
    router.push(`/ide/${p.storageProjectPublicId}`);
  };

  const handleDelete = async (p: IdeProject) => {
    if (!confirm(t('deleteConfirm', { name: p.name }))) return;
    try {
      await deleteIdeProject(p.id);
      setItems((prev) => prev.filter((x) => x.id !== p.id));
    } catch {
      alert(t('deleteFailed'));
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 0' }}>{t('loadingProjects')}</div>;
  }

  if (scoped.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border-subtle)',
          borderRadius: 12,
          padding: '28px 16px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <p style={{ margin: '0 0 12px', fontSize: 14 }}>
          {currentProjectId != null ? t('noProjectsFilter') : t('noProjectsYet')}
        </p>
        <Link
          href="/ide/dashboard"
          style={{
            display: 'inline-block',
            padding: '8px 16px',
            borderRadius: 8,
            background: 'var(--coral-bright)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {t('newIdeProject')}
        </Link>
      </div>
    );
  }

  const visible = limit != null ? scoped.slice(0, limit) : scoped;
  const hasMore = viewAllHref && scoped.length > visible.length;

  return (
    <div>
      {viewAllHref && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Link href={viewAllHref} style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
            {t('yourIdeProjects')} →
          </Link>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {visible.map((p) => (
          <IdeProjectCard
            key={p.id}
            ideProject={p}
            onOpen={openIde}
            onDetails={setDetailsFor}
            onDelete={handleDelete}
          />
        ))}
      </div>
      {hasMore && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link href={viewAllHref!} style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
            {t('yourIdeProjects')} →
          </Link>
        </div>
      )}

      {detailsFor && (
        <IdeProjectDetailsModal
          ideProject={detailsFor}
          onClose={() => setDetailsFor(null)}
          onSaved={(updated) => {
            setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            setDetailsFor(null);
          }}
        />
      )}
    </div>
  );
}
