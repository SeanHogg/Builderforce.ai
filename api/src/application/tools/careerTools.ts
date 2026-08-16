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
 */
import {
  analyzeSalary, auditProfile, compareResumeToJob, consolidateResumes,
  buildInterviewKit, employerResearchBrief, extractSkills, optimizeResume, planForTarget,
  resumeSentiment, scoreResume, suggestTargets, summarizeResume, tailorResume,
  valueProposition, ROLE_PROFILES,
} from '../career';
import { parseResume } from '@builderforce/creation-canvas-contract';
import type { AnalyzerTool, ToolMetric, ToolRecommendation, ToolResult } from './toolTypes';

// ── shared shaping ────────────────────────────────────────────────────────────

/** 0..100 → the 1..5 tier the shared meter colours by. */
const tier = (pct: number): number =>
  pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= 60 ? 3 : pct >= 40 ? 2 : 1;

/** The letter people recognise from an ATS score, not an invented scale. */
const grade = (pct: number): string =>
  pct >= 93 ? 'A' : pct >= 90 ? 'A−' : pct >= 87 ? 'B+' : pct >= 83 ? 'B'
    : pct >= 80 ? 'B−' : pct >= 77 ? 'C+' : pct >= 73 ? 'C' : pct >= 70 ? 'C−'
      : pct >= 60 ? 'D' : 'F';

const pctMetric = (label: string, pct: number, hint?: string): ToolMetric =>
  ({ label, value: `${Math.round(pct)}%`, hint, tier: tier(pct) });

const countMetric = (label: string, value: number | string, hint?: string): ToolMetric =>
  ({ label, value: String(value), hint });

/** A list rendered into one metric, or an honest "none" rather than an empty row. */
const listMetric = (label: string, items: readonly string[], empty: string): ToolMetric =>
  ({ label, value: items.length ? items.slice(0, 12).join(', ') : empty, hint: items.length > 12 ? `+${items.length - 12} more` : undefined });

const text = (values: Record<string, string>, id: string): string => (values[id] ?? '').trim();

