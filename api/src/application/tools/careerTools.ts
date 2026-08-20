/**
 * The career tool definitions — the free, no-login surfaces behind /tools/<id>.
 *
 * ── WHY THIS FILE IS ONLY ADAPTERS ───────────────────────────────────────────────
 * Every reading here already exists in `application/career`, where it is pure,
 * deterministic and unit-tested, and is already exposed to the recruiter and hr
 * agents through `careerToolCatalog.ts`. The same measurement reaching a person
 * through a web page must not be a second implementation of it — so this file
 * contains no scoring at all. It maps a string-valued input map onto a career
 * function, and that function's domain shape onto the shared `ToolResult` that
 * one runner has rendered since the maturity diagnostic.
 *
 * Fifteen articles ported from hired.video walk a reader step-by-step to these
 * URLs (see the Gap Register entry in ROADMAP.md group 14). They were the whole
 * reason the port left 404s behind, and they are data rows, not routes.
 *
 * ── TOOLS MEASURE; THE MODEL WRITES ──────────────────────────────────────────────
 * None of these return prose. `optimizeResume` and `tailorResume` deliberately
 * produce ANCHORED plans — "this exact line, for this reason, must end up
 * containing that" — because a fabricated résumé bullet is a lie the candidate
 * has to defend in a room. The recommendation list is that plan; the person (or
 * the model in the conversation with them) writes the replacement.
 *
 * ── EVERY FINDING IS TRANSLATED ──────────────────────────────────────────────────
 * Each analyzer declares its result copy as DATA (`copy`) and composes findings
 * through the `c` lookup its `analyze()` is handed. Two rules hold everywhere in
 * this file, and both exist to prevent a specific failure:
 *
 *   1. `c` is a PARAMETER. The function stays pure — the same paste scores the
 *      same in every language, and a test can run it without a locale registry.
 *   2. Numbers go in through `{placeholders}`, never by concatenating around a
 *      translated fragment, so a sentence is translated as a whole sentence.
 *      `"Level " + n` cannot be rendered by a language that puts the number
 *      first, and `n + " skills are missing"` cannot agree with its noun.
 *
 * Values the DOMAIN authors (a category label, a recommendation the résumé
 * analyzer wrote, an interview question) pass through untranslated: they are the
 * career module's copy, shared verbatim with the MCP agent tools, and translating
 * them belongs to that module rather than to this adapter.
 */
import {
  analyzeSalary, auditProfile, compareResumeToJob, computeRunway, consolidateResumes,
  buildInterviewKit, employerResearchBrief, extractSkills, optimizeResume, planForTarget,
  resumeSentiment, scoreResume, suggestTargets, summarizeResume, tailorResume,
  valueProposition, ROLE_PROFILES,
} from '../career';
import { parseResume } from '@builderforce/creation-canvas-contract';
import { enumSlug, pluralSlug, type ToolCopy } from './analyzerCopy';
import type { AnalyzerTool, ToolMetric, ToolRecommendation, ToolResult } from './toolTypes';

// ── shared shaping ────────────────────────────────────────────────────────────

/** 0..100 → the 1..5 tier the shared meter colours by. */
const tier = (pct: number): number =>
  pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= 60 ? 3 : pct >= 40 ? 2 : 1;

/** The letter people recognise from an ATS score, not an invented scale. Left
 *  untranslated on purpose: A/B/C grading is read as the American academic scale
 *  it borrows, and a localized letter would be a different measurement. */
const grade = (pct: number): string =>
  pct >= 93 ? 'A' : pct >= 90 ? 'A−' : pct >= 87 ? 'B+' : pct >= 83 ? 'B'
    : pct >= 80 ? 'B−' : pct >= 77 ? 'C+' : pct >= 73 ? 'C' : pct >= 70 ? 'C−'
      : pct >= 60 ? 'D' : 'F';

/** A percentage renders in the reader's numbering, which is not always Latin. */
const pctMetric = (c: ToolCopy, label: string, pct: number, hint?: string): ToolMetric =>
  ({ label, value: `${Math.round(pct).toLocaleString(c.locale)}%`, hint, tier: tier(pct) });

const countMetric = (label: string, value: number | string, hint?: string): ToolMetric =>
  ({ label, value: String(value), hint });

/** A list rendered into one metric, or an honest "none" rather than an empty row. */
const listMetric = (c: ToolCopy, label: string, items: readonly string[], empty: string): ToolMetric =>
  ({ label, value: items.length ? items.slice(0, 12).join(', ') : empty, hint: items.length > 12 ? c('andMore', { n: items.length - 12 }) : undefined });

const text = (values: Record<string, string>, id: string): string => (values[id] ?? '').trim();

