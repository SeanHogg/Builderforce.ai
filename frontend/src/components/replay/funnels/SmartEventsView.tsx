/**
 * The `funnel` kind's Events tab (PRD 33 §2.1 "Smart events (auto + custom,
 * retroactive)"): the built-in events (sign up, purchase, add to cart, …) and
 * the site's own rules, each with how many kept recordings hit it (≈). A row
 * narrows the ONE filter to that event; a custom rule can be deleted (asks
 * first); "New event" — or "Define from this click" in the player — opens the
 * editor.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplaySmartEventDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import { useConfirm } from '@/components/ConfirmProvider';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useAdminData } from '@/components/admin/adminShared';
import { Icon } from '@/components/ui/Icon';
import { PanelPending } from '@/components/insights/kinds/PanelPending';
import { useInsightsScope } from '@/components/insights/insightsScope';
import { addClause } from '../filter/useReplayFilter';
import type { SmartEventDraft } from './funnelLevel';
import { SmartEventEditor } from './SmartEventEditor';

export interface SmartEventsViewProps {
  siteId: string;
  /** Opens the editor prefilled (a click mark's selector). */
  draft?: SmartEventDraft;
}

export function SmartEventsView({ siteId, draft }: SmartEventsViewProps) {
  const t = useTranslations('replay.smartEvents');
  const fmt = useFormat();
  const confirm = useConfirm();
  const errorText = useErrorText();
  const { days, filter, setFilter } = useInsightsScope();
  const [editing, setEditing] = useState(draft != null);
  const [error, setError] = useState('');
  const events = useAdminData<ReplaySmartEventDto[]>(() => replayApi.listSmartEvents(siteId, { days }), [siteId, days]);

  const remove = async (event: ReplaySmartEventDto) => {
    if (!event.id) return;
    const ok = await confirm({ title: t('deleteTitle'), message: t('deleteConfirm', { name: event.name }), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    setError('');
    try {
      await replayApi.deleteSmartEvent(siteId, event.id);
      events.reload();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const rows = events.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      {editing ? (
        <SmartEventEditor
          siteId={siteId}
          days={days}
          initial={draft}
          onSaved={() => { setEditing(false); events.reload(); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => setEditing(true)}>
          <Icon name="plus" size={14} /> {t('new')}
        </button>
      )}
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{error}</p>}
      {!events.data && <PanelPending loading={events.loading} error={events.error} />}
      {events.data && rows.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
      {rows.length > 0 && (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="data-table" aria-label={t('tableAria')}>
            <thead>
              <tr>
                <th>{t('col.name')}</th>
                <th>{t('col.rule')}</th>
                <th>{t('col.count', { days })}</th>
                <th><span className="sr-only">{t('col.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => (
                <tr key={event.id ?? `builtin:${event.name}`}>
                  <td>
                    <span style={{ overflowWrap: 'anywhere' }}>{event.name}</span>
                    {event.builtin && <span style={{ marginLeft: 'var(--space-1)', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('builtin')}</span>}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>
                    {t('ruleSummary', { kind: t(`ruleKind.${event.ruleKind}`), mode: t(`matchMode.${event.matchMode}`), match: event.match })}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t('approx', { value: fmt.number(event.count) })}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label={t('filterAria', { name: event.name })}
                      onClick={() => setFilter(addClause(filter, { field: 'smartEvent', op: 'eq', value: event.name }))}
                      style={{ minHeight: 44 }}
                    >
                      {t('filter')}
                    </button>
                    {!event.builtin && event.id && (
                      <button
                        type="button"
                        className="btn-ghost"
                        aria-label={t('deleteAria', { name: event.name })}
                        onClick={() => void remove(event)}
                        style={{ minHeight: 44, minWidth: 44 }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
