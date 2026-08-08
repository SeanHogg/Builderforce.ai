'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { toolsApi } from '@/lib/builderforceApi';
import { ensureLocalToolCreationSession } from '@/lib/creationSessions';

type ToolCanvasState = { sessionId: string; focusId: string };

/** The public deep link owns navigation; the canvas owns the tool and result. */
export default function ToolCanvasClient({ toolId }: { toolId: string }) {
  const t = useTranslations('tools');
  const [canvas, setCanvas] = useState<ToolCanvasState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    toolsApi.get(toolId)
      .then((tool) => {
        if (active) setCanvas(ensureLocalToolCreationSession(tool));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t('loadError'));
      });
    return () => { active = false; };
  }, [t, toolId]);

  if (error) return <div role="alert">{t('loadError')}: {error}</div>;
  if (!canvas) return <div role="status">{t('loading')}</div>;

  return (
    <CreationCanvas
      sessionId={canvas.sessionId}
      persistence="local"
      initialFocusId={canvas.focusId}
    />
  );
}
