'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { faultMessage } from '@/lib/apiClient';
import { readSubflowBoardFresh } from '@/domains/canvas/presentation/useSubflowBoards';
import { SUBFLOW_BINDINGS, subflowBinding, subflowSessionId, type SubflowBinding } from '../domain/subflow';
import { subflowInterface, type SubflowInterface } from '../domain/subflowInterface';
import { hintStyle, inputStyle, labelStyle, optionStyle } from './stepFieldStyles';

/**
 * THE `subflow` STEP'S EDITOR — which canvas, how it binds, and what it takes.
 *
 * ── WHY THIS IS NOT A DECLARED FIELD LIST ────────────────────────────────────
 * Same reason as `connector`: the options are not known at build time. They are
 * the canvases this tenant has, which nobody can enumerate in a catalog.
 *
 * ── AND WHY IT SHOWS THE INTERFACE ───────────────────────────────────────────
 * Choosing a canvas is only half the decision; the other half is what to hand it.
 * That is derivable from the child board itself (`subflowInterface.ts`) — the
 * parameters are what its entry steps declare they need, the returns are what it
 * publishes that nothing inside it reads — so the editor shows them instead of
 * asking the author to open the other canvas and work it out. A canvas with no
 * steps says so here, before the build refuses.
 *
 * Narrow contract, and self-contained: the config plus one patch channel. It loads
 * its own list, reads its own child board, and needs nothing from whichever
 * surface is rendering it.
 */

interface Props {
  config: Record<string, unknown>;
  setConfig: (key: string, value: unknown) => void;
  /** Patch several keys at once — picking a canvas also records its name. */
  patchConfig: (patch: Record<string, unknown>) => void;
}

export function SubflowNodeFields({ config, setConfig, patchConfig }: Props) {
  const t = useTranslations('workflow.subflowNode');

  const [sessions, setSessions] = useState<CreationSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shape, setShape] = useState<SubflowInterface | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  const sessionId = subflowSessionId(config);
  const binding = subflowBinding(config);

  useEffect(() => {
    let cancelled = false;
    creationSessionsApi.list('active')
      .then((result) => { if (!cancelled) setSessions(result.sessions); })
      .catch((cause: unknown) => { if (!cancelled) setError(faultMessage(cause, t('loadFailed'))); });
    return () => { cancelled = true; };
  }, [t]);

  // The chosen canvas, read fresh: the author has just picked it, so they are
  // entitled to its real interface rather than a copy taken before their last edit.
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) { setShape(null); setUnreadable(false); return; }
    void readSubflowBoardFresh(sessionId).then((board) => {
      if (cancelled) return;
      setUnreadable(!board);
      setShape(board ? subflowInterface(board) : null);
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  /** Picking a canvas records its NAME too — so a step whose canvas has since been
   *  deleted can still say which one it meant, in the refusal and on the card. */
  const chooseCanvas = (id: string) => {
    const chosen = sessions?.find((session) => session.id === id);
    patchConfig({ canvasSessionId: id, canvasTitle: chosen?.title ?? '', definitionId: '' });
  };

  const ports = (heading: string, list: SubflowInterface['inputs'], empty: string) => (
    <div style={hintStyle}>
      <strong>{heading}</strong>
      {list.length === 0
        ? <div>{empty}</div>
        : (
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {list.map((port) => (
              <li key={port.key} style={{ marginBottom: 2 }}>
                <code>{port.key}</code>
                {port.stepTitle ? ` · ${port.stepTitle}` : ''}
              </li>
            ))}
          </ul>
        )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={labelStyle}>
        {t('canvas')}
        <Select
          style={inputStyle}
          value={sessionId}
          onChange={(event) => chooseCanvas(event.target.value)}
          disabled={!sessions}
        >
          <option value="" style={optionStyle}>{sessions ? t('choosePlaceholder') : t('loading')}</option>
          {sessions?.map((session) => (
            <option key={session.id} value={session.id} style={optionStyle}>{session.title}</option>
          ))}
        </Select>
      </label>

      <label style={labelStyle}>
        {t('binding')}
        <Select style={inputStyle} value={binding} onChange={(event) => setConfig('binding', event.target.value as SubflowBinding)}>
          {SUBFLOW_BINDINGS.map((option) => (
            <option key={option} value={option} style={optionStyle}>{t(`bindingOption.${option}`)}</option>
          ))}
        </Select>
      </label>
      <div style={hintStyle}>{t(`bindingHint.${binding}`)}</div>

      {sessionId && unreadable && <div style={{ ...hintStyle, color: 'var(--danger)' }}>{t('unreadable')}</div>}

      {shape && shape.stepCount === 0 && <div style={{ ...hintStyle, color: 'var(--warning)' }}>{t('noSteps')}</div>}

      {shape && shape.stepCount > 0 && (
        <>
          <div style={hintStyle}>{t('stepCount', { count: shape.stepCount })}</div>
          {ports(t('accepts'), shape.inputs, shape.acceptsRawInput ? t('acceptsAnything') : t('acceptsNothing'))}
          {shape.inputs.length > 0 && shape.acceptsRawInput && <div style={hintStyle}>{t('acceptsAlsoRaw')}</div>}
          {ports(t('returns'), shape.outputs, t('returnsNothing'))}
        </>
      )}

      {error && <div style={{ ...hintStyle, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}
