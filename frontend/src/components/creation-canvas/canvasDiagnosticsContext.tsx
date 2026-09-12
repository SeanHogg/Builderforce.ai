/*
 * No `'use client'` — imported only from `CreationCanvas` and `BrainSurfaceActions`, all inside the canvas's own
 * client boundary. See the `use-client-is-a-declaration` rule.
 */
import { createContext, useContext } from 'react';
import { useTranslations } from 'next-intl';
import { CopyButton } from '@/components/CopyButton';

/**
 * THE CANVAS'S DIAGNOSTICS REPORT, one press away from every Brain placement.
 *
 * ── WHY A CONTEXT ────────────────────────────────────────────────────────────────
 * The report is built by the canvas — it reads the board, the turn trace, the session
 * and the environment — and the copy control for it lived in the canvas's own
 * diagnostics panel, which draws over the board. On a surface that takes the board's
 * place (the room, a running app, the conversation) that panel is not where anybody
 * looks, and those are exactly the surfaces a failed turn gets reported from. The
 * Brain header is on screen in every one of them, in three placements (the edge dock,
 * the Brain Object, the chat surface), so the canvas publishes its builder once and the
 * button reads it wherever it is drawn — no placement threads a prop it has no other
 * use for.
 */
export type CanvasDiagnosticsBuilder = () => string | Promise<string>;

const CanvasDiagnosticsContext = createContext<CanvasDiagnosticsBuilder | null>(null);

export const CanvasDiagnosticsProvider = CanvasDiagnosticsContext.Provider;

/** Copy this canvas's diagnostics. Renders nothing outside a canvas. */
export function CopyCanvasDiagnosticsButton() {
  const build = useContext(CanvasDiagnosticsContext);
  const t = useTranslations('creationCanvas');
  if (!build) return null;
  return <CopyButton bare getText={build} ariaLabel={t('copyDiagnostics')} />;
}
