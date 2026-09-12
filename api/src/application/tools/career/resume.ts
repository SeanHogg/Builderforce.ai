/**
 * Career analyzers that read ONE RÉSUMÉ as a document — its score, its edit list,
 * its tone, its summary brief, the merge of several versions, and what a parser
 * pulls out of it. Adapters only; every measurement is an `application/career`
 * function (see the header of `../careerTools.ts`).
 */
import {
  consolidateResumes, optimizeResume, resumeSentiment, scoreResume, summarizeResume,
} from '../../career';
import { parseResume } from '@builderforce/creation-canvas-contract';
import { enumSlug } from '../analyzerCopy';
import type { AnalyzerTool } from '../toolTypes';
import {
  countMetric, counted, excerpt, grade, instructionRec, listMetric, needsInput, pctMetric, text,
} from './helpers';

// ── 1. AI Résumé Scorer ───────────────────────────────────────────────────────

export const resumeScorer: AnalyzerTool = {
  id: 'ai-resume-scorer',
  name: 'AI Résumé Scorer',
  tagline: 'Grade a résumé the way an applicant tracking system reads it.',
  icon: '📊',
  category: 'career',
  kind: 'analyzer',
  about:
    'Scores a résumé across the five categories a screener actually filters on — parseability, content, keyword coverage, formatting and quantified impact — and ranks the fixes by how much each one moves the score. The measurement is deterministic: the same document always scores the same, so a change you make is a change you can see.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…', help: 'Plain text is fine — headings, bullets and dates are detected.' },
  ],
  copy: {
    needsInput: 'Paste a résumé to see the result.',
    headline: '{grade} · {score}/100',
    summary: 'Scored against the five categories a screener filters on.',
    bullets: 'Bullets',
    bulletsValue: '{quantified} of {total} quantified',
    bulletsHint: 'Numbers are what separate a claim from an achievement.',
    openers: 'Openers',
    openersValue: '{strong} strong · {weak} weak',
    openersHint: 'A weak opener describes presence rather than contribution.',
    length: 'Length',
    lengthValue: '{words} words',
    sections: 'Sections found',
    sectionsEmpty: 'No standard headings detected',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput(c);
    const scored = scoreResume(resume);
    const m = scored.measured;
    return {
      headline: c('headline', { grade: grade(scored.overall), score: scored.overall }),
      summary: scored.strengths[0] ?? c('summary'),
      score: scored.overall,
      scoreLabel: grade(scored.overall),
      metrics: [
        ...scored.categories.map((cat) => pctMetric(c, cat.label, cat.score, cat.evidence)),
        countMetric(c('bullets'), c('bulletsValue', { quantified: m.quantifiedBullets, total: m.bullets }), c('bulletsHint')),
        countMetric(c('openers'), c('openersValue', { strong: m.strongOpeners, weak: m.weakOpeners }), c('openersHint')),
        countMetric(c('length'), c('lengthValue', { words: m.words })),
        listMetric(c, c('sections'), m.sections, c('sectionsEmpty')),
      ],
      recommendations: scored.recommendations.map((r) => ({ title: r.title, detail: r.detail, priority: r.priority })),
    };
  },
};

// ── 2. Résumé Optimizer ───────────────────────────────────────────────────────

