/**
 * The accessibility audit — because distributing an inaccessible artifact to a class
 * is unlawful, not untidy.
 *
 * ── WHY THIS IS A GATE AND NOT A LINT ────────────────────────────────────────────
 * Every other quality check on the canvas is advisory: a chart with no title is worse,
 * not forbidden. This one is different. Under the Equality Act, the ADA/Section 508,
 * the EU Web Accessibility Directive and AODA, a university that publishes an
 * uncaptioned lecture recording or an unlabelled diagram to enrolled students has
 * broken the law, and the remedy is retrospective. So findings carry a SEVERITY, and
 * `blocker` means the distribute action refuses.
 *
 * ── WHY SEVERITY DEPENDS ON THE COHORT ───────────────────────────────────────────
 * The interesting rule, and the one a generic linter cannot express: a missing caption
 * is a `warning` in general and a `blocker` the moment a learner on this cohort has an
 * approved `accommodation` requiring captions. That is what the law actually says —
 * the duty is to the students you have — and it is only computable because the roster,
 * the accommodations and the artifacts are on the same board.
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

export type A11ySeverity = 'blocker' | 'warning';

/** A finding, as a code the UI localises plus the WCAG criterion it fails. Never a
 *  sentence: this is rendered in five languages and read by people who will cite it. */
export interface A11yFinding {
  objectId: string;
  kind: string;
  title: string;
  code: 'missingAltText' | 'missingCaptions' | 'missingTranscript' | 'missingSummary' | 'missingEquationAlt' | 'missingFormat';
  severity: A11ySeverity;
  /** WCAG 2.2 success criterion, e.g. "1.2.2". Quoted verbatim in a complaint. */
  criterion: string;
  /** The accommodation that raised this to a blocker, when one did. */
  raisedBy?: string;
}