const num = (values: Record<string, string>, id: string): number | undefined => {
  const raw = text(values, id).replace(/[^0-9.]/g, '');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Every analyzer answers the same way when handed nothing.
 *
 * The headline is shared; the sentence under it is the analyzer's OWN
 * `needsInput` slug rather than a shared template with a "what to paste"
 * fragment spliced in. That split is the placeholder rule applied honestly: "a
 * résumé and a job description" is a noun phrase that has to agree with the verb
 * around it, so the whole sentence belongs to the analyzer that says it.
 */
const needsInput = (c: ToolCopy): ToolResult => ({
  headline: c('nothingToRead'),
  summary: c('needsInput'),
  score: null,
  scoreLabel: null,
  metrics: [],
  recommendations: [],
});

/** The instruction every career reading carries — the caller's next move. */
const instructionRec = (c: ToolCopy, instruction: string): ToolRecommendation[] =>
  instruction ? [{ title: c('howToUseThis'), detail: instruction, priority: 'low' }] : [];

/** The four match verdicts, in the reader's language. Shared by the tailor and
 *  the job–résumé match, which both surface the same domain value. */
const verdictText = (c: ToolCopy, verdict: string): string => c(enumSlug('verdict', verdict));

/** A counted phrase: `{n} skill` / `{n} skills`, chosen by the count. */
const counted = (c: ToolCopy, slug: string, n: number, vars?: Record<string, string | number>): string =>
  c(pluralSlug(slug, n), { n, ...vars });

/** One quoted excerpt, elided at the length a title can carry. */
const excerpt = (value: string, max = 70): string => `${value.slice(0, max)}${value.length > max ? '…' : ''}`;

// ── 1. AI Résumé Scorer ───────────────────────────────────────────────────────

const resumeScorer: AnalyzerTool = {
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

const resumeOptimizer: AnalyzerTool = {
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

// ── 3. Résumé Tailor ──────────────────────────────────────────────────────────

const resumeTailor: AnalyzerTool = {
  id: 'resume-tailor',
  name: 'Résumé Tailor',
  tagline: 'Reorder, emphasise and evidence one résumé for one posting.',
  icon: '🎯',
  category: 'career',
  kind: 'analyzer',
  about:
    'Builds the tailoring plan for a single application: which bullet to lead with, which claims the posting cares about, and — the finding that matters most — which skills you LIST but no achievement demonstrates. A résumé that keyword-matches but evidences nothing passes the filter and dies in the interview.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
    { id: 'job', label: 'Job description', type: 'document', required: true, placeholder: 'Paste the posting you are applying to…' },
  ],
  copy: {
    needsInput: 'Paste both a résumé and a job description to see the result.',
    headline: '{score}% match · {verdict}',
    'summaryUnevidenced.one': '{n} skill is claimed but not demonstrated by any achievement.',
    'summaryUnevidenced.other': '{n} skills are claimed but not demonstrated by any achievement.',
    summaryEvidenced: 'Every skill this posting asks for is evidenced by at least one achievement.',
    claimed: 'Claimed but unevidenced',
    claimedEmpty: 'None — every claim has evidence',
    leadWith: 'Lead with',
    leadWithEmpty: 'No clearly relevant bullet found',
    moveTitle: '{kind} — “{target}”',
    'kind.lead_with': 'Lead with',
    'kind.emphasise': 'Emphasise',
    'kind.add_keyword': 'Add keyword',
    'kind.declare_gap': 'Declare the gap',
    'kind.evidence_claim': 'Evidence the claim',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    const job = text(values, 'job');
    if (!resume || !job) return needsInput(c);
    const plan = tailorResume(resume, job);
    const top = plan.bulletRelevance.slice(0, 3);
    return {
      headline: c('headline', { score: plan.match.score, verdict: verdictText(c, plan.match.verdict) }),
      summary: plan.claimedButUnevidenced.length
        ? counted(c, 'summaryUnevidenced', plan.claimedButUnevidenced.length)
        : c('summaryEvidenced'),
      score: plan.match.score,
      scoreLabel: verdictText(c, plan.match.verdict),
      metrics: [
        listMetric(c, c('claimed'), plan.claimedButUnevidenced, c('claimedEmpty')),
        listMetric(c, c('leadWith'), top.map((b) => b.text.slice(0, 60)), c('leadWithEmpty')),
        ...plan.match.byArea.map((a) => pctMetric(c, a.area, a.coverage, c('areaCoverage', { matched: a.matched, required: a.required }))),
      ],
      recommendations: [
        ...plan.moves.map((mv) => ({
          title: c('moveTitle', { kind: c(enumSlug('kind', mv.kind)), target: excerpt(mv.target) }),
          detail: `${mv.reason} ${mv.requirement}`,
          priority: mv.kind === 'declare_gap' ? ('medium' as const) : ('high' as const),
        })),
        ...instructionRec(c, plan.instruction),
      ],
    };
  },
};

// ── 4. Job–Résumé Match ───────────────────────────────────────────────────────

const jobResumeMatch: AnalyzerTool = {
  id: 'job-resume-match',
  name: 'Job–Résumé Match',
  tagline: 'Score one résumé against one posting, and see exactly what is missing.',
  icon: '🔗',
  category: 'career',
  kind: 'analyzer',
  about:
    'Measures the overlap between a résumé and a job description: the skills both name, the ones the posting wants and the résumé lacks, and the surplus you carry that it did not ask for. Coverage is broken down by area, so “strong on data, thin on cloud” is an answerable question.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
    { id: 'job', label: 'Job description', type: 'document', required: true, placeholder: 'Paste the posting…' },
  ],
  copy: {
    needsInput: 'Paste both a résumé and a job description to see the result.',
    headline: '{score}% · {verdict}',
    summary: '{matched} of {required} required skills are on your résumé.',
    matched: 'Matched',
    matchedEmpty: 'None matched',
    missing: 'Missing',
    missingEmpty: 'Nothing missing',
    missingContext: 'Missing context terms',
    surplus: 'Surplus you carry',
    addEvidenceTitle: 'Add evidence for “{skill}”',
    addEvidenceDetail: 'The posting names {skill} and your résumé does not. If you have done it, say so in an achievement; if you have not, decide whether to address the gap directly.',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    const job = text(values, 'job');
    if (!resume || !job) return needsInput(c);
    const match = compareResumeToJob(resume, job);
    return {
      headline: c('headline', { score: match.score, verdict: verdictText(c, match.verdict) }),
      summary: c('summary', { matched: match.evidence.matchedSkillCount, required: match.evidence.requiredSkillCount }),
      score: match.score,
      scoreLabel: verdictText(c, match.verdict),
      metrics: [
        ...match.byArea.map((a) => pctMetric(c, a.area, a.coverage, c('areaCoverage', { matched: a.matched, required: a.required }))),
        listMetric(c, c('matched'), match.overlap.matched, c('matchedEmpty')),
        listMetric(c, c('missing'), match.overlap.missing, c('missingEmpty')),
        listMetric(c, c('missingContext'), match.overlap.missingContext, c('none')),
        listMetric(c, c('surplus'), match.overlap.surplus, c('none')),
      ],
      recommendations: [
        ...match.overlap.missing.slice(0, 6).map((skill) => ({
          title: c('addEvidenceTitle', { skill }),
          detail: c('addEvidenceDetail', { skill }),
          priority: 'high' as const,
        })),
        ...instructionRec(c, match.instruction),
      ],
    };
  },
};

// ── 5. Skill Extractor ────────────────────────────────────────────────────────

const skillExtractor: AnalyzerTool = {
  id: 'skill-extractor',
  name: 'Skill Extractor',
  tagline: 'Pull every skill out of a résumé or a posting, grouped and paste-ready.',
  icon: '🧩',
  category: 'career',
  kind: 'analyzer',
  about:
    'Extracts the distinct skills in a document and groups them the way a skills section is written. It also reports the repeated terms it did NOT recognise — a tool that silently drops six words it has never seen looks confident while missing the point of the posting.',
  fields: [
    { id: 'text', label: 'Résumé or job description', type: 'document', required: true, placeholder: 'Paste either…' },
    {
      id: 'source', label: 'Read it as', type: 'select', required: false,
      options: [{ value: 'resume', label: 'A résumé' }, { value: 'job', label: 'A job description' }],
    },
  ],
  copy: {
    needsInput: 'Paste a résumé or a job description to see the result.',
    'headline.one': '{n} skill found',
    'headline.other': '{n} skills found',
    'summaryUnrecognised.one': '{n} repeated term was not in the lexicon — check whether it is domain vocabulary worth keeping.',
    'summaryUnrecognised.other': '{n} repeated terms were not in the lexicon — check whether they are domain vocabulary worth keeping.',
    summaryRecognised: 'Every repeated term was recognised.',
    unrecognised: 'Unrecognised repeated terms',
    decideTitle: 'Decide on the unrecognised terms',
    decideDetail: 'These repeat in the document but are not known skills: {terms}. Domain vocabulary belongs in your skills section; noise does not.',
  },
  analyze: (values, c) => {
    const body = text(values, 'text');
    if (!body) return needsInput(c);
    const source = text(values, 'source') === 'job' ? 'job' : 'resume';
    const found = extractSkills(body, source);
    return {
      headline: counted(c, 'headline', found.total),
      summary: found.unrecognisedTerms.length
        ? counted(c, 'summaryUnrecognised', found.unrecognisedTerms.length)
        : c('summaryRecognised'),
      score: null,
      scoreLabel: null,
      metrics: [
        ...found.groups.map((g) => listMetric(c, g.group, g.skills, c('none'))),
        listMetric(c, c('unrecognised'), found.unrecognisedTerms, c('none')),
      ],
      recommendations: found.unrecognisedTerms.length
        ? [{
          title: c('decideTitle'),
          detail: c('decideDetail', { terms: found.unrecognisedTerms.slice(0, 10).join(', ') }),
          priority: 'medium' as const,
        }]
        : [],
    };
  },
};

// ── 6. Tone Check ─────────────────────────────────────────────────────────────

const toneCheck: AnalyzerTool = {
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

const summaryWriter: AnalyzerTool = {
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

// ── 8. Value Proposition ──────────────────────────────────────────────────────

const valuePropositionTool: AnalyzerTool = {
  id: 'value-proposition',
  name: 'Value Proposition',
  tagline: 'What you bring that this specific employer asked for.',
  icon: '💡',
  category: 'career',
  kind: 'analyzer',
  about:
    'Separates what a target employer explicitly asked for and you have, from what you bring that they did not ask for, from the gaps worth addressing head-on. The structure it returns is the shape of a cover letter opening that is about them rather than about you.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
    { id: 'company', label: 'Company', type: 'line', required: true, placeholder: 'Northwind' },
    { id: 'role', label: 'Role', type: 'line', required: true, placeholder: 'Senior Product Manager' },
    { id: 'job', label: 'Job description', type: 'document', required: false, placeholder: 'Optional, but the alignment is only real with it.' },
  ],
  copy: {
    needsInput: 'Paste a résumé and name the company and the role to see the result.',
    headline: '{role} at {company}',
    'summaryAligned.one': '{n} of the things they asked for is already on your résumé.',
    'summaryAligned.other': '{n} of the things they asked for are already on your résumé.',
    summaryNoJob: 'Add the job description to see what genuinely aligns.',
    aligned: 'Aligned with their ask',
    alignedEmpty: 'Nothing measured — no job description supplied',
    differentiators: 'Your differentiators',
    differentiatorsEmpty: 'None beyond what they asked for',
    toAddress: 'Gaps to address',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    const company = text(values, 'company');
    const role = text(values, 'role');
    if (!resume || !company || !role) return needsInput(c);
    const vp = valueProposition({ resumeText: resume, company, role, jobDescription: text(values, 'job') || undefined });
    return {
      headline: c('headline', { role: vp.role, company: vp.company }),
      summary: vp.aligned.length
        ? counted(c, 'summaryAligned', vp.aligned.length)
        : c('summaryNoJob'),
      score: null,
      scoreLabel: null,
      metrics: [
        listMetric(c, c('aligned'), vp.aligned, c('alignedEmpty')),
        listMetric(c, c('differentiators'), vp.differentiators, c('differentiatorsEmpty')),
        listMetric(c, c('toAddress'), vp.toAddress, c('none')),
      ],
      recommendations: [
        ...vp.structure.map((s) => ({ title: s.part, detail: s.guidance, priority: 'high' as const })),
        ...instructionRec(c, vp.instruction),
      ],
    };
  },
};

// ── 9. Résumé Consolidator ────────────────────────────────────────────────────

const resumeConsolidator: AnalyzerTool = {
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

const resumeParser: AnalyzerTool = {
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

// ── 11. Profile Audit ─────────────────────────────────────────────────────────

const profileAudit: AnalyzerTool = {
  id: 'profile-audit',
  name: 'Profile Audit',
  tagline: 'Grade your public "hire me" page before a recruiter does.',
  icon: '🪞',
  category: 'career',
  kind: 'analyzer',
  about:
    'Scores the public profile a visitor actually lands on, against the fields this platform really stores — because a profile audit that grades fields the product cannot hold is advice nobody can act on.',
  fields: [
    // Required so the form cannot be run empty: with every field optional the
    // runner enables "Analyse" on a blank page and the tool answers "nothing to
    // read", which reads as broken rather than as a prompt.
    { id: 'headline', label: 'Headline', type: 'line', required: true, placeholder: 'Senior Product Manager · Payments' },
    { id: 'bio', label: 'Bio', type: 'document', required: false, placeholder: 'Paste your profile bio…' },
    { id: 'skills', label: 'Skills', type: 'line', required: false, placeholder: 'Comma separated' },
    { id: 'discipline', label: 'Discipline', type: 'line', required: false, placeholder: 'Product' },
    { id: 'location', label: 'Location', type: 'line', required: false, placeholder: 'Austin, TX' },
  ],
  copy: {
    needsInput: 'Fill in at least a headline or a bio to see the result.',
    headline: '{grade} · {score}/100',
    'summaryMissing.one': '{n} field is empty or too thin to be useful.',
    'summaryMissing.other': '{n} fields are empty or too thin to be useful.',
    summaryComplete: 'Every checked field carries something.',
    present: 'Present',
    thin: 'Missing or thin',
    fillTitle: 'Fill in {field}',
    fillDetail: '{field} is one of the fields a visitor reads first, and yours is empty or too short to say anything.',
  },
  analyze: (values, c) => {
    const skills = text(values, 'skills').split(',').map((s) => s.trim()).filter(Boolean);
    const hasAnything = ['headline', 'bio', 'discipline', 'location'].some((id) => text(values, id)) || skills.length > 0;
    if (!hasAnything) return needsInput(c);
    const audit = auditProfile({
      headline: text(values, 'headline') || null,
      bio: text(values, 'bio') || null,
      skills,
      discipline: text(values, 'discipline') || null,
      location: text(values, 'location') || null,
    });
    return {
      headline: c('headline', { grade: grade(audit.score), score: audit.score }),
      summary: audit.missing.length
        ? counted(c, 'summaryMissing', audit.missing.length)
        : c('summaryComplete'),
      score: audit.score,
      scoreLabel: grade(audit.score),
      metrics: audit.checks.map((check) => ({
        label: check.field,
        value: check.ok ? c('present') : c('thin'),
        hint: check.detail,
        tier: check.ok ? 5 : 1,
      })),
      recommendations: [
        ...audit.missing.map((field) => ({
          title: c('fillTitle', { field }),
          detail: c('fillDetail', { field }),
          priority: 'high' as const,
        })),
        ...instructionRec(c, audit.instruction),
      ],
    };
  },
};

// ── 12. Career 360 ────────────────────────────────────────────────────────────

const career360: AnalyzerTool = {
  id: 'career-360',
  name: 'Career 360',
  tagline: 'Score yourself against a target role, then sequence the gaps.',
  icon: '🧭',
  category: 'career',
  kind: 'analyzer',
  about:
    'Reads your résumé against a target role and reports readiness signal by signal, then turns the gaps into dated legs. Leave the target blank and it proposes grounded ones instead — a next step, a stretch, and a pivot — each tied to something already on your résumé rather than invented.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
    {
      id: 'target', label: 'Target role', type: 'select', required: false,
      options: [{ value: '', label: 'Suggest targets for me' }, ...ROLE_PROFILES.map((r) => ({ value: r.id, label: r.title }))],
    },
  ],
  copy: {
    needsInput: 'Paste a résumé to see the result.',
    headlineClosest: 'Closest: {role}',
    headlineUnranked: 'No target ranked',
    summarySuggest: 'Every ranking below is computed from what your résumé EVIDENCES — a skill you have but never wrote down is invisible here, and the fix is to write it down. Pick a target and run this again for the plan.',
    suggestValue: '{readiness}% · {distance}',
    suggestMissing: 'Missing: {skills}',
    suggestComplete: 'Nothing missing',
    chooseTitle: 'Choose a target',
    chooseDetail: 'A target you are already qualified for produces an empty roadmap; one three levels up produces a roadmap you abandon. Pick from the “ready now” or “one gap away” rows and run this again.',
    unknownTarget: 'Unknown target role',
    availableTargets: 'Available targets',
    headlineReady: '{readiness}% ready for {role}',
    'summaryGaps.one': '{n} skill stands between you and {role}.',
    'summaryGaps.other': '{n} skills stand between you and {role}.',
    summaryNoGaps: 'Your résumé already evidences everything {role} asks for.',
    readiness: 'Readiness',
    readinessHint: '{family} · {level}',
    have: 'Already evidenced',
    haveEmpty: 'Nothing yet',
    missing: 'Still missing',
    missingEmpty: 'Nothing missing',
    stepTitle: '{horizon} — {title}',
    stepDetail: '{detail} Produces: {produces}.',
    'distance.ready_now': 'Ready now',
    'distance.one_gap_away': 'One gap away',
    'distance.a_season_away': 'A season away',
    'distance.a_genuine_change': 'A genuine change',
    'horizon.this_week': 'This week',
    'horizon.this_month': 'This month',
    'horizon.this_quarter': 'This quarter',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput(c);
    const targetId = text(values, 'target');

    if (!targetId) {
      const suggested = suggestTargets(resume);
      const best = suggested.suggestions[0];
      return {
        headline: best ? c('headlineClosest', { role: best.role.title }) : c('headlineUnranked'),
        summary: c('summarySuggest'),
        score: best ? best.readiness : null,
        scoreLabel: best ? c(enumSlug('distance', best.distance)) : null,
        metrics: suggested.suggestions.map((s) => ({
          label: s.role.title,
          value: c('suggestValue', { readiness: s.readiness, distance: c(enumSlug('distance', s.distance)) }),
          hint: s.missing.length ? c('suggestMissing', { skills: s.missing.slice(0, 5).join(', ') }) : c('suggestComplete'),
          tier: tier(s.readiness),
        })),
        recommendations: [{
          title: c('chooseTitle'),
          detail: c('chooseDetail'),
          priority: 'high',
        }],
      };
    }

    const plan = planForTarget(resume, targetId);
    if ('error' in plan) {
      return {
        headline: c('unknownTarget'),
        summary: plan.error,
        score: null,
        scoreLabel: null,
        metrics: [listMetric(c, c('availableTargets'), plan.availableTargets, c('none'))],
        recommendations: [],
      };
    }
    return {
      headline: c('headlineReady', { readiness: plan.readiness, role: plan.target.title }),
      summary: plan.missing.length
        ? counted(c, 'summaryGaps', plan.missing.length, { role: plan.target.title })
        : c('summaryNoGaps', { role: plan.target.title }),
      score: plan.readiness,
      scoreLabel: plan.target.title,
      metrics: [
        pctMetric(c, c('readiness'), plan.readiness, c('readinessHint', { family: plan.target.family, level: plan.target.level })),
        listMetric(c, c('have'), plan.have, c('haveEmpty')),
        listMetric(c, c('missing'), plan.missing, c('missingEmpty')),
      ],
      recommendations: [
        ...plan.steps.map((step) => ({
          title: c('stepTitle', { horizon: c(enumSlug('horizon', step.horizon)), title: step.title }),
          detail: c('stepDetail', { detail: step.detail, produces: step.produces }),
          priority: (step.horizon === 'this week' ? 'high' : step.horizon === 'this month' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        })),
        ...instructionRec(c, plan.instruction),
      ],
    };
  },
};

// ── 13. Salary Calculator ─────────────────────────────────────────────────────

const salaryCalculator: AnalyzerTool = {
  id: 'salary-calculator',
  name: 'Salary Calculator',
  tagline: 'Model a band for a role and place your number inside it.',
  icon: '💰',
  category: 'career',
  kind: 'analyzer',
  about:
    'Models an annual base band from discipline, seniority, region and work mode, and shows every multiplier that produced it — so the number is one you can argue with rather than one you have to trust. Supply a current or offered figure and it places it in the band by percentile.',
  fields: [
    { id: 'discipline', label: 'Role or discipline', type: 'line', required: true, placeholder: 'Product Manager' },
    { id: 'seniority', label: 'Seniority', type: 'line', required: false, placeholder: 'senior' },
    { id: 'location', label: 'Location', type: 'line', required: false, placeholder: 'Austin, TX' },
    {
      id: 'workMode', label: 'Work mode', type: 'select', required: false,
      options: [
        { value: 'hybrid', label: 'Hybrid' },
        { value: 'remote', label: 'Remote' },
        { value: 'onsite', label: 'On site' },
      ],
    },
    { id: 'currentBase', label: 'Current or offered base', type: 'line', required: false, placeholder: 'Optional — e.g. 150000' },
  ],
  copy: {
    needsInput: 'Name a role or discipline to see the result.',
    money: '{currency} {amount}',
    summary: '{seniority} {discipline}, {region}, {workMode}. {basis}',
    low: 'Low (P25)',
    median: 'Median (P50)',
    high: 'High (P75)',
    yourFigure: 'Your figure',
    yourFigureValue: '{amount} · P{percentile}',
    assumptions: 'Assumptions',
    anchorTitle: 'Anchor at the upper quartile',
    anchorDetail: 'If you name a number first, {amount} is the anchor this band supports — not the median. Give a range whose bottom you would still accept.',
  },
  analyze: (values, c) => {
    const discipline = text(values, 'discipline');
    if (!discipline) return needsInput(c);
    const mode = text(values, 'workMode');
    const analysis = analyzeSalary({
      discipline,
      seniority: text(values, 'seniority') || undefined,
      location: text(values, 'location') || undefined,
      workMode: mode === 'remote' || mode === 'onsite' ? mode : 'hybrid',
      currentBase: num(values, 'currentBase'),
    });
    // Currency SYMBOL placement differs by language (`1 234 € ` in French,
    // `€1,234` in English), so the money template is copy and the digit grouping
    // is the reader's, not en-US's.
    const money = (n: number) => c('money', { currency: analysis.band.currency, amount: n.toLocaleString(c.locale) });
    return {
      headline: money(analysis.band.median),
      summary: c('summary', {
        seniority: analysis.seniority,
        discipline: analysis.discipline,
        region: analysis.region,
        workMode: c.option('workMode', analysis.workMode),
        basis: analysis.basis,
      }),
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric(c('low'), money(analysis.band.low)),
        countMetric(c('median'), money(analysis.band.median)),
        countMetric(c('high'), money(analysis.band.high)),
        ...(analysis.position
          ? [countMetric(c('yourFigure'), c('yourFigureValue', { amount: money(analysis.position.value), percentile: analysis.position.percentile }), analysis.position.verdict)]
          : []),
        listMetric(c, c('assumptions'), analysis.assumptions, c('none')),
      ],
      recommendations: [
        {
          title: c('anchorTitle'),
          detail: c('anchorDetail', { amount: money(analysis.band.high) }),
          priority: 'high',
        },
        ...instructionRec(c, analysis.instruction),
      ],
    };
  },
};

// ── 13b. Personal Runway ──────────────────────────────────────────────────────
//
// The one free tool in this catalogue that is not about a document.
//
// Fifteen of the sixteen entries around it read a resume, a posting or a market
// band -- all of them questions about the SEARCH. This is the question that decides
// how the search is run at all, and it is the one nobody puts in a tool because the
// inputs are embarrassing: how much money is left, and what leaves the account each
// month. Under about thirteen weeks, taking contract work while interviewing beats
// holding out for the right salaried role, and somebody who does not know which side
// of that line they are on spends the runway finding out.
//
// It leads with WEEKS rather than currency for the reason `application/career/runway.ts`
// argues: a balance is a number you can feel good about and a number of weeks is a
// decision. Nothing here is stored -- the compute is pure and the page is the free,
// no-login surface, which for this particular input is the whole point.

const personalRunway: AnalyzerTool = {
  id: 'personal-runway',
  name: 'Personal Runway',
  tagline: 'How many weeks does the money last, and what that means for the search.',
  icon: '⏳',
  category: 'career',
  kind: 'analyzer',
  about:
    'Projects your balance forward month by month from savings, monthly outgoings and any income still arriving, and reports the weeks remaining plus the pressure band the rest of a job search should be paced against. Every figure is one you supplied — nothing is estimated on your behalf, and nothing is stored.',
  fields: [
    { id: 'savings', label: 'Cash available now', type: 'line', required: true, placeholder: 'Savings, notice pay — anything already banked' },
    { id: 'monthlyExpenses', label: 'Monthly outgoings', type: 'line', required: true, placeholder: 'Everything that leaves in a normal month, incl. annual bills ÷ 12' },
    { id: 'monthlyIncome', label: 'Monthly income still arriving', type: 'line', required: false, placeholder: 'Optional — benefits, a partner’s contribution, residual income' },
    { id: 'currency', label: 'Currency', type: 'line', required: false, placeholder: 'GBP' },
  ],
  copy: {
    needsInput: 'Enter the cash you have now and what leaves the account each month to see the result.',
    money: '{currency} {amount}',
    headlineSolvent: 'The money is not running out',
    'headlineWeeks.one': '{n} week',
    'headlineWeeks.other': '{n} weeks',
    summarySolvent: 'Income covers the outgoings, so there is no cliff to plan against. Net position {amount} a month.',
    summaryBurn: 'Net burn {burn} a month against {savings}.',
    summaryCliff: 'The balance reaches zero in month {month}.',
    weeks: 'Weeks remaining',
    weeksHint: 'The number every other career decision is paced against.',
    months: 'Months remaining',
    burn: 'Net monthly burn',
    burnNone: 'None — income covers it',
    pressure: 'Pressure',
    pressureHint: 'Under about 13 weeks, contract work while interviewing usually beats holding out.',
    assumptions: 'Assumptions',
    bridgeTitle: 'Take the bridge work and keep interviewing',
    bridgeDetail: 'With {weeks} weeks left, a salaried role that starts in three months arrives after the balance does. Contract or part-time work that starts sooner buys the runway to hold out for the right permanent role instead of accepting the first one.',
    targetedTitle: 'Search for the right role, not any role',
    targetedDetail: 'The runway supports a targeted search. Spend the time on fewer, better-tailored applications — the reply rate on a tailored application is several times that of a volume one, and you can afford to find out which.',
    statementTitle: 'Check the outgoings against a real statement',
    statementDetail: 'The single most common error in this calculation is an under-stated monthly figure, because the annual bills are forgotten. Divide them by twelve and add them in before trusting the weeks above.',
    'pressure.none': 'None',
    'pressure.comfortable': 'Comfortable',
    'pressure.planning': 'Planning',
    'pressure.urgent': 'Urgent',
    'pressure.critical': 'Critical',
  },
  analyze: (values, c) => {
    const savings = num(values, 'savings');
    const monthlyExpenses = num(values, 'monthlyExpenses');
    if (savings === undefined || monthlyExpenses === undefined) return needsInput(c);

    const reading = computeRunway({
      savings,
      monthlyExpenses,
      monthlyIncome: num(values, 'monthlyIncome'),
      currency: text(values, 'currency') || undefined,
    });
    const amount = (n: number) => c('money', { currency: reading.currency, amount: Math.round(n).toLocaleString(c.locale) });
    const pressure = c(enumSlug('pressure', reading.pressure));

    // The bands are the domain's, restated ONLY as a tier for the shared meter. A
    // second set of thresholds here would let the page disagree with the same reading
    // taken through `hr.runway` or drawn on a canvas `runway` card.
    const PRESSURE_TIER: Record<string, number> = { none: 5, comfortable: 4, planning: 3, urgent: 2, critical: 1 };
    const cliff = reading.projection.find((month) => month.balance <= 0);
    // Two whole sentences joined, never one sentence assembled from fragments:
    // the cliff clause is optional, so it has to stand on its own.
    const burnSummary = [
      c('summaryBurn', { burn: amount(reading.netMonthlyBurn), savings: amount(savings) }),
      cliff ? c('summaryCliff', { month: cliff.month }) : '',
    ].filter(Boolean).join(' ');

    return {
      headline: reading.weeksRemaining === null
        ? c('headlineSolvent')
        : counted(c, 'headlineWeeks', reading.weeksRemaining),
      summary: reading.weeksRemaining === null
        ? c('summarySolvent', { amount: amount(-reading.netMonthlyBurn) })
        : burnSummary,
      score: reading.weeksRemaining === null ? null : Math.min(100, Math.round((reading.weeksRemaining / 52) * 100)),
      scoreLabel: pressure,
      metrics: [
        { label: c('weeks'), value: reading.weeksRemaining === null ? '—' : reading.weeksRemaining.toLocaleString(c.locale), hint: c('weeksHint'), tier: PRESSURE_TIER[reading.pressure] },
        countMetric(c('months'), reading.monthsRemaining === null ? '—' : reading.monthsRemaining.toLocaleString(c.locale)),
        countMetric(c('burn'), reading.netMonthlyBurn <= 0 ? c('burnNone') : amount(reading.netMonthlyBurn)),
        { label: c('pressure'), value: pressure, hint: c('pressureHint'), tier: PRESSURE_TIER[reading.pressure] },
        listMetric(c, c('assumptions'), reading.assumptions, c('none')),
      ],
      recommendations: [
        ...(reading.weeksRemaining !== null && reading.weeksRemaining < 13
          ? [{
            title: c('bridgeTitle'),
            detail: c('bridgeDetail', { weeks: reading.weeksRemaining }),
            priority: 'high' as const,
          }]
          : []),
        ...(reading.weeksRemaining !== null && reading.weeksRemaining >= 26
          ? [{
            title: c('targetedTitle'),
            detail: c('targetedDetail'),
            priority: 'medium' as const,
          }]
          : []),
        {
          title: c('statementTitle'),
          detail: c('statementDetail'),
          priority: 'medium' as const,
        },
        ...instructionRec(c, reading.instruction),
      ],
    };
  },
};

// ── 14. Employer Research ─────────────────────────────────────────────────────

const employerResearch: AnalyzerTool = {
  id: 'employer-research',
  name: 'Employer Research',
  tagline: 'The six questions to answer about a company before you apply.',
  icon: '🏢',
  category: 'career',
  kind: 'analyzer',
  about:
    'Builds the research brief for one company and role: what to find out, why each answer changes your decision, and exactly where to look for it. It ends on the question most candidates skip — the honest case against joining.',
  fields: [
    { id: 'company', label: 'Company', type: 'line', required: true, placeholder: 'Northwind' },
    { id: 'role', label: 'Role', type: 'line', required: false, placeholder: 'Senior Product Manager' },
  ],
  copy: {
    needsInput: 'Name a company to see the result.',
    'headline.one': '{n} question about {company}',
    'headline.other': '{n} questions about {company}',
    summary: 'Answer these before the first conversation — a specific, recent observation is the one thing in an interview that cannot be prepared generically.',
    questionLabel: 'Question {n}',
    detail: '{why} Where to look: {where}',
  },
  analyze: (values, c) => {
    const company = text(values, 'company');
    if (!company) return needsInput(c);
    const brief = employerResearchBrief(company, text(values, 'role') || undefined);
    return {
      headline: counted(c, 'headline', brief.questions.length, { company: brief.company }),
      summary: c('summary'),
      score: null,
      scoreLabel: null,
      metrics: brief.questions.map((q, i) => ({
        label: c('questionLabel', { n: i + 1 }),
        value: q.question,
        hint: q.whereToLook,
      })),
      recommendations: brief.questions.map((q) => ({
        title: q.question,
        detail: c('detail', { why: q.whyItMatters, where: q.whereToLook }),
        priority: 'medium' as const,
      })),
    };
  },
};

// ── 15. Vendor Sync ───────────────────────────────────────────────────────────

const vendorSync: AnalyzerTool = {
  id: 'vendor-sync',
  name: 'Profile Sync Blocks',
  tagline: 'Your résumé, cut into the blocks each profile site asks for.',
  icon: '🔁',
  category: 'career',
  kind: 'analyzer',
  about:
    'Turns one résumé into the field-shaped blocks the major profile sites ask for, so keeping four profiles current stops meaning writing the same thing four times in four different boxes. Nothing is posted anywhere — this produces the text and you paste it.',
  fields: [
    { id: 'resume', label: 'Résumé text', type: 'document', required: true, placeholder: 'Paste your résumé…' },
  ],
  copy: {
    needsInput: 'Paste a résumé to see the result.',
    headline: 'Blocks ready to paste',
    summary: 'Each block is capped at the length the corresponding field actually accepts.',
    headlineBlock: 'Headline (120 chars)',
    bioBlock: 'Short bio (300 chars)',
    skills: 'Skills list',
    skillsEmpty: 'None detected',
    achievements: 'Achievements available',
    sourceTitle: 'Keep one source of truth',
    sourceDetail: 'Edit the résumé, re-run this, and re-paste. Editing a profile site directly is how four profiles drift into four different people.',
  },
  analyze: (values, c) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput(c);
    const brief = summarizeResume(resume);
    const parsed = parseResume(resume);
    const headlineSource = brief.existingSummary ?? brief.brief.whatTheyDo;
    return {
      headline: c('headline'),
      summary: c('summary'),
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric(c('headlineBlock'), headlineSource.slice(0, 120)),
        countMetric(c('bioBlock'), headlineSource.slice(0, 300)),
        listMetric(c, c('skills'), brief.topSkills, c('skillsEmpty')),
        countMetric(c('achievements'), parsed.bullets.length),
      ],
      recommendations: [
        {
          title: c('sourceTitle'),
          detail: c('sourceDetail'),
          priority: 'medium',
        },
      ],
    };
  },
};

// ── 16. Interview Prep ────────────────────────────────────────────────────────

const interviewPrep: AnalyzerTool = {
  id: 'interview-prep',
  name: 'Interview Prep',
  tagline: 'The questions this posting will actually ask you, and the rubric behind each.',
  icon: '🎤',
  category: 'career',
  kind: 'analyzer',
  about:
    'Builds the question set one posting is likely to probe, each with why it is being asked of you specifically and what a strong answer has to contain. Add your résumé and it also names your exposed flank — the skills the posting wants that your document does not evidence, which is where an interview goes wrong.',
  fields: [
    { id: 'job', label: 'Job description', type: 'document', required: true, placeholder: 'Paste the posting…' },
    { id: 'resume', label: 'Résumé text', type: 'document', required: false, placeholder: 'Optional — add it to see which questions you are exposed on.' },
    { id: 'role', label: 'Role', type: 'line', required: false, placeholder: 'Senior Product Manager' },
    {
      id: 'type', label: 'Interview type', type: 'select', required: false,
      options: [
        { value: 'behavioral', label: 'Behavioural' },
        { value: 'technical', label: 'Technical' },
        { value: 'situational', label: 'Situational' },
        { value: 'leadership', label: 'Leadership' },
        { value: 'screening', label: 'Screening call' },
      ],
    },
  ],
  copy: {
    needsInput: 'Paste a job description to see the result.',
    'headline.one': '{n} question for {role}',
    'headline.other': '{n} questions for {role}',
    summaryRisk: 'Your exposed flank: {areas} — named in the posting, not evidenced on your résumé.',
    summaryCovered: 'Nothing the posting asks for is missing from your résumé.',
    type: 'Interview type',
    riskAreas: 'Risk areas',
    riskAreasEmpty: 'None — or add your résumé to find out',
    questionLabel: '{category} · {difficulty}',
    answerDetail: 'A strong answer contains: {points}.',
    'difficulty.warmup': 'Warm-up',
    'difficulty.core': 'Core',
    'difficulty.hard': 'Hard',
  },
  analyze: (values, c) => {
    const job = text(values, 'job');
    if (!job) return needsInput(c);
    const chosen = text(values, 'type');
    const type = (['behavioral', 'technical', 'situational', 'leadership', 'screening'] as const)
      .find((t) => t === chosen) ?? 'behavioral';
    const kit = buildInterviewKit({
      jobDescription: job,
      role: text(values, 'role') || undefined,
      type,
      resumeText: text(values, 'resume') || undefined,
    });
    return {
      headline: counted(c, 'headline', kit.questions.length, { role: kit.role }),
      summary: kit.riskAreas.length
        ? c('summaryRisk', { areas: kit.riskAreas.slice(0, 4).join(', ') })
        : c('summaryCovered'),
      score: null,
      scoreLabel: null,
      metrics: [
        // Read back through the FIELD's own option label rather than a private
        // copy of it: the result echoes a choice made in the form above it, and
        // two spellings of "Screening call" on one page is the drift this avoids.
        countMetric(c('type'), c.option('type', type)),
        listMetric(c, c('riskAreas'), kit.riskAreas, c('riskAreasEmpty')),
        ...kit.questions.map((q) => ({
          label: c('questionLabel', { category: q.category, difficulty: c(enumSlug('difficulty', q.difficulty)) }),
          value: q.question,
          hint: q.why,
        })),
      ],
      recommendations: [
        ...kit.questions.map((q) => ({
          title: q.question,
          detail: c('answerDetail', { points: q.lookFor.join('; ') }),
          priority: (q.difficulty === 'hard' ? 'high' : q.difficulty === 'core' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        })),
        ...instructionRec(c, kit.instruction),
      ],
    };
  },
};

/**
 * The career tools, in the order the hub shows them: measure first, then match,
 * then plan, then the market. Spread into `TOOLS` by `toolDefinitions.ts`.
 */
export const CAREER_TOOLS: readonly AnalyzerTool[] = [
  resumeScorer,
  resumeOptimizer,
  resumeTailor,
  jobResumeMatch,
  skillExtractor,
  toneCheck,
  summaryWriter,
  valuePropositionTool,
  resumeConsolidator,
  resumeParser,
  profileAudit,
  career360,
  salaryCalculator,
  personalRunway,
  employerResearch,
  interviewPrep,
  vendorSync,
];