const num = (values: Record<string, string>, id: string): number | undefined => {
  const raw = text(values, id).replace(/[^0-9.]/g, '');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Every analyzer answers the same way when handed nothing. */
const needsInput = (what: string): ToolResult => ({
  headline: 'Nothing to read yet',
  summary: `Paste ${what} to see the result.`,
  score: null,
  scoreLabel: null,
  metrics: [],
  recommendations: [],
});

/** The instruction every career reading carries — the caller's next move. */
const instructionRec = (instruction: string): ToolRecommendation[] =>
  instruction ? [{ title: 'How to use this', detail: instruction, priority: 'low' }] : [];

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
  analyze: (values) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput('a résumé');
    const scored = scoreResume(resume);
    const m = scored.measured;
    return {
      headline: `${grade(scored.overall)} · ${scored.overall}/100`,
      summary: scored.strengths[0] ?? 'Scored against the five categories a screener filters on.',
      score: scored.overall,
      scoreLabel: grade(scored.overall),
      metrics: [
        ...scored.categories.map((c) => pctMetric(c.label, c.score, c.evidence)),
        countMetric('Bullets', `${m.quantifiedBullets} of ${m.bullets} quantified`, 'Numbers are what separate a claim from an achievement.'),
        countMetric('Openers', `${m.strongOpeners} strong · ${m.weakOpeners} weak`, 'A weak opener describes presence rather than contribution.'),
        countMetric('Length', `${m.words} words`),
        listMetric('Sections found', m.sections, 'No standard headings detected'),
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput('a résumé');
    const job = text(values, 'job');
    const opt = optimizeResume(resume, job || undefined);
    return {
      headline: `${opt.edits.length} edit${opt.edits.length === 1 ? '' : 's'} to make`,
      summary: job
        ? `Scored ${opt.score.overall}/100 against this posting, with ${opt.missingKeywords.length} keyword${opt.missingKeywords.length === 1 ? '' : 's'} missing.`
        : `Scored ${opt.score.overall}/100. Add a job description to also see the keywords it is missing.`,
      score: opt.score.overall,
      scoreLabel: grade(opt.score.overall),
      metrics: [
        ...opt.score.categories.map((c) => pctMetric(c.label, c.score, c.evidence)),
        ...(job ? [listMetric('Missing keywords', opt.missingKeywords, 'None — the posting is well covered')] : []),
      ],
      recommendations: [
        ...opt.edits.map((e) => ({
          title: `${e.kind.replace(/_/g, ' ')} — “${e.target.slice(0, 70)}${e.target.length > 70 ? '…' : ''}”`,
          detail: `${e.reason} ${e.requirement}`,
          priority: e.priority,
        })),
        ...instructionRec(opt.instruction),
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    const job = text(values, 'job');
    if (!resume || !job) return needsInput('both a résumé and a job description');
    const plan = tailorResume(resume, job);
    const top = plan.bulletRelevance.slice(0, 3);
    return {
      headline: `${plan.match.score}% match · ${plan.match.verdict}`,
      summary: plan.claimedButUnevidenced.length
        ? `${plan.claimedButUnevidenced.length} skill${plan.claimedButUnevidenced.length === 1 ? ' is' : 's are'} claimed but not demonstrated by any achievement.`
        : 'Every skill this posting asks for is evidenced by at least one achievement.',
      score: plan.match.score,
      scoreLabel: plan.match.verdict,
      metrics: [
        listMetric('Claimed but unevidenced', plan.claimedButUnevidenced, 'None — every claim has evidence'),
        listMetric('Lead with', top.map((b) => b.text.slice(0, 60)), 'No clearly relevant bullet found'),
        ...plan.match.byArea.map((a) => pctMetric(a.area, a.coverage, `${a.matched} of ${a.required} matched`)),
      ],
      recommendations: [
        ...plan.moves.map((mv) => ({
          title: `${mv.kind.replace(/_/g, ' ')} — “${mv.target.slice(0, 70)}${mv.target.length > 70 ? '…' : ''}”`,
          detail: `${mv.reason} ${mv.requirement}`,
          priority: mv.kind === 'declare_gap' ? ('medium' as const) : ('high' as const),
        })),
        ...instructionRec(plan.instruction),
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    const job = text(values, 'job');
    if (!resume || !job) return needsInput('both a résumé and a job description');
    const match = compareResumeToJob(resume, job);
    return {
      headline: `${match.score}% · ${match.verdict}`,
      summary: `${match.evidence.matchedSkillCount} of ${match.evidence.requiredSkillCount} required skills are on your résumé.`,
      score: match.score,
      scoreLabel: match.verdict,
      metrics: [
        ...match.byArea.map((a) => pctMetric(a.area, a.coverage, `${a.matched} of ${a.required} matched`)),
        listMetric('Matched', match.overlap.matched, 'None matched'),
        listMetric('Missing', match.overlap.missing, 'Nothing missing'),
        listMetric('Missing context terms', match.overlap.missingContext, 'None'),
        listMetric('Surplus you carry', match.overlap.surplus, 'None'),
      ],
      recommendations: [
        ...match.overlap.missing.slice(0, 6).map((skill) => ({
          title: `Add evidence for “${skill}”`,
          detail: `The posting names ${skill} and your résumé does not. If you have done it, say so in an achievement; if you have not, decide whether to address the gap directly.`,
          priority: 'high' as const,
        })),
        ...instructionRec(match.instruction),
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
  analyze: (values) => {
    const body = text(values, 'text');
    if (!body) return needsInput('a résumé or a job description');
    const source = text(values, 'source') === 'job' ? 'job' : 'resume';
    const found = extractSkills(body, source);
    return {
      headline: `${found.total} skill${found.total === 1 ? '' : 's'} found`,
      summary: found.unrecognisedTerms.length
        ? `${found.unrecognisedTerms.length} repeated term${found.unrecognisedTerms.length === 1 ? '' : 's'} were not in the lexicon — check whether they are domain vocabulary worth keeping.`
        : 'Every repeated term was recognised.',
      score: null,
      scoreLabel: null,
      metrics: [
        ...found.groups.map((g) => listMetric(g.group, g.skills, 'None')),
        listMetric('Unrecognised repeated terms', found.unrecognisedTerms, 'None'),
      ],
      recommendations: found.unrecognisedTerms.length
        ? [{
          title: 'Decide on the unrecognised terms',
          detail: `These repeat in the document but are not known skills: ${found.unrecognisedTerms.slice(0, 10).join(', ')}. Domain vocabulary belongs in your skills section; noise does not.`,
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput('a résumé');
    const tone = resumeSentiment(resume);
    return {
      headline: `${tone.score}/100 · reads as ${tone.label}`,
      summary: tone.flagged.length
        ? `${tone.flagged.length} line${tone.flagged.length === 1 ? '' : 's'} describe presence rather than contribution.`
        : 'No hedging or passive openers found.',
      score: tone.score,
      scoreLabel: tone.label,
      metrics: [
        pctMetric('Overall tone', tone.score),
        countMetric('Contribution signals', tone.positiveSignals),
        countMetric('Negative signals', tone.negativeSignals),
        countMetric('Hedges', tone.hedges, 'Words like "helped", "assisted", "involved in".'),
      ],
      recommendations: tone.flagged.map((f) => ({
        title: `Rewrite “${f.text.slice(0, 70)}${f.text.length > 70 ? '…' : ''}”`,
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput('a résumé');
    const brief = summarizeResume(resume);
    return {
      headline: brief.existingSummary ? 'You already have a summary' : 'No summary section found',
      summary: brief.brief.whatTheyDo,
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric('Years spanned', brief.yearsSpanned ?? 'Not derivable from the dates'),
        countMetric('Distinct skills', brief.brief.distinctSkills),
        listMetric('Top skills', brief.topSkills, 'None detected'),
        listMetric('Strongest evidence', brief.evidenceBullets.map((b) => b.slice(0, 80)), 'No quantified bullets found'),
        ...(brief.existingSummary ? [countMetric('Current summary', brief.existingSummary.slice(0, 160))] : []),
      ],
      recommendations: [
        { title: 'Write it from this', detail: brief.brief.instruction, priority: 'high' },
        ...(brief.brief.scaleEvidence.length
          ? [{ title: 'Lead with scale', detail: `These are the numbers worth putting in the first sentence: ${brief.brief.scaleEvidence.slice(0, 4).join(' · ')}`, priority: 'medium' as const }]
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    const company = text(values, 'company');
    const role = text(values, 'role');
    if (!resume || !company || !role) return needsInput('a résumé, a company and a role');
    const vp = valueProposition({ resumeText: resume, company, role, jobDescription: text(values, 'job') || undefined });
    return {
      headline: `${vp.role} at ${vp.company}`,
      summary: vp.aligned.length
        ? `${vp.aligned.length} of the things they asked for are already on your résumé.`
        : 'Add the job description to see what genuinely aligns.',
      score: null,
      scoreLabel: null,
      metrics: [
        listMetric('Aligned with their ask', vp.aligned, 'Nothing measured — no job description supplied'),
        listMetric('Your differentiators', vp.differentiators, 'None beyond what they asked for'),
        listMetric('Gaps to address', vp.toAddress, 'None'),
      ],
      recommendations: [
        ...vp.structure.map((s) => ({ title: s.part, detail: s.guidance, priority: 'high' as const })),
        ...instructionRec(vp.instruction),
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
  analyze: (values) => {
    const sources = ['a', 'b', 'c'].map((id) => text(values, id)).filter(Boolean);
    if (sources.length < 2) return needsInput('at least two résumés');
    const merged = consolidateResumes(sources);
    return {
      headline: `${merged.uniqueBullets.length} line${merged.uniqueBullets.length === 1 ? '' : 's'} exist in only one version`,
      summary: `Across ${merged.sourceCount} résumés, ${merged.duplicateGroups.length} achievement${merged.duplicateGroups.length === 1 ? ' appears' : 's appear'} in more than one.`,
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric('Sources compared', merged.sourceCount),
        countMetric('Overlapping achievements', merged.duplicateGroups.length),
        countMetric('Unique to one version', merged.uniqueBullets.length, 'These are what a hand-merge loses.'),
        listMetric('Merged skills', merged.mergedSkills, 'None detected'),
      ],
      recommendations: [
        ...merged.uniqueBullets.slice(0, 8).map((b) => ({
          title: 'Keep this line',
          detail: `“${b}” appears in only one of your résumés — decide deliberately whether the master keeps it.`,
          priority: 'high' as const,
        })),
        ...merged.duplicateGroups.slice(0, 5).map((g) => ({
          title: 'Pick one wording',
          detail: `“${g.canonical}” is written ${g.variants.length + 1} different ways. Choose the strongest and use it everywhere.`,
          priority: 'medium' as const,
        })),
        ...instructionRec(merged.instruction),
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput('a résumé');
    const parsed = parseResume(resume);
    const sections = parsed.sections.map((s) => s.kind);
    const quantified = parsed.bullets.filter((b) => b.quantified).length;
    return {
      headline: `${parsed.sections.length} section${parsed.sections.length === 1 ? '' : 's'}, ${parsed.bullets.length} bullet${parsed.bullets.length === 1 ? '' : 's'}`,
      summary: sections.length
        ? 'Anything missing from this list is something a screener may also fail to find.'
        : 'No standard sections were recognised — that is usually a formatting problem, not a content one.',
      score: null,
      scoreLabel: null,
      metrics: [
        listMetric('Sections recognised', sections, 'None'),
        countMetric('Bullets parsed', parsed.bullets.length),
        countMetric('Quantified bullets', `${quantified} of ${parsed.bullets.length}`),
        listMetric('Skills detected', parsed.skillTokens.slice(0, 20), 'None'),
      ],
      recommendations: sections.length
        ? []
        : [{
          title: 'Use standard section headings',
          detail: 'Write "Experience", "Education" and "Skills" as their own lines. Decorative or renamed headings are the single most common reason a parser returns nothing.',
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
  analyze: (values) => {
    const skills = text(values, 'skills').split(',').map((s) => s.trim()).filter(Boolean);
    const hasAnything = ['headline', 'bio', 'discipline', 'location'].some((id) => text(values, id)) || skills.length > 0;
    if (!hasAnything) return needsInput('at least a headline or a bio');
    const audit = auditProfile({
      headline: text(values, 'headline') || null,
      bio: text(values, 'bio') || null,
      skills,
      discipline: text(values, 'discipline') || null,
      location: text(values, 'location') || null,
    });
    return {
      headline: `${grade(audit.score)} · ${audit.score}/100`,
      summary: audit.missing.length
        ? `${audit.missing.length} field${audit.missing.length === 1 ? ' is' : 's are'} empty or too thin to be useful.`
        : 'Every checked field carries something.',
      score: audit.score,
      scoreLabel: grade(audit.score),
      metrics: audit.checks.map((c) => ({
        label: c.field,
        value: c.ok ? 'Present' : 'Missing or thin',
        hint: c.detail,
        tier: c.ok ? 5 : 1,
      })),
      recommendations: [
        ...audit.missing.map((field) => ({
          title: `Fill in ${field}`,
          detail: `${field} is one of the fields a visitor reads first, and yours is empty or too short to say anything.`,
          priority: 'high' as const,
        })),
        ...instructionRec(audit.instruction),
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput('a résumé');
    const targetId = text(values, 'target');

    if (!targetId) {
      const suggested = suggestTargets(resume);
      const best = suggested.suggestions[0];
      return {
        headline: best ? `Closest: ${best.role.title}` : 'No target ranked',
        summary: 'Every ranking below is computed from what your résumé EVIDENCES — a skill you have but never wrote down is invisible here, and the fix is to write it down. Pick a target and run this again for the plan.',
        score: best ? best.readiness : null,
        scoreLabel: best ? best.distance : null,
        metrics: suggested.suggestions.map((s) => ({
          label: s.role.title,
          value: `${s.readiness}% · ${s.distance}`,
          hint: s.missing.length ? `Missing: ${s.missing.slice(0, 5).join(', ')}` : 'Nothing missing',
          tier: tier(s.readiness),
        })),
        recommendations: [{
          title: 'Choose a target',
          detail: 'A target you are already qualified for produces an empty roadmap; one three levels up produces a roadmap you abandon. Pick from the "ready now" or "one gap away" rows and run this again.',
          priority: 'high',
        }],
      };
    }

    const plan = planForTarget(resume, targetId);
    if ('error' in plan) {
      return {
        headline: 'Unknown target role',
        summary: plan.error,
        score: null,
        scoreLabel: null,
        metrics: [listMetric('Available targets', plan.availableTargets, 'None')],
        recommendations: [],
      };
    }
    return {
      headline: `${plan.readiness}% ready for ${plan.target.title}`,
      summary: plan.missing.length
        ? `${plan.missing.length} skill${plan.missing.length === 1 ? '' : 's'} stand between you and ${plan.target.title}.`
        : `Your résumé already evidences everything ${plan.target.title} asks for.`,
      score: plan.readiness,
      scoreLabel: plan.target.title,
      metrics: [
        pctMetric('Readiness', plan.readiness, `${plan.target.family} · ${plan.target.level}`),
        listMetric('Already evidenced', plan.have, 'Nothing yet'),
        listMetric('Still missing', plan.missing, 'Nothing missing'),
      ],
      recommendations: [
        ...plan.steps.map((step) => ({
          title: `${step.horizon} — ${step.title}`,
          detail: `${step.detail} Produces: ${step.produces}.`,
          priority: (step.horizon === 'this week' ? 'high' : step.horizon === 'this month' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        })),
        ...instructionRec(plan.instruction),
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
  analyze: (values) => {
    const discipline = text(values, 'discipline');
    if (!discipline) return needsInput('a role or discipline');
    const mode = text(values, 'workMode');
    const analysis = analyzeSalary({
      discipline,
      seniority: text(values, 'seniority') || undefined,
      location: text(values, 'location') || undefined,
      workMode: mode === 'remote' || mode === 'onsite' ? mode : 'hybrid',
      currentBase: num(values, 'currentBase'),
    });
    const money = (n: number) => `${analysis.band.currency} ${n.toLocaleString()}`;
    return {
      headline: money(analysis.band.median),
      summary: `${analysis.seniority} ${analysis.discipline}, ${analysis.region}, ${analysis.workMode}. ${analysis.basis}`,
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric('Low (P25)', money(analysis.band.low)),
        countMetric('Median (P50)', money(analysis.band.median)),
        countMetric('High (P75)', money(analysis.band.high)),
        ...(analysis.position
          ? [countMetric('Your figure', `${money(analysis.position.value)} · P${analysis.position.percentile}`, analysis.position.verdict)]
          : []),
        listMetric('Assumptions', analysis.assumptions, 'None'),
      ],
      recommendations: [
        {
          title: 'Anchor at the upper quartile',
          detail: `If you name a number first, ${money(analysis.band.high)} is the anchor this band supports — not the median. Give a range whose bottom you would still accept.`,
          priority: 'high',
        },
        ...instructionRec(analysis.instruction),
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
  analyze: (values) => {
    const company = text(values, 'company');
    if (!company) return needsInput('a company name');
    const brief = employerResearchBrief(company, text(values, 'role') || undefined);
    return {
      headline: `${brief.questions.length} questions about ${brief.company}`,
      summary: 'Answer these before the first conversation — a specific, recent observation is the one thing in an interview that cannot be prepared generically.',
      score: null,
      scoreLabel: null,
      metrics: brief.questions.map((q, i) => ({
        label: `Question ${i + 1}`,
        value: q.question,
        hint: q.whereToLook,
      })),
      recommendations: brief.questions.map((q) => ({
        title: q.question,
        detail: `${q.whyItMatters} Where to look: ${q.whereToLook}`,
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
  analyze: (values) => {
    const resume = text(values, 'resume');
    if (!resume) return needsInput('a résumé');
    const brief = summarizeResume(resume);
    const parsed = parseResume(resume);
    const headlineSource = brief.existingSummary ?? brief.brief.whatTheyDo;
    return {
      headline: 'Blocks ready to paste',
      summary: 'Each block is capped at the length the corresponding field actually accepts.',
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric('Headline (120 chars)', headlineSource.slice(0, 120)),
        countMetric('Short bio (300 chars)', headlineSource.slice(0, 300)),
        listMetric('Skills list', brief.topSkills, 'None detected'),
        countMetric('Achievements available', parsed.bullets.length),
      ],
      recommendations: [
        {
          title: 'Keep one source of truth',
          detail: 'Edit the résumé, re-run this, and re-paste. Editing a profile site directly is how four profiles drift into four different people.',
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
  analyze: (values) => {
    const job = text(values, 'job');
    if (!job) return needsInput('a job description');
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
      headline: `${kit.questions.length} questions for ${kit.role}`,
      summary: kit.riskAreas.length
        ? `Your exposed flank: ${kit.riskAreas.slice(0, 4).join(', ')} — named in the posting, not evidenced on your résumé.`
        : 'Nothing the posting asks for is missing from your résumé.',
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric('Interview type', type),
        listMetric('Risk areas', kit.riskAreas, 'None — or add your résumé to find out'),
        ...kit.questions.map((q) => ({
          label: `${q.category} · ${q.difficulty}`,
          value: q.question,
          hint: q.why,
        })),
      ],
      recommendations: [
        ...kit.questions.map((q) => ({
          title: q.question,
          detail: `A strong answer contains: ${q.lookFor.join('; ')}.`,
          priority: (q.difficulty === 'hard' ? 'high' : q.difficulty === 'core' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        })),
        ...instructionRec(kit.instruction),
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
  employerResearch,
  interviewPrep,
  vendorSync,
];