export const resumeOptimizer: AnalyzerTool = {
  id: 'resume-optimizer',
  name: 'Résumé Optimizer',
  tagline: 'The anchored edit list — every change names the line it applies to.',
  icon: '✏️',
  category: 'career',
  kind: 'analyzer',
  about:
    'Produces the prioritised list of edits a résumé needs, each one quoting the exact existing text it applies to and what the replacement has to contain. It never writes the replacement: only you know what you actually did, and a fabricated bullet is one you have to defend in an interview.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
    { id: 'job', label: 'Job description', type: 'document', required: false, placeholder: 'Optional — paste a posting to also get its missing keywords.' },
  ],
  copy: {
    needsInput: 'Paste a résumé to see the result.',
    'headline.one': '{n} edit to make',
    'headline.other': '{n} edits to make',
    'summaryJob.one': 'Scored {score}/100 against this posting, with {n} keyword missing.',
    'summaryJob.other': 'Scored {score}/100 against this posting, with {n} keywords missing.',
    summaryNoJob: 'Scored {score}/100. Add a job description to also see the keywords it is missing.',
    missingKeywords: 'Missing keywords',
    missingKeywordsEmpty: 'None — the posting is well covered',
    editTitle: '{kind} — “{target}”',
    'kind.rewrite_bullet': 'Rewrite bullet',
    'kind.shorten_bullet': 'Shorten bullet',
    'kind.quantify_bullet': 'Quantify bullet',
    'kind.add_section': 'Add section',
    'kind.normalize_dates': 'Normalise dates',
    'kind.add_skill': 'Add skill',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput(c);
    const job = text(values, 'job');
    const opt = optimizeResume(resume, job || undefined);
    return {
      headline: counted(c, 'headline', opt.edits.length),
      summary: job
        ? counted(c, 'summaryJob', opt.missingKeywords.length, { score: opt.score.overall })
        : c('summaryNoJob', { score: opt.score.overall }),
      score: opt.score.overall,
      scoreLabel: grade(opt.score.overall),
      metrics: [
        ...opt.score.categories.map((cat) => pctMetric(c, cat.label, cat.score, cat.evidence)),
        ...(job ? [listMetric(c, c('missingKeywords'), opt.missingKeywords, c('missingKeywordsEmpty'))] : []),
      ],
      recommendations: [
        ...opt.edits.map((e) => ({
          title: c('editTitle', { kind: c(enumSlug('kind', e.kind)), target: excerpt(e.target) }),
          detail: `${e.reason} ${e.requirement}`,
          priority: e.priority,
        })),
        ...instructionRec(c, opt.instruction),
      ],
    };
  },
};

// ── 6. Tone Check ─────────────────────────────────────────────────────────────

export const toneCheck: AnalyzerTool = {
  id: 'sentiment-analysis',
  name: 'Tone Check',
  tagline: 'Does your résumé read as confident, flat, or apologetic?',
  icon: '🎚️',
  category: 'career',
  kind: 'analyzer',
  about:
    'Reads the tone of a résumé — the balance of contribution language against hedging and passive description — and flags the exact lines that describe presence rather than impact. Applicant tracking systems do not measure tone; the human who reads the handful of résumés that pass absolutely does.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
  ],
  copy: {
    needsInput: 'Paste a résumé to see the result.',
    headline: '{score}/100 · reads as {label}',
    'summaryFlagged.one': '{n} line describes presence rather than contribution.',
    'summaryFlagged.other': '{n} lines describe presence rather than contribution.',
    summaryClean: 'No hedging or passive openers found.',
    overallTone: 'Overall tone',
    positiveSignals: 'Contribution signals',
    negativeSignals: 'Negative signals',
    hedges: 'Hedges',
    hedgesHint: 'Words like “helped”, “assisted”, “involved in”.',
    rewriteTitle: 'Rewrite “{line}”',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput(c);
    const tone = resumeSentiment(resume);
    return {
      headline: c('headline', { score: tone.score, label: tone.label }),
      summary: tone.flagged.length
        ? counted(c, 'summaryFlagged', tone.flagged.length)
        : c('summaryClean'),
      score: tone.score,
      scoreLabel: tone.label,
      metrics: [
        pctMetric(c, c('overallTone'), tone.score),
        countMetric(c('positiveSignals'), tone.positiveSignals),
        countMetric(c('negativeSignals'), tone.negativeSignals),
        countMetric(c('hedges'), tone.hedges, c('hedgesHint')),
      ],
      recommendations: tone.flagged.map((f) => ({
        title: c('rewriteTitle', { line: excerpt(f.text) }),
        detail: f.reason,
        priority: 'medium' as const,
      })),
    };
  },
};

// ── 7. Summary Writer ─────────────────────────────────────────────────────────