export interface AuditNode {
  id: string;
  data: Readonly<Record<string, unknown>>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const has = (value: unknown): boolean => text(value).length > 0;

/** Kinds whose output is non-text content and therefore needs a text alternative. */
const VISUAL_KINDS: ReadonlySet<string> = new Set<CreationObjectKind[] extends never ? string : string>([
  'image', 'comic', 'animation', 'model3d', 'cad', 'diagram', 'drawing', 'mockup',
]);

/** Kinds that convey data and need a summary a reader can use instead of the picture. */
const DATA_KINDS: ReadonlySet<string> = new Set(['chart', 'map', 'dashboard', 'kpi', 'report']);

/**
 * What a learner's approved accommodations require, reduced to the checks they affect.
 *
 * Only the format vocabulary is read — never the reason. `accommodation.evidenceHeld`
 * is deliberately a verdict rather than a document for the same reason: the board needs
 * to know an adjustment is authorised, not why, and a health condition has no business
 * in an artifact audit.
 */
export interface AccommodationNeeds {
  captions: boolean;
  transcripts: boolean;
  altText: boolean;
  /** Titles of the accommodations that produced these needs, for attribution. */
  sources: readonly string[];
}

const CAPTION_WORDS = /caption|subtitle|deaf|hard of hearing/i;
const TRANSCRIPT_WORDS = /transcript/i;
const ALT_WORDS = /screen[- ]?reader|alt[- ]?text|braille|blind|low vision|tagged/i;

export function accommodationNeeds(nodes: readonly AuditNode[]): AccommodationNeeds {
  const needs = { captions: false, transcripts: false, altText: false, sources: [] as string[] };
  for (const node of nodes) {
    if (node.data.kind !== 'accommodation') continue;
    if (text(node.data.evidenceHeld).toLowerCase().startsWith('pending')) continue;
    const haystack = [
      ...(Array.isArray(node.data.provisions) ? node.data.provisions : []),
      ...(Array.isArray(node.data.formats) ? node.data.formats : []),
    ].map((entry) => text(entry)).join(' ');
    if (!haystack) continue;
    let matched = false;
    if (CAPTION_WORDS.test(haystack)) { needs.captions = true; matched = true; }
    if (TRANSCRIPT_WORDS.test(haystack)) { needs.transcripts = true; matched = true; }
    if (ALT_WORDS.test(haystack)) { needs.altText = true; matched = true; }
    if (matched) needs.sources.push(text(node.data.title) || text(node.data.learnerRef));
  }
  return needs;
}

/**
 * Audit every artifact on a board.
 *
 * One pass over the nodes with the needs computed first, rather than a per-node lookup
 * into the accommodation list: a board with 200 submissions and 12 accommodations would
 * otherwise be 2,400 scans on every render of the panel.
 */
export function auditAccessibility(nodes: readonly AuditNode[]): readonly A11yFinding[] {
  const needs = accommodationNeeds(nodes);
  const raise = (required: boolean): A11ySeverity => (required ? 'blocker' : 'warning');
  const attribution = needs.sources.length ? needs.sources[0] : undefined;
  const findings: A11yFinding[] = [];

  for (const node of nodes) {
    const kind = text(node.data.kind);
    const title = text(node.data.title);
    const base = { objectId: node.id, kind, title };

    if (VISUAL_KINDS.has(kind) && !has(node.data.altText) && !has(node.data.summary)) {
      findings.push({ ...base, code: 'missingAltText', severity: raise(needs.altText), criterion: '1.1.1', ...(needs.altText && attribution ? { raisedBy: attribution } : {}) });
    }

    if (DATA_KINDS.has(kind) && !has(node.data.summary) && !has(node.data.altText)) {
      findings.push({ ...base, code: 'missingSummary', severity: raise(needs.altText), criterion: '1.1.1', ...(needs.altText && attribution ? { raisedBy: attribution } : {}) });
    }

    // A video is captioned or it is not distributable. `lecture` carries the same
    // requirement the moment it has a recording — the rule is about the artifact, not
    // about which card happens to hold it.
    const hasRecording = kind === 'video' ? has(node.data.videoUrl) || has(node.data.outputUrl) || has(node.data.renderedVideoUrl) : has(node.data.recordingUrl);
    if ((kind === 'video' || kind === 'lecture') && hasRecording && !has(node.data.captionsUrl)) {
      findings.push({ ...base, code: 'missingCaptions', severity: raise(needs.captions), criterion: '1.2.2', ...(needs.captions && attribution ? { raisedBy: attribution } : {}) });
    }

    if ((kind === 'podcast' || kind === 'voice') && !has(node.data.transcript)) {
      findings.push({ ...base, code: 'missingTranscript', severity: raise(needs.transcripts), criterion: '1.2.1', ...(needs.transcripts && attribution ? { raisedBy: attribution } : {}) });
    }

    if (kind === 'equation' && has(node.data.tex) && !has(node.data.altText)) {
      // Rendered MathML always carries a GENERATED reading, so this never leaves a
      // student with nothing — but a generated reading of a non-trivial expression is
      // frequently wrong, which is why the author's own is required for distribution.
      findings.push({ ...base, code: 'missingEquationAlt', severity: raise(needs.altText), criterion: '1.1.1', ...(needs.altText && attribution ? { raisedBy: attribution } : {}) });
    }
  }

  // Blockers first: the list exists to be worked from the top, and a warning above a
  // legal blocker is how the blocker gets scrolled past.
  return findings.sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'blocker' ? -1 : 1));
}

export interface A11yVerdict {
  blockers: number;
  warnings: number;
  /** Whether a distribute/publish action may proceed. */
  distributable: boolean;
  /** 0-100, for the meter. Blockers cost far more than warnings by design. */
  score: number;
}

export function accessibilityVerdict(findings: readonly A11yFinding[], artifactCount: number): A11yVerdict {
  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;
  const warnings = findings.length - blockers;
  const denominator = Math.max(1, artifactCount);
  const penalty = Math.min(100, ((blockers * 3 + warnings) / denominator) * 100);
  return {
    blockers,
    warnings,
    distributable: blockers === 0,
    score: Math.max(0, Math.round(100 - penalty)),
  };
}
