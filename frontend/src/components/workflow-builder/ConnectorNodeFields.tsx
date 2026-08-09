'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { connectorsApi, type CatalogAction, type CatalogConnector } from '@/lib/connectorsApi';

/**
 * The `connector` node's editor — two pickers and an input template.
 *
 * ── WHY THIS IS NOT A DECLARED FIELD LIST ───────────────────────────────────
 * Every other node kind declares static `fields` in the palette catalog, because
 * its options are known at build time. This one's are not: the action list comes
 * from the tenant's live catalog, which includes connectors they authored
 * themselves. Hardcoding options here would mean a tenant's own connector could
 * never be picked — which is precisely the extensibility this node exists to
 * provide.
 *
 * ── THE INPUT TEMPLATE IS THE USABILITY OF THE WHOLE FEATURE ────────────────
 * Choosing an action seeds the input box with that action's REQUIRED parameters,
 * empty. Without it, configuring a node means reading the vendor's API docs to
 * learn that Twilio wants `To`/`From`/`Body` with those exact capitalisations —
 * and a wrong key fails at run time with a vendor error. With it, the shape is
 * already right and only the values are the author's problem.
 */

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  fontSize: 12.5,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
  marginTop: 3,
};

/** Native `<option>` needs its own opaque colours — the popup does not inherit
 *  the control's theme on every platform. */
const optionStyle: React.CSSProperties = {
  background: 'var(--bg-deep, #ffffff)',
  color: 'var(--text-primary, #14161a)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  display: 'block',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  marginTop: 4,
  lineHeight: 1.5,
};

interface Props {
  config: Record<string, unknown>;
  setConfig: (key: string, value: unknown) => void;
  /** Patch several keys at once — picking an action also reseeds the input. */
  patchConfig: (patch: Record<string, unknown>) => void;
}

export function ConnectorNodeFields({ config, setConfig, patchConfig }: Props) {
  const t = useTranslations('workflow.connectorNode');

  const [catalog, setCatalog] = useState<CatalogConnector[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    connectorsApi
      .actions()
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const connectorKey = String(config.connector ?? '');
  const actionKey = String(config.action ?? '');

  const connector = useMemo(
    () => catalog?.find((c) => c.key === connectorKey) ?? null,
    [catalog, connectorKey],
  );
  const action = useMemo(
    () => connector?.actions.find((a) => a.key === actionKey) ?? null,
    [connector, actionKey],
  );

  /** Switching connector clears the action: an action key from the previous one
   *  would not exist here, and a node pointing at a missing action fails at run
   *  time rather than showing anything wrong in the editor. */
  const chooseConnector = (key: string) => patchConfig({ connector: key, action: '', input: '{}' });

  const chooseAction = (key: string, next: CatalogAction | undefined) =>
    patchConfig({
      action: key,
      input: JSON.stringify(next?.inputTemplate ?? {}, null, 2),
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={labelStyle}>
        {t('integration')}
        <Select
          style={inputStyle}
          value={connectorKey}
          onChange={(e) => chooseConnector(e.target.value)}
          disabled={!catalog}
        >
          <option value="" style={optionStyle}>
            {catalog ? t('choosePlaceholder') : t('loading')}
          </option>
          {catalog?.map((c) => (
            <option key={c.key} value={c.key} style={optionStyle}>
              {c.icon} {c.name}
            </option>
          ))}
        </Select>
      </label>

      {connector && (
        <label style={labelStyle}>
          {t('action')}
          <Select
            style={inputStyle}
            value={actionKey}
            onChange={(e) =>
              chooseAction(e.target.value, connector.actions.find((a) => a.key === e.target.value))
            }
          >
            <option value="" style={optionStyle}>
              {t('choosePlaceholder')}
            </option>
            {connector.actions.map((a) => (
              <option key={a.key} value={a.key} style={optionStyle}>
                {/* The marker is not decoration: it is the difference between an
                    action that reads and one that spends money or sends a message. */}
                {a.mutates ? '✦ ' : ''}
                {a.label}
              </option>
            ))}
          </Select>
        </label>
      )}

      {action && (
        <>
          <div style={hintStyle}>{action.description}</div>
          <label style={labelStyle}>
            {t('input')}
            <textarea
              style={{ ...inputStyle, minHeight: 110, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }}
              value={String(config.input ?? '{}')}
              spellCheck={false}
              onChange={(e) => setConfig('input', e.target.value)}
            />
          </label>
          <div style={hintStyle}>{t('templateHint')}</div>

          {action.params.length > 0 && (
            <div style={hintStyle}>
              <strong>{t('parameters')}</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                {action.params.map((p) => (
                  <li key={p.name} style={{ marginBottom: 2 }}>
                    <code>{p.name}</code>
                    {p.required ? ` — ${t('required')}` : ''} · {p.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* An action that spends money or messages a customer, on an unattended
          schedule, is worth one sentence of warning before it is saved. */}
      {action?.mutates && <div style={{ ...hintStyle, color: 'var(--warning, #9a6200)' }}>{t('mutatesWarning')}</div>}

      {connector && connector.authFields.length > 0 && (
        <div style={hintStyle}>{t('connectionHint', { name: connector.name })}</div>
      )}

      {error && <div style={{ ...hintStyle, color: 'var(--danger, #b3261e)' }}>{error}</div>}
    </div>
  );
}
