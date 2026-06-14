'use client';

import { useState, type CSSProperties } from 'react';
import type { PublishedAgent } from '@/lib/types';
import type { AgentManifest, NamedArtifact } from '@/lib/builderforceApi';
import { formatAgentPrice } from '@/lib/agentPresentation';
import { RUNTIME_LABELS } from './CloudAgentFormFields';

/**
 * The "Assigned configuration" block on a workforce {@link AgentCard}: the agent's
 * pinned skills / personas / content as chips, plus a "Copy manifest" button that
 * puts a shareable plain-text manifest on the clipboard.
 *
 * Single source for BOTH the visible chips and the copyable text (one
 * {@link buildAgentManifestText}) so the card and the clipboard never disagree about
 * what an agent is configured with. Renders even when nothing is assigned — an
 * explicit "No skills or personas assigned" is the signal that an agent has no
 * configured capability for the work it might be auto-staffed.
 */

const sectionStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  borderTop: '1px solid var(--border)', paddingTop: 8,
};
const headRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const headLabel: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--muted)' };
const copyBtn: CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-elevated)', color: 'var(--text-strong)', border: '1px solid var(--border)',
};
const rowStyle: CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' };
const groupLabel: CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--muted)', minWidth: 58 };
const chipStyle: CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
  background: 'var(--surface-coral-soft)', color: 'var(--accent)', whiteSpace: 'nowrap',
};
const personaChip: CSSProperties = { ...chipStyle, background: 'var(--bg-elevated)', color: 'var(--text-strong)' };
const emptyNote: CSSProperties = { fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' };

const label = (a: NamedArtifact) => a.name ?? a.slug;

const EMPTY_MANIFEST: AgentManifest = { skills: [], personas: [], content: [] };

/** Shared "Copy manifest" behaviour (text + transient "Copied!" state) so the card
 *  section and the compact table-row cell never diverge on what gets copied. */
function useManifestCopy(agent: PublishedAgent, m: AgentManifest) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildAgentManifestText(agent, m));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the chips still show the config */ }
  };
  return { copied, copy };
}

/** Build the shareable plain-text manifest for an agent (config + assigned artifacts). */
export function buildAgentManifestText(agent: PublishedAgent, manifest: AgentManifest): string {
  const fmtList = (items: NamedArtifact[]) =>
    items.length ? items.map((a) => (a.name && a.name !== a.slug ? `${a.name} (${a.slug})` : a.slug)).join(', ') : '—';
  const lines = [
    '# BuilderForce Agent Manifest',
    `Name:    ${agent.name}`,
    `Ref:     ${agent.id}`,
  ];
  if (agent.title && agent.title !== agent.name) lines.push(`Title:   ${agent.title}`);
  lines.push(
    `Runtime: ${RUNTIME_LABELS[agent.runtime_support ?? 'cloud']}`,
    `Model:   ${agent.base_model || '—'}`,
    `Price:   ${formatAgentPrice(agent)}`,
    '',
    `Personas: ${fmtList(manifest.personas)}`,
    `Skills:   ${fmtList(manifest.skills)}`,
    `Content:  ${fmtList(manifest.content)}`,
  );
  if (agent.bio) lines.push('', `Bio: ${agent.bio}`);
  return lines.join('\n');
}

function ChipRow({ label: groupName, items, persona }: { label: string; items: NamedArtifact[]; persona?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div style={rowStyle}>
      <span style={groupLabel}>{groupName}</span>
      {items.map((a) => (
        <span key={a.slug} style={persona ? personaChip : chipStyle} title={a.slug}>{label(a)}</span>
      ))}
    </div>
  );
}

export function AgentManifestSection({ agent, manifest }: { agent: PublishedAgent; manifest?: AgentManifest }) {
  const m: AgentManifest = manifest ?? EMPTY_MANIFEST;
  const empty = m.skills.length === 0 && m.personas.length === 0 && m.content.length === 0;
  const { copied, copy } = useManifestCopy(agent, m);

  return (
    <div style={sectionStyle}>
      <div style={headRow}>
        <span style={headLabel}>Assigned configuration</span>
        <button type="button" style={copyBtn} onClick={copy}>{copied ? 'Copied!' : 'Copy manifest'}</button>
      </div>
      {empty ? (
        <div style={emptyNote}>No skills or personas assigned</div>
      ) : (
        <>
          <ChipRow label="Personas" items={m.personas} persona />
          <ChipRow label="Skills" items={m.skills} />
          <ChipRow label="Content" items={m.content} />
        </>
      )}
    </div>
  );
}

const inlineWrap: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
const moreChip: CSSProperties = { ...chipStyle, background: 'var(--bg-elevated)', color: 'var(--muted)' };
const inlineCopyBtn: CSSProperties = { ...copyBtn, padding: '2px 7px' };

/**
 * Compact manifest for a dense surface (the /workforce list/table row): the agent's
 * assigned artifacts as a capped chip strip + a "Copy" button. Same assigned-config
 * data and the same copied text ({@link buildAgentManifestText}) as the card's
 * {@link AgentManifestSection}, so the two views stay consistent.
 */
export function AgentManifestInline({ agent, manifest }: { agent: PublishedAgent; manifest?: AgentManifest }) {
  const m: AgentManifest = manifest ?? EMPTY_MANIFEST;
  const { copied, copy } = useManifestCopy(agent, m);
  const all: Array<NamedArtifact & { persona?: boolean }> = [
    ...m.personas.map((p) => ({ ...p, persona: true })),
    ...m.skills,
    ...m.content,
  ];
  const MAX = 3;
  const shown = all.slice(0, MAX);
  const overflow = all.length - shown.length;

  return (
    <div style={inlineWrap}>
      {all.length === 0 ? (
        <span style={emptyNote}>None assigned</span>
      ) : (
        <>
          {shown.map((a) => (
            <span key={a.slug} style={a.persona ? personaChip : chipStyle} title={a.slug}>{label(a)}</span>
          ))}
          {overflow > 0 && <span style={moreChip} title={all.slice(MAX).map(label).join(', ')}>+{overflow}</span>}
        </>
      )}
      <button type="button" style={inlineCopyBtn} onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
    </div>
  );
}
