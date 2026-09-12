/**
 * Career analyzers that read a résumé AGAINST ONE POSTING or one employer — the
 * tailoring plan, the match, the skills either document names, the value
 * proposition, the employer research brief and the interview kit. Adapters only;
 * every measurement is an `application/career` function (see the header of
 * `../careerTools.ts`).
 */
import {
  buildInterviewKit, compareResumeToJob, employerResearchBrief, extractSkills, tailorResume,
  valueProposition,
} from '../../career';
import { enumSlug } from '../analyzerCopy';
import type { AnalyzerTool } from '../toolTypes';
import {
  countMetric, counted, excerpt, instructionRec, listMetric, needsInput, pctMetric, text, verdictText,
} from './helpers';

// ── 3. Résumé Tailor ──────────────────────────────────────────────────────────

export const resumeTailor: AnalyzerTool = {
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

export const jobResumeMatch: AnalyzerTool = {
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

export const skillExtractor: AnalyzerTool = {
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

// ── 8. Value Proposition ──────────────────────────────────────────────────────

export const valuePropositionTool: AnalyzerTool = {
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

// ── 14. Employer Research ─────────────────────────────────────────────────────

export const employerResearch: AnalyzerTool = {
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

// ── 16. Interview Prep ────────────────────────────────────────────────────────

export const interviewPrep: AnalyzerTool = {
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
