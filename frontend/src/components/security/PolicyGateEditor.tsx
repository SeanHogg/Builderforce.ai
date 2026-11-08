/**
 * The "add a gate" form of a policy pack: gate key, tool matcher, the side-effect class it
 * applies to (any / read / verify / mutate — classified by the one shared classifier), the
 * effect, and the directive or reason text. It owns its draft; the pack panel owns saving.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TOOL_SIDE_EFFECTS } from '@builderforce/agent-tools';
import type { PolicyGateEffect, PolicyGateInput, PolicyGateSideEffect } from '@/lib/builderforceApi';
import { RoleGate } from '@/components/RoleGate';
import { inputStyle, labelStyle, optionStyle, primaryButton } from './policyPanelStyles';

const EFFECTS: PolicyGateEffect[] = ['inject-directive', 'require-approval', 'block'];

interface GateDraft {
  gateKey: string;
  tool: string;
  sideEffect: '' | PolicyGateSideEffect;
  effect: PolicyGateEffect;
  directive: string;
  reason: string;
}

const emptyGateDraft = (): GateDraft => ({
  gateKey: '', tool: '*', sideEffect: '', effect: 'block', directive: '', reason: '',
});

interface Props {
  saving: boolean;
  /** Save the gate; resolves true when it was saved (the form then clears). */
  onAdd: (input: PolicyGateInput) => Promise<boolean>;
}

export default function PolicyGateEditor({ saving, onAdd }: Props) {
  const t = useTranslations('policyPacks');
  const [draft, setDraft] = useState<GateDraft>(emptyGateDraft);

  const add = async () => {
    if (!draft.gateKey.trim()) return;
    const saved = await onAdd({
      gateKey: draft.gateKey.trim(),
      tool: draft.tool.trim() || null,
      sideEffect: draft.sideEffect || null,
      effect: draft.effect,
      directive: draft.directive.trim() || null,
      reason: draft.reason.trim() || null,
    });
    if (saved) setDraft(emptyGateDraft());
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)' }}>{t('addGateTitle')}</div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 150px', minWidth: 0 }}>
          <label style={labelStyle} htmlFor="policy-gate-key">{t('fieldGateKey')}</label>
          <input
            id="policy-gate-key"
            value={draft.gateKey}
            onChange={(e) => setDraft({ ...draft, gateKey: e.target.value })}
            placeholder={t('fieldGateKeyPlaceholder')}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: '1 1 150px', minWidth: 0 }}>
          <label style={labelStyle} htmlFor="policy-gate-tool">{t('fieldTool')}</label>
          <input
            id="policy-gate-tool"
            value={draft.tool}
            onChange={(e) => setDraft({ ...draft, tool: e.target.value })}
            placeholder="*"
            style={inputStyle}
          />
        </div>
      </div>
      <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: 0 }}>{t('toolHelp')}</p>

      <div>
        <label style={labelStyle} htmlFor="policy-gate-side-effect">{t('fieldAppliesTo')}</label>
        <select
          id="policy-gate-side-effect"
          value={draft.sideEffect}
          onChange={(e) => setDraft({ ...draft, sideEffect: e.target.value as '' | PolicyGateSideEffect })}
          style={inputStyle}
        >
          <option value="" style={optionStyle}>{t('appliesToAny')}</option>
          {TOOL_SIDE_EFFECTS.map((se) => (
            <option key={se} value={se} style={optionStyle}>{t(`sideEffect.${se}`)}</option>
          ))}
        </select>
        <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('appliesToHelp')}</p>
      </div>

      <div>
        <label style={labelStyle} htmlFor="policy-gate-effect">{t('fieldEffect')}</label>
        <select
          id="policy-gate-effect"
          value={draft.effect}
          onChange={(e) => setDraft({ ...draft, effect: e.target.value as PolicyGateEffect })}
          style={inputStyle}
        >
          {EFFECTS.map((eff) => (
            <option key={eff} value={eff} style={optionStyle}>{t(`effect.${eff}`)}</option>
          ))}
        </select>
        <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
          {t(`effectHelp.${draft.effect}`)}
        </p>
      </div>

      {draft.effect === 'inject-directive' ? (
        <div>
          <label style={labelStyle} htmlFor="policy-gate-directive">{t('fieldDirective')}</label>
          <textarea
            id="policy-gate-directive"
            value={draft.directive}
            onChange={(e) => setDraft({ ...draft, directive: e.target.value })}
            rows={2}
            placeholder={t('fieldDirectivePlaceholder')}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      ) : (
        <div>
          <label style={labelStyle} htmlFor="policy-gate-reason">{t('fieldReason')}</label>
          <textarea
            id="policy-gate-reason"
            value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            rows={2}
            placeholder={t('fieldReasonPlaceholder')}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      )}

      <RoleGate capability="policies.manage">
        <button
          type="button"
          onClick={add}
          disabled={saving || !draft.gateKey.trim()}
          style={{ ...primaryButton, opacity: draft.gateKey.trim() ? 1 : 0.5 }}
        >
          {t('addGate')}
        </button>
      </RoleGate>
    </div>
  );
}
