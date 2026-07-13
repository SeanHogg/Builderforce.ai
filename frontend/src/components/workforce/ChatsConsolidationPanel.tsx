'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlidersHorizontal, AlertTriangle, CheckCircle, Copy, Trash2 } from 'lucide-react';
import {
  builderforceApi,
  type BrainChat,
} from '@/lib/builderforceApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  extractCandidateChats,
  type ExtractedChat,
  groupCandidateChats,
  type ChatGroup,
  computeCrowdiness,
  isValidGroupSources,
} from '@/lib/consolidable';
import { Add } from '@mui/icons-material';

const panelStyle: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  maxWidth: 'min(800px, 100vw)',
  margin: 'auto',
};

const groupStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const chatRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0',
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--accent, #6366f1)',
  color: '#fff',
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

export type ChatsConsolidationPanelProps = {
  open: boolean;
  onClose: () => void;
  chats: BrainChat[];
  onConsolidated?: () => void;
};

export function ChatsConsolidationPanel({
  open,
  onClose,
  chats,
  onConsolidated,
}: ChatsConsolidationPanelProps) {
  const t = useTranslations('workforce.consolidate');
  const tc = useTranslations('common');

  const [candidates, setCandidates] = useState<ExtractedChat[]>([]);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freshGroups, setFreshGroups] = useState<ChatGroup[]>([]);

  // Load candidate chats and compute groups on open.
  useEffect(() => {
    if (!open) return;

    async function load() {
      setError(null);
      try {
        const extracted = extractCandidateChats(chats);
        setCandidates(extracted);
        const grouped = groupCandidateChats(extracted);
        setGroups(grouped);
        setFreshGroups(grouped);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('loadError'));
      }
    }
    void load();
  }, [chats, open, t]);

  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.chatId, c])),
    [candidates],
  );

  const filteredGroups = useMemo(() => {
    const filtered = freshGroups.filter((g) => {
      // Snap to the initial candidate-backed state for stability.
      if (g.keptId != null) return true;
      // If no kept target, try to prefer product.
      const inSources = g.sources.some((c) => c.chatId === g.keptId);
      if (!inSources) return g.sources.some((c) => c.kind === 'product');
      return true;
    });
    return filtered;
  }, [freshGroups, byId]);

  const handled = useMemo(
    () => new Set(filteredGroups.flatMap((g) => g.sources.map((c) => c.chatId))),
    [filteredGroups],
  );

  const c = useCallback((grp: ChatGroup, key: string) => {
    if (grp.keptId != null) {
      return grp.sources.find((c) => c.chatId === grp.keptId);
    }
    return grp.sources.find((c) => c.chatId === key);
  }, []);

  const addKeptTarget = useCallback((g: ChatGroup, key: string) => {
    setFreshGroups((prev) =>
      prev.map((group) => {
        if (group.key !== g.key) return group;
        return group.keptId != null ? group : enforceKeptTargetInGroup(group);
      }),
    );
  }, []);

  const toggleSource = useCallback(
    (g: ChatGroup, chatId: number) => {
      setFreshGroups((prev) => {
        const newGroups = prev.map((group) => {
          if (group.key !== g.key) return group;
          if (group.keptId == null) {
            // No kept target, so first selected becomes the target.
            if (group.sources[0].chatId === chatId) {
              return group;
            }
            const newSources = group.sources.filter((c) => c.chatId !== chatId);
            return { ...group, keptId: chatId, sources: newSources, keptTitle: c(group, chatId).title };
          } else if (group.keptId === chatId) {
            // Disassociate from kept target.
            const other = group.sources.find((c) => c.chatId !== chatId);
            if (!other) {
              return group; // no replacement target
            }
            return { ...group, keptId: null, sources: [...group.sources, other], keptTitle: '' };
          } else if (group.sources.some((c) => c.chatId === chatId)) {
            // Toggle selection: keep it as a source.
            const newSources = group.sources.filter((c) => c.chatId !== chatId);
            return { ...group, sources: [...newSources, group.sources.find((c) => c.chatId === chatId)!] };
          }
          return group;
        });
        return [...new Map(newGroups.map((g) => [g.key, g])).values()];
      });
    },
    [c],
  );

  const doConsolidate = async () => {
    if (busy) return;
    const readyGroups = freshGroups.filter((g) => g.keptId != null && g.sources.length >= 1);
    if (readyGroups.length === 0) {
      setError(t('noReadyGroups'));
      return;
    }

    setBusy(true);
    setError(null);
    let successCount = 0;
    let errors: string[] = [];

    try {
      for (const group of readyGroups) {
        const sources = group.sources.filter((c) => c.chatId !== group.keptId);
        try {
          isValidGroupSources(group);
          await builderforceApi.consolidateChats(group.keptId, sources.map((c) => c.chatId));
          successCount += 1;
        } catch (e) {
          errors.push(
            `Group ${group.key} (target ${group.keptId}, sources ${sources.map((c) => c.chatId).join(',')})`,
          );
        }
      }
      if (successCount > 0) {
        setFreshGroups([]);
        setError(
          successCount === 1
            ? tc('success')
            : `Resolution: ${successCount} group${successCount === 1 ? '' : 's'} merged. Errors: ${errors.join('; ') || 'None'}.`,
        );
        onConsolidated?.();
      } else if (errors.length > 0) {
        setError(t('consolidationErrors', { errors: errors.join(';\n') }));
      } else {
        setError(t('noReadyGroups'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('consolidationError'));
    } finally {
      setBusy(false);
    }
  };

  const resetFilter = useCallback(() => {
    setFreshGroups(groups);
    setError(null);
  }, [groups]);

  const isEmpty = filteredGroups.length === 0;
  const canConsolidate = freshGroups.some((g) => g.keptId != null && g.sources.length >= 1) && !busy;

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t('mentalPreviewTitle')}</h3>
          <Badge variant="secondary">{freshGroups.length}</Badge>
          {error && <AlertTriangle size="var(--text-muted)" />}
        </div>
        {error && <div style={{ fontSize: 13, color: 'var(--danger, #e5484d)', marginTop: 8 }}>{error}</div>}

        {isEmpty ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            {t('noGroups')}
          </div>
        ) : (
          filteredGroups.map((g) => {
            const keptChat = c(g, g.keptId);
            const sources = g.sources.filter((c) => c.chatId !== g.keptId);
            const crowdiness = Math.round(computeCrowdiness(g.sources[0])) / 100;

            return (
              <div key={g.key} style={groupStyle}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                  <SlidersHorizontal size="var(--text-muted)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {g.label}
                      {g.sources.some((c) => c.kind === 'product') && <Badge variant="success">{t('target') as string}</Badge>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {sources.length} {t('sourceChats')} · {t('crowdiness', { count: crowdiness })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      {t('selectKeptTarget')}
                      {keptChat && (
                        <Button
                          variant="ghost"
                          size="sm"
                          startIcon={<CheckCircle size="var(--accent)" />}
                          disabled={busy}
                          onClick={() => addKeptTarget(g, keptChat.chatId)}
                        />
                      )}
                      {!keptChat && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => addKeptTarget(g, g.sources[0]?.chatId)}
                        >
                          <Add size="var(--accent)" />
                          {t('keepTarget')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '8px 0 0' }}>
                  {sources.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noSources')}</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {sources.map((s) => {
                        const isSelected = s.chatId === g.keptId;
                        return (
                          <div key={s.chatId} style={chatRowStyle}>
                            <input
                              type="radio"
                              name={g.key}
                              checked={isSelected}
                              disabled={busy}
                              onChange={() => toggleSource(g, s.chatId)}
                              style={{ width: '16px', height: '16px', padding: 0 }}
                            />
                            <span style={{ flex: '0 0 auto', fontSize: 13 }}>{s.title}</span>
                            <Badge variant={s.kind === 'featurerequest' ? 'warning' : 'secondary'}>
                              {s.kind}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        {freshGroups.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            {busy ? (
              <Button variant="secondary" disabled size="sm">
                {t('consolidating')}
              </Button>
            ) : canConsolidate ? (
              <Button
                variant="primary"
                size="sm"
                startIcon={<SlidersHorizontal size="var(--accent)" />}
                onClick={doConsolidate}
              >
                {t('consolidateInto', { count: freshGroups.filter((g) => g.sources.length >= 1).length })}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={resetFilter}>
                <Copy size="var(--text-muted)" />
                {t('resetFilter')}
              </Button>
            )}
          </div>
        )}
      </div>
    </SlideOutPanel>
  );
}

function enforceKeptTargetInGroup(group: ChatGroup): ChatGroup {
  const valid = isValidGroupSources;
  if (!valid(group)) {
    // Only validate once; if invalid, the kept target is ignored and the group is excluded.
    return { ...group, keptId: null };
  }
  // Enforce a kept target if available.
  const kept = group.sources.find((c) => c.kind === 'product');
  const newGroup = kept ? { ...group, keptId: kept.chatId, keptTitle: kept.title } : group;
  return newGroup;
}