export const summaryWriter: AnalyzerTool = {
  id: 'summarize-resume',
  name: 'Summary Brief',
  tagline: 'The evidence a professional summary should be written from.',
  icon: '📝',
  category: 'career',
  kind: 'analyzer',
  about:
    'Assembles what a recruiter-ready summary needs: the strongest quantified achievements, the skills that actually repeat, and the span of experience the dates imply. It hands back the brief rather than the paragraph, because the summary that works is the one in your own voice.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
  ],
  copy: {
    needsInput: 'Paste a résumé to see the result.',
    headlineHas: 'You already have a summary',
    headlineNone: 'No summary section found',
    yearsSpanned: 'Years spanned',
    yearsUnknown: 'Not derivable from the dates',
    distinctSkills: 'Distinct skills',
    topSkills: 'Top skills',
    topSkillsEmpty: 'None detected',
    evidence: 'Strongest evidence',
    evidenceEmpty: 'No quantified bullets found',
    currentSummary: 'Current summary',
    writeItTitle: 'Write it from this',
    scaleTitle: 'Lead with scale',
    scaleDetail: 'These are the numbers worth putting in the first sentence: {figures}',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput(c);
    const brief = summarizeResume(resume);
    return {
      headline: brief.existingSummary ? c('headlineHas') : c('headlineNone'),
      summary: brief.brief.whatTheyDo,
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric(c('yearsSpanned'), brief.yearsSpanned ?? c('yearsUnknown')),
        countMetric(c('distinctSkills'), brief.brief.distinctSkills),
        listMetric(c, c('topSkills'), brief.topSkills, c('topSkillsEmpty')),
        listMetric(c, c('evidence'), brief.evidenceBullets.map((b) => b.slice(0, 80)), c('evidenceEmpty')),
        ...(brief.existingSummary ? [countMetric(c('currentSummary'), brief.existingSummary.slice(0, 160))] : []),
      ],
      recommendations: [
        { title: c('writeItTitle'), detail: brief.brief.instruction, priority: 'high' },
        ...(brief.brief.scaleEvidence.length
          ? [{ title: c('scaleTitle'), detail: c('scaleDetail', { figures: brief.brief.scaleEvidence.slice(0, 4).join(' · ') }), priority: 'medium' as const }]
          : []),
      ],
    };
  },
};

// ── 9. Résumé Consolidator ────────────────────────────────────────────────────

export const resumeConsolidator: AnalyzerTool = {
  id: 'resume-consolidator',
  name: 'Résumé Consolidator',
  tagline: 'Merge several résumés into one master without losing a line.',
  icon: '🧵',
  category: 'career',
  kind: 'analyzer',
  about:
    'Compares up to three résumés and reports both the overlap and — the part that matters — the bullets that exist in only one of them. That is the content a merge done by hand silently drops, and the reason people keep four résumés instead of one. Nothing is discarded on your behalf.',
  fields: [
    { id: 'a', label: 'Résumé 1', type: 'document', required: true, placeholder: 'Paste the first résumé…' },
    { id: 'b', label: 'Résumé 2', type: 'document', required: true, placeholder: 'Paste the second…' },
    { id: 'c', label: 'Résumé 3', type: 'document', required: false, placeholder: 'Optional third.' },
  ],
  copy: {
    needsInput: 'Paste at least two résumés to see the result.',
    'headline.one': '{n} line exists in only one version',
    'headline.other': '{n} lines exist in only one version',
    'summary.one': 'Across {sources} résumés, {n} achievement appears in more than one.',
    'summary.other': 'Across {sources} résumés, {n} achievements appear in more than one.',
    sources: 'Sources compared',
    duplicates: 'Overlapping achievements',
    unique: 'Unique to one version',
    uniqueHint: 'These are what a hand-merge loses.',
    mergedSkills: 'Merged skills',
    mergedSkillsEmpty: 'None detected',
    keepTitle: 'Keep this line',
    keepDetail: '“{line}” appears in only one of your résumés — decide deliberately whether the master keeps it.',
    pickTitle: 'Pick one wording',
    pickDetail: '“{line}” is written {count} different ways. Choose the strongest and use it everywhere.',
  },
  analyze: (values, c) => {
    const sources = ['a', 'b', 'c'].map((id) => text(values, id)).filter(Boolean);
    if (sources.length < 2) return needsInput(c);
    const merged = consolidateResumes(sources);
    return {
      headline: counted(c, 'headline', merged.uniqueBullets.length),
      summary: counted(c, 'summary', merged.duplicateGroups.length, { sources: merged.sourceCount }),
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric(c('sources'), merged.sourceCount),
        countMetric(c('duplicates'), merged.duplicateGroups.length),
        countMetric(c('unique'), merged.uniqueBullets.length, c('uniqueHint')),
        listMetric(c, c('mergedSkills'), merged.mergedSkills, c('mergedSkillsEmpty')),
      ],
      recommendations: [
        ...merged.uniqueBullets.slice(0, 8).map((b) => ({
          title: c('keepTitle'),
          detail: c('keepDetail', { line: b }),
          priority: 'high' as const,
        })),
        ...merged.duplicateGroups.slice(0, 5).map((g) => ({
          title: c('pickTitle'),
          detail: c('pickDetail', { line: g.canonical, count: g.variants.length + 1 }),
          priority: 'medium' as const,
        })),
        ...instructionRec(c, merged.instruction),
      ],
    };
  },
};

