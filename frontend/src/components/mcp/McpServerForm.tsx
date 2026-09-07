'use client';

/**
 * The register / edit form for one bring-your-own MCP server, rendered inside a
 * SlideOutPanel by the gallery. Presentational + local draft state only: it never
 * fetches, so the same form serves "add" and "edit" and can be dropped onto any
 * surface that can supply a submit handler.
 *
 * The secret field is write-only by design — the API returns `hasSecret`, never
 * the value — so an edit leaves it blank to keep what is stored, and an explicit
 * clear is its own control rather than "an empty box means delete".
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreateMcpExtensionInput, McpExtension, UpdateMcpExtensionInput } from '@/lib/mcpExtensionsApi';

const field: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-body)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};
const label: React.CSSProperties = { display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 650, color: 'var(--text-secondary)', margin: '0 0 5px' };
const row: React.CSSProperties = { marginBottom: 14 };
const primary: React.CSSProperties = {
  padding: '9px 15px', fontSize: 'var(--font-size-body)', fontWeight: 650, background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const subtle: React.CSSProperties = {
  padding: '9px 15px', fontSize: 'var(--font-size-body)', fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};

export interface McpServerFormProps {
  /** The server being edited, or null when registering a new one. */
  server: McpExtension | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmitCreate: (input: CreateMcpExtensionInput) => void;
  onSubmitUpdate: (id: string, input: UpdateMcpExtensionInput) => void;
}

export function McpServerForm(props: McpServerFormProps) {
  const t = useTranslations('mcpServers');
  const editing = props.server;
  const [name, setName] = useState(editing?.name ?? '');
  const [serverUrl, setServerUrl] = useState(editing?.serverUrl ?? '');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [allowedTools, setAllowedTools] = useState(editing?.allowedTools?.join(', ') ?? '');

  const httpsOk = /^https:\/\//i.test(serverUrl.trim());
  const canSubmit = name.trim().length > 0 && httpsOk && !props.busy;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const tools = allowedTools.trim()
      ? allowedTools.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    if (editing) {
      props.onSubmitUpdate(editing.id, {
        name: name.trim(),
        serverUrl: serverUrl.trim(),
        allowedTools: tools,
        ...(clearSecret ? { secret: null } : secret.trim() ? { secret: secret.trim() } : {}),
      });
      return;
    }
    props.onSubmitCreate({ name: name.trim(), serverUrl: serverUrl.trim(), ...(secret.trim() ? { secret: secret.trim() } : {}) });
  };

  return (
    <form onSubmit={submit}>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('form.intro')}</p>

      <div style={row}>
        <label style={label} htmlFor="mcp-name">{t('form.nameLabel')}</label>
        <input id="mcp-name" style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('form.namePlaceholder')} />
      </div>

      <div style={row}>
        <label style={label} htmlFor="mcp-url">{t('form.urlLabel')}</label>
        <input id="mcp-url" style={field} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://mcp.example.com/sse" inputMode="url" />
        <p style={{ fontSize: 'var(--font-size-eyebrow)', color: serverUrl && !httpsOk ? 'var(--danger)' : 'var(--text-muted)', margin: '5px 0 0' }}>
          {serverUrl && !httpsOk ? t('form.urlMustBeHttps') : t('form.urlHint')}
        </p>
      </div>

      <div style={row}>
        <label style={label} htmlFor="mcp-secret">{t('form.secretLabel')}</label>
        <input id="mcp-secret" style={field} type="password" value={secret} disabled={clearSecret} onChange={(e) => setSecret(e.target.value)} placeholder={editing?.hasSecret ? t('form.secretKeepPlaceholder') : t('form.secretPlaceholder')} autoComplete="off" />
        <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '5px 0 0' }}>{t('form.secretHint')}</p>
        {editing?.hasSecret && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 7 }}>
            <input type="checkbox" checked={clearSecret} onChange={(e) => { setClearSecret(e.target.checked); if (e.target.checked) setSecret(''); }} />
            {t('form.clearSecret')}
          </label>
        )}
      </div>

      {editing && (
        <div style={row}>
          <label style={label} htmlFor="mcp-tools">{t('form.toolsLabel')}</label>
          <input id="mcp-tools" style={field} value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} placeholder={t('form.toolsPlaceholder')} />
          <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '5px 0 0' }}>{t('form.toolsHint')}</p>
        </div>
      )}

      {props.error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--font-size-small)', margin: '0 0 12px' }}>{props.error}</p>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="submit" style={{ ...primary, opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }} disabled={!canSubmit}>
          {editing ? t('form.save') : t('form.register')}
        </button>
        <button type="button" style={subtle} onClick={props.onCancel}>{t('form.cancel')}</button>
      </div>
    </form>
  );
}
