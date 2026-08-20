/**
 * The pieces every résumé-AI panel renders — one definition, four surfaces.
 *
 * No `'use client'`. Every importer is already inside the client boundary declared by
 * `CareerAiClient`, so the directive would change nothing except the frontend
 * architecture ratchet's count — the shape that guard's changelog has now found six
 * times.
 *
 * The provenance strip is the part worth reading. Three of these panels put generated
 * prose in front of somebody who is going to send it to an employer, so the screen has to
 * be able to say, without being asked: which model wrote this, whether it was written
 * just now or served from the content-addressed cache, and — the one that matters — when
 * the model was unavailable and what is showing is the measured reading alone.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Badge } from '@/components/ui';
import type { AiProvenance, GradedCategory, ScoreCategory, XyzPart } from '@/lib/careerAiApi';

export const fieldStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: 'var(--font-size-body)',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  width: '100%',
  fontFamily: 'inherit',
  lineHeight: 1.5,
};

export const textAreaStyle: CSSProperties = { ...fieldStyle, minHeight: 200, resize: 'vertical' };

export const labelStyle: CSSProperties = {
  fontSize: 'var(--font-size-field-label)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  display: 'block',
  marginBottom: 6,
};

export const stackStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };

/** A quoted line from somebody's résumé. Monospace so an extra space is visible. */
export function QuotedLine({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <p style={{
      margin: 0,
      padding: '8px 10px',
      background: 'var(--surface-sunken)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--font-size-small)',
      color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    }}>
      {children}
    </p>
  );
}

/** The X / Y / Z parts a line is still missing, as chips. */
export function MissingParts({ parts, label }: { parts: readonly XyzPart[]; label: (part: XyzPart) => string }) {
  if (parts.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {parts.map((part) => <Badge key={part} tone="warning">{part} · {label(part)}</Badge>)}
    </span>
  );
}

/**
 * Which model answered, whether the answer was cached, and — loudly — whether it is
 * absent altogether. A degraded panel that looked like a working one would let somebody
 * conclude their résumé had nothing worth rewriting.
 */
export function ProvenanceNote({ provenance, labels }: {
  provenance: AiProvenance;
  labels: { degraded: (reason: string) => string; cached: string; model: (model: string) => string };
}) {
  if (provenance.degraded) {
    return (
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--warning-text)' }}>
        {labels.degraded(provenance.degradedReason ?? '')}
      </p>
    );
  }
  return (
    <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {provenance.model ? <span>{labels.model(provenance.model)}</span> : null}
      {provenance.cached ? <span>{labels.cached}</span> : null}
    </p>
  );
}

/** One measured category: the score, the count behind it, and the bar. */
export function ScoreRow({ category }: { category: ScoreCategory }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 'var(--font-size-small)' }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{category.label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{category.score}/100</span>
      </div>
      <ScoreBar value={category.score} />
      <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{category.evidence}</span>
    </div>
  );
}

/**
 * Two scores on one bar — the whole argument of the graded read, drawn.
 *
 * The measured score is the filled track; the model's is a marker on the same scale.
 * Averaging them into one number would hide exactly the thing worth seeing, so they are
 * never combined here or anywhere else.
 */
export function GradedRow({ category, labels }: {
  category: GradedCategory;
  labels: { measured: string; model: string; disagrees: string };
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 'var(--font-size-small)' }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{category.label}</span>
        <span style={{ color: 'var(--text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{labels.measured} {category.measuredScore}</span>
          {category.modelScore != null ? <span>{labels.model} {category.modelScore}</span> : null}
          {category.disagrees ? <Badge tone="warning">{labels.disagrees}</Badge> : null}
        </span>
      </div>
      <ScoreBar value={category.measuredScore} marker={category.modelScore} />
      <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{category.evidence}</span>
      {category.gaps.length > 0 && (
        <ul style={{ margin: '2px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {category.gaps.map((gap, index) => (
            <li key={index} style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {gap.gap}
              {gap.evidence ? <QuotedLine muted>{gap.evidence}</QuotedLine> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoreBar({ value, marker }: { value: number; marker?: number | null }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="presentation"
      style={{ position: 'relative', height: 8, borderRadius: 'var(--radius-full)', background: 'var(--surface-sunken)', overflow: 'hidden' }}
    >
      <div style={{ width: `${clamped}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-full)' }} />
      {marker != null && (
        <span style={{
          position: 'absolute', top: -2, bottom: -2,
          left: `calc(${Math.max(0, Math.min(100, marker))}% - 1px)`,
          width: 2, background: 'var(--text-strong)',
        }} />
      )}
    </div>
  );
}

/** The tone a review status is rendered in — open work reads as work. */
export function statusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  if (status === 'open') return 'warning';
  if (status === 'in_review') return 'info';
  if (status === 'answered') return 'success';
  return 'neutral';
}
