/**
 * Define a smart event (PRD 33 §2.1 "Smart events — point-and-click rules"):
 * a name, what it watches (a page, a click on a selector, or a named
 * `BFReplay.event`), how the value matches, and a live "≈ N recordings" count.
 * Retroactive: a saved rule counts every kept recording already in the window.
 * "Define from this click" in the player opens it prefilled (`initial`).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayMatchMode, ReplaySmartEventDto, ReplaySmartEventRuleKind } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { MATCH_MODES, RULE_KINDS, type SmartEventDraft } from './funnelLevel';
import { RulePreview } from './RulePreview';

export interface SmartEventEditorProps {
  siteId: string;
  days: number;
  initial?: SmartEventDraft;
  onSaved: (event: ReplaySmartEventDto) => void;
  onCancel: () => void;
}

const field = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0, flex: '1 1 160px' } as const;

export function SmartEventEditor({ siteId, days, initial, onSaved, onCancel }: SmartEventEditorProps) {
  const t = useTranslations('replay.smartEvents');
  const errorText = useErrorText();
  const [name, setName] = useState('');
  const [rule, setRule] = useState<SmartEventDraft>(initial ?? { ruleKind: 'click', match: '', matchMode: 'equals' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = name.trim().length > 0 && rule.match.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await replayApi.createSmartEvent(siteId, { name: name.trim(), ...rule, match: rule.match.trim() }));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={t('editorAria')}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', minWidth: 0 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <label style={field}>
          <span>{t('name')}</span>
          <input className="input" value={name} placeholder={t('namePlaceholder')} onChange={(event) => setName(event.currentTarget.value)} style={{ minHeight: 44 }} />
        </label>
        <label style={field}>
          <span>{t('ruleKindLabel')}</span>
          <select
            className="input"
            value={rule.ruleKind}
            onChange={(event) => setRule({ ...rule, ruleKind: event.currentTarget.value as ReplaySmartEventRuleKind })}
            style={{ minHeight: 44 }}
          >
            {RULE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`ruleKind.${kind}`)}</option>)}
          </select>
        </label>
        <label style={field}>
          <span>{t('matchModeLabel')}</span>
          <select
            className="input"
            value={rule.matchMode}
            onChange={(event) => setRule({ ...rule, matchMode: event.currentTarget.value as ReplayMatchMode })}
            style={{ minHeight: 44 }}
          >
            {MATCH_MODES.map((mode) => <option key={mode} value={mode}>{t(`matchMode.${mode}`)}</option>)}
          </select>
        </label>
      </div>
      <label style={{ ...field, flex: '1 1 auto' }}>
        <span>{t('match')}</span>
        <input
          className="input"
          value={rule.match}
          placeholder={t(`matchPlaceholder.${rule.ruleKind}`)}
          onChange={(event) => setRule({ ...rule, match: event.currentTarget.value })}
          style={{ minHeight: 44 }}
        />
      </label>
      <RulePreview siteId={siteId} days={days} rule={rule.match.trim() ? rule : null} />
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn-primary" disabled={busy || !valid} style={{ minHeight: 44 }}>{t('save')}</button>
        <button type="button" className="btn-ghost" onClick={onCancel} style={{ minHeight: 44 }}>{t('cancel')}</button>
      </div>
    </form>
  );
}
