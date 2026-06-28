'use client';

/**
 * App-wide controller for the canvas slide-out. Mounted once near the app root
 * (see ConditionalAppShell) so ANY surface can open a canvas in a side panel
 * without owning the drawer:
 *   - the Brain (on /brainstorm or the floating drawer) generates a board and
 *     shows it via the `show_canvas` tool (see CanvasPanelBrainBridge);
 *   - future surfaces can call `useCanvasPanel().open(model, title)` directly.
 *
 * The board itself is the reusable <CanvasBoard> (via <CanvasSlideOver>). The
 * panel keeps the live model in state so edits persist while open, and offers a
 * "Save to Knowledge" action that turns the board into a canvas document.
 * Mirrors AiInsightPanelProvider / FinancePanelProvider.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermission } from '@/lib/rbac';
import { knowledgeApi } from '@/lib/knowledgeApi';
import { CanvasSlideOver } from './CanvasSlideOver';
import { emptyCanvas, serializeCanvas, type CanvasModel } from './canvasModel';

interface CanvasPanelApi {
  /** Open the canvas slide-out, optionally seeded with a model + title. */
  open: (initial?: CanvasModel, title?: string) => void;
  close: () => void;
  isOpen: boolean;
}

const CanvasPanelContext = createContext<CanvasPanelApi | null>(null);

export function CanvasPanelProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('canvas');
  const router = useRouter();
  const canCreate = usePermission('knowledge.create').allowed;

  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<CanvasModel>(() => emptyCanvas());
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const openPanel = useCallback((initial?: CanvasModel, ttl?: string) => {
    setModel(initial ?? emptyCanvas());
    setTitle(ttl ?? '');
    setSaving(false);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const api = useMemo<CanvasPanelApi>(() => ({ open: openPanel, close, isOpen: open }), [openPanel, close, open]);

  // Persist the in-panel board as a canvas knowledge document, then open it.
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const doc = await knowledgeApi.create({
        docType: 'doc',
        title: title.trim() || t('defaultBoardTitle'),
        content: serializeCanvas(model),
      });
      setOpen(false);
      router.push(`/knowledge/${doc.id}`);
    } catch {
      setSaving(false);
    }
  }, [model, title, router, t]);

  return (
    <CanvasPanelContext.Provider value={api}>
      {children}
      <CanvasSlideOver
        open={open}
        onClose={close}
        title={title || t('defaultBoardTitle')}
        value={model}
        onChange={setModel}
        actions={
          canCreate ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent, #2563eb)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? t('saving') : t('saveToKnowledge')}
            </button>
          ) : undefined
        }
      />
    </CanvasPanelContext.Provider>
  );
}

/** Open/close the canvas drawer. Throws outside the provider (wiring mistake). */
export function useCanvasPanel(): CanvasPanelApi {
  const ctx = useContext(CanvasPanelContext);
  if (!ctx) throw new Error('useCanvasPanel must be used within a CanvasPanelProvider');
  return ctx;
}

/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export function useOptionalCanvasPanel(): CanvasPanelApi | null {
  return useContext(CanvasPanelContext);
}
