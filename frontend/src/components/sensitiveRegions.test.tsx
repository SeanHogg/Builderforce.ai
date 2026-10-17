import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import PageContainer from './PageContainer';
import { MintedTenantApiKeyDisplay } from './MintedTenantApiKeyDisplay';

/**
 * PRD 33 D9 / S3 — the regions builderforce.ai's recorder must never capture.
 * `[data-bf-block]` is replaced by a placeholder box; `[data-bf-mask]` has every
 * text node masked. Each entry's ROOT element carries the attribute, so nothing
 * inside it — keys, secrets, payment, what someone types to the Brain — is
 * recorded however the component's insides change.
 */
const SENSITIVE_REGIONS: ReadonlyArray<{ file: string; component: string; privacy: 'block' | 'mask' }> = [
  { file: 'settings/ApiKeysContent.tsx', component: 'ApiKeysContent', privacy: 'block' },
  { file: 'admin/TenantApiKeysAdminTab.tsx', component: 'TenantApiKeysAdminTab', privacy: 'block' },
  { file: 'MintedTenantApiKeyDisplay.tsx', component: 'MintedTenantApiKeyDisplay', privacy: 'block' },
  { file: 'ProviderKeysSettings.tsx', component: 'ProviderKeysSettings', privacy: 'block' },
  { file: 'integrations/CredentialKeyForm.tsx', component: 'CredentialKeyForm', privacy: 'block' },
  { file: 'mcp/McpServerForm.tsx', component: 'McpServerForm', privacy: 'block' },
  { file: 'billing/BillingClient.tsx', component: 'BillingClient', privacy: 'block' },
  { file: 'ProjectBackendPanel.tsx', component: 'ProjectBackendPanel', privacy: 'block' },
  // Every web AI surface's footer (Brain panel, guest drawer, canvas) — what a person types to the Brain.
  { file: 'ai-surface/WebAiSurface.tsx', component: 'WebSurfaceFooter', privacy: 'mask' },
];
// A shared part (`SurfaceFooter`) takes the attribute through its `dataAttrs` prop.

/** The opening tag of the element a component's top-level `return (` renders. */
function rootElementOf(source: string, component: string): string {
  const start = source.search(new RegExp(`export (?:default )?function ${component}\\b`));
  expect(start, `${component} is declared`).toBeGreaterThanOrEqual(0);
  const body = source.slice(start);
  const match = /\n {2}return \(\s*\n(\s*<[^\n]*)/.exec(body);
  expect(match, `${component} has a top-level return`).not.toBeNull();
  return match![1]!.trim();
}

describe('sensitive regions are never recorded', () => {
  it.each(SENSITIVE_REGIONS)('$component roots in a $privacy region', ({ file, component, privacy }) => {
    const source = readFileSync(resolve(__dirname, file), 'utf8');
    const root = rootElementOf(source, component);
    const marker = privacy === 'block'
      ? /\{\.\.\.REPLAY_BLOCK\}|privacy="block"|dataAttrs=\{REPLAY_BLOCK\}/
      : /\{\.\.\.REPLAY_MASK\}|privacy="mask"|dataAttrs=\{REPLAY_MASK\}/;
    expect(root).toMatch(marker);
  });

  it('PageContainer renders the attribute on its root', () => {
    const { container, rerender } = render(<PageContainer privacy="block"><p>x</p></PageContainer>);
    expect(container.firstElementChild).toHaveAttribute('data-bf-block');
    rerender(<PageContainer privacy="mask"><p>x</p></PageContainer>);
    expect(container.firstElementChild).toHaveAttribute('data-bf-mask');
    rerender(<PageContainer><p>x</p></PageContainer>);
    expect(container.firstElementChild).not.toHaveAttribute('data-bf-block');
  });

  it('the minted-key reveal blocks its whole card', () => {
    const { container } = render(<MintedTenantApiKeyDisplay rawKey="example-key-value" name="CI" onDismiss={() => {}} />);
    expect(container.firstElementChild).toHaveAttribute('data-bf-block');
    expect(container.querySelector('[data-bf-block]')).toHaveTextContent("example-key-value");
  });
});