// ── 10. Résumé Parser ─────────────────────────────────────────────────────────

export const resumeParser: AnalyzerTool = {
  id: 'pdf-to-json',
  name: 'Résumé Parser',
  tagline: 'See the structured data a parser pulls out of your résumé.',
  icon: '🔍',
  category: 'career',
  kind: 'analyzer',
  about:
    'Runs the same parser the rest of this platform uses and shows you what it found: the sections it recognised, the bullets it split, the dates and the skills. If a section is missing here, an applicant tracking system probably missed it too — which is a more useful answer than any score.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
  ],
  copy: {
    needsInput: 'Paste a résumé to see the result.',
    // Two counted NOUN PHRASES joined by a template, rather than one sentence
    // with two plural axes. Four `.one_one`-style slugs per language would be a
    // combinatorial catalog nobody maintains, and each phrase here is still
    // translated whole — which is the property the rule is protecting.
    headline: '{sections}, {bullets}',
    'sectionCount.one': '{n} section',
    'sectionCount.other': '{n} sections',
    'bulletCount.one': '{n} bullet',
    'bulletCount.other': '{n} bullets',
    summaryFound: 'Anything missing from this list is something a screener may also fail to find.',
    summaryNone: 'No standard sections were recognised — that is usually a formatting problem, not a content one.',
    sections: 'Sections recognised',
    bullets: 'Bullets parsed',
    quantified: 'Quantified bullets',
    quantifiedValue: '{quantified} of {total}',
    skills: 'Skills detected',
    headingsTitle: 'Use standard section headings',
    headingsDetail: 'Write “Experience”, “Education” and “Skills” as their own lines. Decorative or renamed headings are the single most common reason a parser returns nothing.',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput(c);
    const parsed = parseResume(resume);
    const sections = parsed.sections.map((s) => s.kind);
    const quantified = parsed.bullets.filter((b) => b.quantified).length;
    return {
      headline: c('headline', {
        sections: counted(c, 'sectionCount', parsed.sections.length),
        bullets: counted(c, 'bulletCount', parsed.bullets.length),
      }),
      summary: sections.length ? c('summaryFound') : c('summaryNone'),
      score: null,
      scoreLabel: null,
      metrics: [
        listMetric(c, c('sections'), sections, c('none')),
        countMetric(c('bullets'), parsed.bullets.length),
        countMetric(c('quantified'), c('quantifiedValue', { quantified, total: parsed.bullets.length })),
        listMetric(c, c('skills'), parsed.skillTokens.slice(0, 20), c('none')),
      ],
      recommendations: sections.length
        ? []
        : [{
          title: c('headingsTitle'),
          detail: c('headingsDetail'),
          priority: 'high' as const,
        }],
    };
  },
};
