/**
 * The ACTION LEDGER for the chat — every page Rovr read, every click, every keystroke,
 * every action the person declined, with the tab and URL it happened on. Updates live
 * as the run acts; works offline (it is the device record).
 */
import { useCallback } from 'react';
import { t, type MessageKey } from '../i18n/t';
import type { LedgerEntry, LedgerOutcome } from '../store/records';
import { useLoaded, useServices } from './hooks';
import { toolLabelKey } from './toolLabels';

const OUTCOME_KEY: Record<LedgerOutcome, MessageKey> = {
  done: 'outcomeDone',
  failed: 'outcomeFailed',
  declined: 'outcomeDeclined',
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function ActionsView({ chatId }: { chatId: number | null }) {
  const services = useServices();
  const subscribe = useCallback(
    (reload: () => void) => services.ledger.subscribe((changed) => changed === chatId && reload()),
    [services, chatId],
  );
  const [entries] = useLoaded<LedgerEntry[]>(
    () => (chatId === null ? Promise.resolve([]) : services.ledger.list(chatId)),
    [],
    [chatId],
    subscribe,
  );

  if (entries.length === 0) return <p className="rovr-empty">{t('actionsEmpty')}</p>;
  return (
    <ol className="rovr-list" aria-label={t('actionsLabel')}>
      {[...entries].reverse().map((e) => (
        <li key={e.id} className={`rovr-card rovr-card--${e.outcome}`}>
          <div className="rovr-row rovr-row--spread">
            <span className="rovr-card__title">{t(toolLabelKey(e.tool))}</span>
            <span className={`rovr-chip rovr-chip--${e.outcome === 'done' ? 'ok' : e.outcome === 'declined' ? 'local' : 'off'}`}>
              {t(OUTCOME_KEY[e.outcome])}
            </span>
          </div>
          {e.target && <p className="rovr-card__target">{e.target}</p>}
          <p className="rovr-muted">
            <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
            {e.url && <> · {hostOf(e.url)}</>}
          </p>
          {e.outcome === 'failed' && e.detail && <p className="rovr-muted">{e.detail}</p>}
          {e.image && <img className="rovr-shot" src={e.image} alt={t('screenshotAlt', hostOf(e.url))} />}
        </li>
      ))}
    </ol>
  );
}
