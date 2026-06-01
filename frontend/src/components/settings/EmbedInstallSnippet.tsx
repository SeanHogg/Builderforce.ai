'use client';

import { useMemo, useState } from 'react';
import {
  EMBED_VIEWS,
  EMBED_VIEW_KEYS,
  capabilityForView,
  type EmbedCapability,
  type EmbedView,
} from '@seanhogg/builderforce-embedded';

/**
 * Copy-paste install block for a host developer wiring BuilderForce into their
 * app. Derives the list of mountable views from the enabled capabilities (DRY —
 * the view↔capability mapping is the package's single source of truth), so this
 * never drifts from what the host is actually entitled to surface.
 *
 * This is the "snippet" a host obtains: install the package, then render
 * <BuilderForceEmbed view=… token={sso} /> per thin-shell page.
 */

const EMBED_ORIGIN = 'https://app.builderforce.ai';

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 12, marginBottom: 4,
};

const codeBox: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 12, padding: '10px 12px',
  background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)',
  whiteSpace: 'pre-wrap', margin: 0, overflowX: 'auto',
};

const button: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600,
  background: 'var(--surface-interactive)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};

const INSTALL_CMD = 'npm install @seanhogg/builderforce-embedded';

/** A representative starter view per capability for the usage example. */
const SAMPLE_VIEW: Record<EmbedCapability, EmbedView> = {
  product: 'ideas',
  agile: 'kanban',
  security: 'soc2',
};

interface Props {
  capabilities: EmbedCapability[];
}

export function EmbedInstallSnippet({ capabilities }: Props) {
  const [copied, setCopied] = useState<'install' | 'usage' | null>(null);

  const copy = (what: 'install' | 'usage', text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  // Views the host may mount, filtered to the enabled capabilities only.
  const enabledViews = useMemo(
    () => EMBED_VIEW_KEYS.filter((v) => capabilities.includes(capabilityForView(v))),
    [capabilities],
  );

  const sampleView = useMemo<EmbedView>(() => {
    const firstCap = capabilities[0];
    return firstCap ? SAMPLE_VIEW[firstCap] : 'kanban';
  }, [capabilities]);

  const usage = `import { BuilderForceEmbed } from '@seanhogg/builderforce-embedded';

// One thin-shell page per surface — parameterized by \`view\`.
export default function ProductPage() {
  return (
    <BuilderForceEmbed
      view="${sampleView}"
      token={getSsoToken}            // () => string | Promise<string> — your signed SSO/tenant JWT
      baseUrl="${EMBED_ORIGIN}"
      accountId={currentAccountId}   // federated segment coordinates (segmented tenants)
      companyId={currentCompanyId}
    />
  );
}`;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        Install in your host app
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        A host developer installs the package and renders one component per page, passing your signed
        SSO/tenant JWT. The token is handed to the iframe over <code>postMessage</code> — never in a URL.
      </div>

      <div style={labelStyle}>1 · Install</div>
      <pre style={codeBox}>{INSTALL_CMD}</pre>

      <div style={labelStyle}>2 · Mount a surface</div>
      <pre style={codeBox}>{usage}</pre>

      <div style={labelStyle}>Mountable views ({enabledViews.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {enabledViews.map((v) => (
          <span
            key={v}
            title={EMBED_VIEWS[v].label}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, padding: '2px 8px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6,
            }}
          >
            {v}
          </span>
        ))}
        {enabledViews.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No capabilities enabled — turn on Product / Agile / Security above to expose views.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => copy('install', INSTALL_CMD)} style={button}>
          {copied === 'install' ? '✓ Copied' : 'Copy install'}
        </button>
        <button type="button" onClick={() => copy('usage', usage)} style={button}>
          {copied === 'usage' ? '✓ Copied' : 'Copy snippet'}
        </button>
      </div>
    </div>
  );
}
