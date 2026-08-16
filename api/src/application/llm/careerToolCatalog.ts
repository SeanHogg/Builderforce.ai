/**
 * The CAREER tool catalog — the `recruiter.*`, `hr.*`, `listing.*`, `jobs.*` and
 * `proposals.*` rows, spread into `builtinMcpService`'s `CATALOG`.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * PRD 18 §1.2 declared this catalog — twelve `recruiter.*` and thirteen `hr.*` tools,
 * described as "thin adapters over a ported service, not new logic". Measured
 * 2026-08-13, `CATALOG` held ~95 namespaces and ZERO rows in either, while the two
 * built-in agents those tools exist for (`recruiter`, `hr`, provisioned in
 * `provisionBuiltinAgents.ts`) shipped with bios, skill labels and no tools at all. An
 * agent told it "owns hiring end to end" and handed no hiring tool does not report the
 * absence — it improvises a limitation, the failure mode documented at length for
 * `canvas_add_image` in `packages/creation-canvas-contract/src/canvasTools.ts`.
 *
 * ── WHY THE SEEKER HALF IS HERE TOO ──────────────────────────────────────────────
 * The marketplace rows that already existed (`jobs.create`, `jobs.list_mine`,
 * `jobs.proposals`, `proposals.shortlist|evaluate|decline`) are ALL the hiring side of
 * the transaction. `jobRoutes.ts` has served public browse, apply-by-proposal,
 * `proposals/mine` and withdraw the whole time, with no tool in front of them — so an
 * agent on this platform could post a job and decline you, and could not find you a job
 * or apply on your behalf. `jobs.search`, `jobs.get`, `proposals.submit`,
 * `proposals.mine` and `proposals.withdraw` below are the missing half, and they replay
 * the existing routes rather than reaching past them into the tables.
 *
 * ── ONE LISTING, TWO KINDS OF DEMAND ─────────────────────────────────────────────
 * `listing.*` operates on the SAME `freelancer_profiles` row the "list my services"
 * flow already owns, now carrying career intent (migration 0462). There is no candidate
 * profile and no application table: `job_postings.postingType` already accepts `'fte'`
 * and `job_proposals` already runs submitted → shortlisted → accepted → declined →
 * withdrawn, so a job application IS a proposal on an FTE posting. See
 * `application/career/listing.ts` for the argument in full.
 *
 * ── TOOLS MEASURE; THE MODEL WRITES ──────────────────────────────────────────────
 * Every analytical row here returns counts, anchored evidence and an `instruction`, and
 * none of them generate prose. That is deliberate: on this platform the CALLER of an
 * MCP tool is itself a language model, so a tool that writes the paragraph is doing the
 * caller's job worse than the caller would, with none of the conversation context. It
 * also makes every number reproducible — a résumé score that comes out of a model moves
 * when you ask twice, and people rewrite their documents to chase it.
 */

import {
  analyzeSalary, auditProfile, buildCoachingPlan, buildInterviewKit, compareOffers,
  compareOptions, compareResumeToJob, computeRunway, consolidateResumes, draftListingFromResume,
  employerResearchBrief, extractSkills, listingReadiness, optimizeResume,
  planForTarget, profileBlocks, PROFILE_VENDORS, roastResume, ROLE_PROFILES, resumeSentiment,
  screenCandidate, scoreResume, suggestTargets, summarizeResume, tailorResume, valueProposition,
  normalizeSeeking, normalizeWorkMode, postingTypesFor,
  type CareerListing, type InterviewType, type OfferInput, type ProfileVendor, type SeekingMode,
  type WorkOption,
} from '../career';
import { parseResume } from '@builderforce/creation-canvas-contract';
import { replayRoute, type BuiltinCtx, type BuiltinTool } from './builtinToolContext';

type Json = Record<string, unknown>;

// --- tiny JSON-schema helpers (same shapes the main catalog uses) ------------
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const B = { type: 'boolean' } as const;
const SA = { type: 'array', items: S } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x).trim()).filter(Boolean) : [];

/**
 * Résumé text is the single most common argument in this catalog and the single most
 * common way a call fails: the caller passes an empty string because the person has not
 * uploaded anything yet. One guard, one message, naming what to do about it.
 */
function requireResume(value: unknown, argName = 'resumeText'): string {
  const text = str(value).trim();
  if (text.length < 40) {
    throw new Error(`\`${argName}\` is empty or too short to analyse. Ask the person to paste their résumé text (or read it from their listing with listing.get_mine), then call this again. Do not invent a résumé to analyse.`);
  }
  return text;
}

function requireText(value: unknown, argName: string, min = 20): string {
  const text = str(value).trim();
  if (text.length < min) throw new Error(`\`${argName}\` is required and must be the real text, not a summary of it.`);
  return text;
}

/** Project the API's `/api/freelancers/me` shape onto the domain's listing shape. */
function toCareerListing(row: Json): CareerListing {
  return {
    headline: row.headline == null ? null : str(row.headline),
    bio: row.bio == null ? null : str(row.bio),
    discipline: row.discipline == null ? null : str(row.discipline),
    skills: strArray(row.skills),
    hourlyRateCents: row.hourlyRateCents == null ? null : num(row.hourlyRateCents),
    currency: str(row.currency ?? 'USD'),
    availability: str(row.availability ?? 'open'),
    location: row.location == null ? null : str(row.location),
    timezone: row.timezone == null ? null : str(row.timezone),
    published: row.published === true,
    slug: row.slug == null ? null : str(row.slug),
    avatarKey: row.avatarUrl == null ? null : str(row.avatarUrl),
    // `/api/freelancers/me` returns the résumé as an object summary (0471); a listing
    // only needs to know one is attached and what it is called.
    resumeTitle: row.resume && typeof row.resume === 'object' && !Array.isArray(row.resume)
      ? str((row.resume as Json).title) || null
      : null,
    seeking: normalizeSeeking(row.seeking),
    targetRoles: strArray(row.targetRoles),
    seniority: row.seniority == null ? null : str(row.seniority),
    desiredSalaryMinCents: row.desiredSalaryMinCents == null ? null : num(row.desiredSalaryMinCents),
    desiredSalaryMaxCents: row.desiredSalaryMaxCents == null ? null : num(row.desiredSalaryMaxCents),
    workMode: normalizeWorkMode(row.workMode),
    noticePeriodDays: row.noticePeriodDays == null ? null : num(row.noticePeriodDays),
    openToRelocation: row.openToRelocation === true,
  };
}

/** Read the caller's own listing through the route that owns it. */
async function ownListing(ctx: BuiltinCtx): Promise<Json> {
  const row = await replayRoute(ctx, 'GET', '/api/freelancers/me');
  return (row ?? {}) as Json;
}

// ---------------------------------------------------------------------------
// The pure analytical rows — no tenant, no network, no clock
// ---------------------------------------------------------------------------

/**
 * Every tool below runs entirely on text the caller supplies, which is why the same
 * implementations serve an anonymous visitor through the guest surface. Their ids are
 * re-exported as {@link GUEST_SAFE_CAREER_TOOLS} so the guest boundary is derived from
 * this list rather than maintained as a second hand-written copy that can drift.
 */
const PURE_TOOLS: BuiltinTool[] = [
  {
    tool: 'recruiter.parse_resume',
    mutates: false,
    description: 'Parse résumé TEXT into structured data: sections, bullets (with whether each is quantified and how it opens), date ranges normalised to YYYY-MM, contact details, and every recognised skill. Call this first when you need to reason about a specific line of someone\'s résumé rather than the whole document. Accepts plain text, Markdown, or a PDF/Word text dump — it never rejects, it reports what it could read.',
    parameters: obj({ resumeText: S }, ['resumeText']),
    run: async (_ctx, a) => parseResume(requireResume(a.resumeText)),
  },
  {
    tool: 'recruiter.score_resume',
    mutates: false,
    description: 'Score a résumé 0–100 overall plus five categories (ATS readability, content depth, keyword coverage, formatting, impact language), with the COUNT behind each score, the strengths, the weaknesses and prioritised recommendations. Every number is a measurement over the document — not a model opinion — so it is stable across calls and the person can check it. Use this before offering any advice about a résumé.',
    parameters: obj({ resumeText: S }, ['resumeText']),
    run: async (_ctx, a) => scoreResume(requireResume(a.resumeText)),
  },
  {
    tool: 'recruiter.optimize_resume',
    mutates: false,
    description: 'Score a résumé and return the prioritised, ANCHORED edit list — each edit quotes the exact existing text it applies to, why it fails, and what a replacement must preserve. Pass jobDescription to also get the keywords that posting names and the résumé lacks. It deliberately does not write the replacement prose: you do that, in conversation with the person, because only they know what they actually did.',
    parameters: obj({ resumeText: S, jobDescription: S }, ['resumeText']),
    run: async (_ctx, a) => optimizeResume(requireResume(a.resumeText), str(a.jobDescription)),
  },
  {
    tool: 'recruiter.tailor_resume',
    mutates: false,
    description: 'Build the tailoring plan for one résumé against one job posting: the match score, every bullet ranked by how much of the posting\'s vocabulary it already carries, and the ordered moves (which bullet to lead with, which to quantify, which keyword to work in, which gap to declare honestly). After applying the moves, author the result as a canvas `resume` object so it can be edited and exported. Never add a skill the person has not confirmed — a tailored résumé that overstates is a trap they have to defend in the interview.',
    parameters: obj({ resumeText: S, jobDescription: S }, ['resumeText', 'jobDescription']),
    run: async (_ctx, a) => tailorResume(requireResume(a.resumeText), requireText(a.jobDescription, 'jobDescription', 60)),
  },
  {
    tool: 'recruiter.match_job',
    mutates: false,
    description: 'Score how well a résumé matches a job posting 0–100, with matched skills, missing skills, the posting\'s repeated context terms the résumé lacks, the transferable surplus, and per-area coverage. Use this to answer "is it worth me applying?" — and report the missing skills honestly rather than talking someone into or out of an application.',
    parameters: obj({ resumeText: S, jobDescription: S }, ['resumeText', 'jobDescription']),
    run: async (_ctx, a) => compareResumeToJob(requireResume(a.resumeText), requireText(a.jobDescription, 'jobDescription', 60)),
  },
  {
    tool: 'recruiter.roast_resume',
    mutates: false,
    description: 'The blunt critique: every hit QUOTES the person\'s real text and says what that line costs them, plus the strongest thing the document does. Use only when someone asks for honest or harsh feedback. Deliver it bluntly but without contempt, and never invent a flaw that is not in the returned hits.',
    parameters: obj({ resumeText: S }, ['resumeText']),
    run: async (_ctx, a) => roastResume(requireResume(a.resumeText)),
  },
  {
    tool: 'recruiter.summarize_resume',
    mutates: false,
    description: 'Assemble the evidence a recruiter-ready summary paragraph should be written from: the existing summary if there is one, the top skills by frequency, the years the dates span, and the strongest quantified bullets. Call this BEFORE proposing a new headline or summary so the words you write are anchored in what the document actually says.',
    parameters: obj({ resumeText: S }, ['resumeText']),
    run: async (_ctx, a) => summarizeResume(requireResume(a.resumeText)),
  },
  {
    tool: 'recruiter.resume_sentiment',
    mutates: false,
    description: 'Score the TONE of a résumé 0–100 (positive / neutral / negative) with the signal counts and the specific lines that read as passive or hedged. Use when someone worries their résumé reads as flat, apologetic, or junior despite the substance being strong.',
    parameters: obj({ resumeText: S }, ['resumeText']),
    run: async (_ctx, a) => resumeSentiment(requireResume(a.resumeText)),
  },
  {
    tool: 'recruiter.consolidate_resumes',
    mutates: false,
    description: 'Merge two or more résumés into one master. Returns the near-duplicate bullets grouped so you can keep the strongest phrasing, and — the important half — every bullet that exists in only ONE source, which is exactly what a hand-merge silently loses. Nothing is discarded on your behalf.',
    parameters: obj({ resumeTexts: SA }, ['resumeTexts']),
    run: async (_ctx, a) => {
      const texts = strArray(a.resumeTexts).filter((t) => t.length >= 40);
      if (texts.length < 2) throw new Error('Pass at least two résumé texts to consolidate. With one, call recruiter.optimize_resume instead.');
      return consolidateResumes(texts);
    },
  },
  {
    tool: 'recruiter.extract_skills',
    mutates: false,
    description: 'Pull every distinct skill out of a résumé or a job description, grouped the way a skills section is written so the output is paste-ready. Also returns `unrecognisedTerms`: repeated words the lexicon does not know, which are usually the posting\'s domain vocabulary and are worth reading. Set source to "job" when extracting from a posting.',
    parameters: obj({ text: S, source: S }, ['text']),
    run: async (_ctx, a) => extractSkills(requireText(a.text, 'text', 40), str(a.source) === 'job' ? 'job' : 'resume'),
  },
  {
    tool: 'recruiter.interview_questions',
    mutates: false,
    description: 'Generate an interview question set derived from what the POSTING actually emphasises — not a canned list. Each question carries why it is being asked and the rubric a strong answer must satisfy. Pass resumeText as well and the hardest questions target the specific gap between that résumé and that posting, which is the part a candidate most needs rehearsed. type: behavioral | technical | situational | leadership | screening.',
    parameters: obj({ jobDescription: S, role: S, type: S, count: N, resumeText: S }, ['jobDescription']),
    run: async (_ctx, a) => buildInterviewKit({
      jobDescription: requireText(a.jobDescription, 'jobDescription', 60),
      role: str(a.role),
      type: (['behavioral', 'technical', 'situational', 'leadership', 'screening'].includes(str(a.type)) ? str(a.type) : 'behavioral') as InterviewType,
      count: a.count == null ? undefined : num(a.count),
      resumeText: str(a.resumeText) || undefined,
    }),
  },
  {
    tool: 'recruiter.screen_candidate',
    mutates: false,
    description: 'Screen a candidate\'s résumé against a posting\'s STATED acceptance criteria (one per line — the same field job postings already store). Returns a row per requirement with the evidence found or its absence, and a recommendation: advance | hold | reject | insufficient_criteria. With no criteria supplied it refuses to recommend rather than guessing. Judge only what the posting asked for: never infer seniority from graduation years, availability from location, or fit from anything unstated.',
    parameters: obj({ resumeText: S, jobDescription: S, requirements: S }, ['resumeText', 'jobDescription']),
    run: async (_ctx, a) => screenCandidate(
      requireResume(a.resumeText),
      requireText(a.jobDescription, 'jobDescription', 40),
      str(a.requirements),
    ),
  },
  {
    tool: 'recruiter.build_packet',
    mutates: false,
    description: 'Assemble the full candidate packet for one person against one posting in a single call: the summary evidence, the match, the screening verdict against stated criteria, and the interview kit aimed at the gap. Use this when preparing a hiring decision or a full application, instead of making four separate calls.',
    parameters: obj({ resumeText: S, jobDescription: S, requirements: S, role: S }, ['resumeText', 'jobDescription']),
    run: async (_ctx, a) => {
      const resumeText = requireResume(a.resumeText);
      const jobDescription = requireText(a.jobDescription, 'jobDescription', 60);
      return {
        summary: summarizeResume(resumeText),
        match: compareResumeToJob(resumeText, jobDescription),
        screening: screenCandidate(resumeText, jobDescription, str(a.requirements)),
        interview: buildInterviewKit({ jobDescription, role: str(a.role), resumeText }),
        instruction: 'Present the packet in this order: what they bring, how it matches, what the stated criteria say, and the questions that would resolve the remaining doubt. The screening verdict is a recommendation against stated criteria only — say so when reporting it.',
      };
    },
  },
  {
    tool: 'hr.coach',
    mutates: false,
    description: 'Turn a person\'s own résumé into interview rehearsal material: a STAR scaffold per strong bullet with the elements the bullet CANNOT supply listed as missing (rather than invented), plus the drills. Pass jobDescription to add the gap-answer drill. Coach one story at a time and never write the story for them — a story in your words collapses on the first follow-up, in the room, where you are not.',
    parameters: obj({ resumeText: S, jobDescription: S, focus: S }, ['resumeText']),
    run: async (_ctx, a) => buildCoachingPlan({
      resumeText: requireResume(a.resumeText),
      jobDescription: str(a.jobDescription) || undefined,
      focus: str(a.focus) || undefined,
    }),
  },
  {
    tool: 'hr.value_proposition',
    mutates: false,
    description: 'Position one person against one named company and role: what aligns with the stated need, the surplus that differentiates them, the gaps to raise before the interviewer does, and the four-part structure to write. Write it in the person\'s voice, under 120 words, using only the returned evidence — then ask them which sentence is not true.',
    parameters: obj({ resumeText: S, company: S, role: S, jobDescription: S }, ['resumeText', 'company', 'role']),
    run: async (_ctx, a) => valueProposition({
      resumeText: requireResume(a.resumeText),
      company: requireText(a.company, 'company', 2),
      role: requireText(a.role, 'role', 2),
      jobDescription: str(a.jobDescription) || undefined,
    }),
  },
  {
    tool: 'hr.salary_analyze',
    mutates: false,
    description: 'Model an annual base-salary band for a discipline, seniority, region and work mode, and place a current or offered figure inside it. IMPORTANT: this is an inspectable MODEL (anchor × seniority × region × mode), not a salary survey — no market-data source is connected. It returns its own assumptions and basis; relay that honestly and never present the midpoint as "the market rate". For total compensation across offers, use hr.comp_analyze.',
    parameters: obj({ discipline: S, seniority: S, location: S, workMode: S, currency: S, currentBase: N }, ['discipline']),
    run: async (_ctx, a) => analyzeSalary({
      discipline: requireText(a.discipline, 'discipline', 2),
      seniority: str(a.seniority) || undefined,
      location: str(a.location) || undefined,
      workMode: (normalizeWorkMode(a.workMode) ?? undefined),
      currency: str(a.currency) || undefined,
      currentBase: a.currentBase == null ? undefined : num(a.currentBase),
    }),
  },
  {
    tool: 'hr.comp_analyze',
    mutates: false,
    description: 'Compare offers on TOTAL effective compensation — base, bonus, equity amortised over its vest, employer retirement contribution and benefits, MINUS the annual cost of taking the job (commute, relocation, parking), with a per-working-day rate. This is arithmetic on the person\'s own numbers, so unlike the salary band it is not a model. Always read back `notCounted`: tax, equity risk and currency conversion routinely reverse the ranking.',
    parameters: obj({
      offers: {
        type: 'array',
        items: obj({
          label: S, currency: S, base: N, bonusAnnual: N, equityTotal: N, equityVestYears: N,
          retirementAnnual: N, benefitsAnnual: N, costsAnnual: N, paidDaysOff: N, notes: S,
        }, ['label', 'base']),
      },
    }, ['offers']),
    run: async (_ctx, a) => {
      const raw = Array.isArray(a.offers) ? (a.offers as Json[]) : [];
      if (!raw.length) throw new Error('Pass at least one offer. Each needs a `label` and a `base`; every other field is optional but changes the answer.');
      const offers: OfferInput[] = raw.map((o) => ({
        label: str(o.label) || 'Offer',
        currency: str(o.currency) || undefined,
        base: num(o.base) || 0,
        bonusAnnual: o.bonusAnnual == null ? undefined : num(o.bonusAnnual),
        equityTotal: o.equityTotal == null ? undefined : num(o.equityTotal),
        equityVestYears: o.equityVestYears == null ? undefined : num(o.equityVestYears),
        retirementAnnual: o.retirementAnnual == null ? undefined : num(o.retirementAnnual),
        benefitsAnnual: o.benefitsAnnual == null ? undefined : num(o.benefitsAnnual),
        costsAnnual: o.costsAnnual == null ? undefined : num(o.costsAnnual),
        paidDaysOff: o.paidDaysOff == null ? undefined : num(o.paidDaysOff),
        notes: str(o.notes) || undefined,
      }));
      return compareOffers(offers);
    },
  },
  {
    tool: 'hr.career360_suggest_targets',
    mutates: false,
    description: 'Career 360, step one: rank the declared destination roles by what this person\'s résumé can already EVIDENCE, returning readiness, the skills they have, the ones they lack, and how far the move is (ready now / one gap away / a season away / a genuine change). Say plainly that the ranking reads the résumé, so a skill they have but never wrote down is invisible here — and the fix for that is to write it down.',
    parameters: obj({ resumeText: S, limit: N }, ['resumeText']),
    run: async (_ctx, a) => suggestTargets(requireResume(a.resumeText), a.limit == null ? 6 : num(a.limit)),
  },
  {
    tool: 'hr.career360_select_target',
    mutates: false,
    description: 'Career 360, step two: the gap-closing plan for ONE chosen destination. Each step names the artifact that closes it — a résumé revision, a practice set, a portfolio build, a listing update, applications — so the plan can be BUILT rather than described. Pass a targetId from hr.career360_suggest_targets (or hr.career360_state to see the catalogue).',
    parameters: obj({ resumeText: S, targetId: S }, ['resumeText', 'targetId']),
    run: async (_ctx, a) => planForTarget(requireResume(a.resumeText), requireText(a.targetId, 'targetId', 2)),
  },
  {
    tool: 'hr.employer_research',
    mutates: false,
    description: 'The brief for researching an employer: the six questions that change a decision, why each matters, and where to look. It returns QUESTIONS rather than answers on purpose — this tool has no data source, and a confident paragraph about a company assembled from memory is one the person repeats in an interview to someone who works there. Answer them by calling the web search and page-read tools, and cite what you actually read.',
    parameters: obj({ company: S, role: S }, ['company']),
    run: async (_ctx, a) => employerResearchBrief(requireText(a.company, 'company', 2), str(a.role) || undefined),
  },
  {
    tool: 'hr.runway',
    mutates: false,
    description: 'Personal runway: how many WEEKS the money lasts given savings, monthly expenses, any income still arriving, and one-off inflows/outflows on known months. Returns the month-by-month projection, the net burn and a pressure band. This is the number that governs every other career decision — under about 13 weeks, taking contract work while interviewing usually beats holding out. Lead with the weeks, not the currency.',
    parameters: obj({
      savings: N, monthlyExpenses: N, monthlyIncome: N, currency: S,
      expectedInflows: { type: 'array', items: obj({ label: S, amount: N, inMonths: N }, ['label', 'amount', 'inMonths']) },
      expectedOutflows: { type: 'array', items: obj({ label: S, amount: N, inMonths: N }, ['label', 'amount', 'inMonths']) },
    }, ['savings', 'monthlyExpenses']),
    run: async (_ctx, a) => {
      const flows = (v: unknown): Array<{ label: string; amount: number; inMonths: number }> =>
        Array.isArray(v) ? (v as Json[]).map((f) => ({ label: str(f.label), amount: num(f.amount) || 0, inMonths: Math.max(1, Math.round(num(f.inMonths) || 1)) })) : [];
      return computeRunway({
        savings: num(a.savings) || 0,
        monthlyExpenses: num(a.monthlyExpenses) || 0,
        monthlyIncome: a.monthlyIncome == null ? undefined : num(a.monthlyIncome),
        currency: str(a.currency) || undefined,
        expectedInflows: flows(a.expectedInflows),
        expectedOutflows: flows(a.expectedOutflows),
      });
    },
  },
  {
    tool: 'hr.compare_work_options',
    mutates: false,
    description: 'Answer "do I take the contract now, or hold out for the salaried role?" by converting both into WEEKS OF RUNWAY. Each option carries what it pays monthly, when the first payment actually lands, how long it lasts, and how much of the job search it consumes. The comparison people get wrong is not the rate — it is the start date: a bigger number arriving after the balance hits zero is worth nothing.',
    parameters: obj({
      savings: N, monthlyExpenses: N, monthlyIncome: N, currency: S,
      options: {
        type: 'array',
        items: obj({ label: S, kind: S, monthlyAmount: N, startsInMonths: N, durationMonths: N, searchTimeCost: N, notes: S }, ['label', 'kind', 'monthlyAmount', 'startsInMonths']),
      },
    }, ['savings', 'monthlyExpenses', 'options']),
    run: async (_ctx, a) => {
      const raw = Array.isArray(a.options) ? (a.options as Json[]) : [];
      if (!raw.length) throw new Error('Pass at least one work option. Each needs a label, kind ("services" or "employment"), a monthly amount and when the first payment lands.');
      const options: WorkOption[] = raw.map((o) => ({
        label: str(o.label) || 'Option',
        kind: str(o.kind) === 'employment' ? 'employment' : 'services',
        monthlyAmount: num(o.monthlyAmount) || 0,
        startsInMonths: Math.max(0, num(o.startsInMonths) || 0),
        durationMonths: o.durationMonths == null ? undefined : num(o.durationMonths),
        searchTimeCost: o.searchTimeCost == null ? undefined : num(o.searchTimeCost),
        notes: str(o.notes) || undefined,
      }));
      return compareOptions({
        savings: num(a.savings) || 0,
        monthlyExpenses: num(a.monthlyExpenses) || 0,
        monthlyIncome: a.monthlyIncome == null ? undefined : num(a.monthlyIncome),
        currency: str(a.currency) || undefined,
      }, options);
    },
  },
  {
    tool: 'listing.draft_from_resume',
    mutates: false,
    description: 'Draft a "list my services / hire me" listing from a résumé the person already has: the discipline, skills, seniority and target roles are DERIVED from the document, and the two prose fields (headline, bio) come back as briefs for you to write and them to approve. Use this so nobody out of work has to retype facts the platform already holds. Show the proposed fields and drafted words together and get approval before calling listing.update.',
    parameters: obj({ resumeText: S, seeking: S }, ['resumeText']),
    run: async (_ctx, a) => draftListingFromResume(requireResume(a.resumeText), normalizeSeeking(a.seeking ?? 'both')),
  },
  {
    tool: 'listing.profile_blocks',
    mutates: false,
    description: `Render one listing as paste-ready blocks for an external profile (${PROFILE_VENDORS.join(', ')}), respecting each vendor's headline and summary limits and flagging anything that had to be truncated. Pass the listing fields, or call listing.get_mine first. The value is not the copying — it is that all seven destinations keep saying the SAME thing, because a recruiter opens more than one.`,
    parameters: obj({
      vendor: S, headline: S, bio: S, skills: SA, seeking: S, workMode: S, targetRoles: SA,
    }, ['vendor']),
    run: async (_ctx, a) => {
      const vendor = str(a.vendor).toLowerCase() as ProfileVendor;
      if (!(PROFILE_VENDORS as readonly string[]).includes(vendor)) {
        throw new Error(`Unknown vendor "${str(a.vendor)}". Supported: ${PROFILE_VENDORS.join(', ')}.`);
      }
      return profileBlocks(toCareerListing(a), vendor);
    },
  },
  {
    tool: 'listing.readiness',
    mutates: false,
    description: 'Grade a listing SEPARATELY per demand channel — services and employment — because the two sides filter on different fields and a listing can be excellent for contract work and invisible to employers. Returns what is BLOCKING discovery on each channel and what would merely improve it. Fix everything blocking before anything improving: polishing a bio under a blocking item is wasted work.',
    parameters: obj({
      seeking: S, headline: S, bio: S, discipline: S, skills: SA, published: B, hourlyRateCents: N,
      location: S, timezone: S, avatarUrl: S, resumeTitle: S, targetRoles: SA, seniority: S,
      desiredSalaryMinCents: N, workMode: S, noticePeriodDays: N,
    }, ['seeking']),
    run: async (_ctx, a) => listingReadiness(toCareerListing(a)),
  },
];

// ---------------------------------------------------------------------------
// The tenant rows — they replay the routes that already own this data
// ---------------------------------------------------------------------------

const TENANT_TOOLS: BuiltinTool[] = [
  {
    tool: 'listing.get_mine',
    mutates: false,
    description: 'Read the signed-in person\'s own "list my services / hire me" listing, including their career intent (what they are seeking, target roles, seniority, salary expectation, work mode, notice period) and their marketplace stats. Call this before advising on their listing or drafting an application, so you are working from what is actually published rather than what they remember publishing.',
    parameters: obj({}),
    run: async (ctx) => ownListing(ctx),
  },
  {
    tool: 'listing.update',
    mutates: true,
    description: 'Update the signed-in person\'s listing. This is ONE listing serving two kinds of demand: set `seeking` to "services" (project/contract work), "employment" (full-time roles), "both", or "not_looking". The career fields — targetRoles, seniority, desiredSalaryMin/MaxCents, workMode ("remote"|"hybrid"|"onsite"), noticePeriodDays, openToRelocation — are what an employment search matches on; without them a strong profile never surfaces for a job. Send only the fields you are changing after the person has approved the exact wording of anything public.',
    parameters: obj({
      headline: S, bio: S, discipline: S, skills: SA, hourlyRateCents: N, currency: S,
      visibility: S, availability: S, published: B, location: S, timezone: S, slug: S, displayName: S,
      seeking: S, targetRoles: SA, seniority: S, desiredSalaryMinCents: N, desiredSalaryMaxCents: N,
      workMode: S, noticePeriodDays: N, openToRelocation: B,
    }),
    run: async (ctx, a) => {
      // PATCH /me replaces the row, so a partial patch would silently blank every field
      // the caller did not send. Read-merge-write against the live listing instead: an
      // agent asked to "set me to open for employment" must not erase the bio.
      const current = await ownListing(ctx);
      const merged: Json = {
        headline: current.headline ?? null, bio: current.bio ?? null, discipline: current.discipline ?? null,
        skills: strArray(current.skills), hourlyRateCents: current.hourlyRateCents ?? null,
        currency: current.currency ?? 'USD', visibility: current.visibility ?? 'private',
        availability: current.availability ?? 'open', published: current.published === true,
        location: current.location ?? null, timezone: current.timezone ?? null,
        seeking: current.seeking ?? 'services', targetRoles: strArray(current.targetRoles),
        seniority: current.seniority ?? null,
        desiredSalaryMinCents: current.desiredSalaryMinCents ?? null,
        desiredSalaryMaxCents: current.desiredSalaryMaxCents ?? null,
        workMode: current.workMode ?? null, noticePeriodDays: current.noticePeriodDays ?? null,
        openToRelocation: current.openToRelocation === true,
      };
      for (const [key, value] of Object.entries(a)) {
        if (value !== undefined && value !== null) merged[key] = value;
      }
      await replayRoute(ctx, 'PATCH', '/api/freelancers/me', merged);
      return { ok: true, listing: await ownListing(ctx) };
    },
  },
  {
    tool: 'listing.set_available_for_hire',
    mutates: true,
    description: 'Turn the "available for hire" opt-in on or off. This is the gate on the whole supply side: with it off the person cannot bid on a posting or apply to a role, and their listing is unpublished from browse (the profile itself is kept, not discarded). Turning it on also provisions their public profile. Confirm with the person before switching it off — it removes them from every search.',
    parameters: obj({ available: B }, ['available']),
    run: async (ctx, a) => replayRoute(ctx, 'POST', '/api/freelancers/me/availability', { available: a.available === true }),
  },
  {
    tool: 'listing.audit',
    mutates: false,
    description: 'Grade the signed-in person\'s live public listing 0–100 against the fields that actually drive discovery, with each check weighted and explained. Use it to answer "why is nobody contacting me?". For the per-channel view of what is blocking services versus employment discovery specifically, use listing.readiness.',
    parameters: obj({}),
    run: async (ctx) => {
      const row = await ownListing(ctx);
      const listing = toCareerListing(row);
      return {
        audit: auditProfile({
          headline: listing.headline, bio: listing.bio, skills: listing.skills,
          discipline: listing.discipline, hourlyRateCents: listing.hourlyRateCents,
          location: listing.location, timezone: listing.timezone, avatarKey: listing.avatarKey,
          slug: listing.slug, published: listing.published, availability: listing.availability,
          resumeTitle: listing.resumeTitle, seeking: listing.seeking, targetRoles: listing.targetRoles,
        }),
        readiness: listingReadiness(listing),
      };
    },
  },
  {
    tool: 'hr.career360_state',
    mutates: false,
    description: 'Career 360 state: the signed-in person\'s listing, the destinations they have declared as targets, and the full catalogue of destinations the planner can reason about. Call this to orient before suggesting targets, so the plan starts from what they have already said they want rather than from scratch.',
    parameters: obj({}),
    run: async (ctx) => {
      const row = await ownListing(ctx);
      const listing = toCareerListing(row);
      return {
        seeking: listing.seeking,
        declaredTargets: listing.targetRoles,
        seniority: listing.seniority,
        offeredPostingTypes: postingTypesFor(listing.seeking),
        availableTargets: ROLE_PROFILES.map((r) => ({ id: r.id, title: r.title, family: r.family, level: r.level })),
        instruction: 'If `declaredTargets` is empty, run hr.career360_suggest_targets over their résumé and offer the top results. If it is not, plan against what they already chose rather than re-litigating the choice.',
      };
    },
  },
  {
    tool: 'jobs.search',
    mutates: false,
    description: 'Search OPEN postings on the marketplace — both project/contract gigs and full-time roles (postingType "fte"). Filter by free text, discipline or skill. This is the demand side of "hire me": use it to find work for the person you are helping, then jobs.get for the detail and recruiter.match_job to decide whether applying is worth their afternoon.',
    parameters: obj({ q: S, discipline: S, skill: S }),
    run: async (ctx, a) => {
      const params = new URLSearchParams();
      if (str(a.q).trim()) params.set('q', str(a.q).trim().slice(0, 200));
      if (str(a.discipline).trim()) params.set('discipline', str(a.discipline).trim());
      if (str(a.skill).trim()) params.set('skill', str(a.skill).trim());
      const query = params.toString();
      // The unfiltered public slice is served from the shared read-through cache by the
      // route itself, so repeated agent searches cost one real query per fill.
      return replayRoute(ctx, 'GET', `/api/jobs${query ? `?${query}` : ''}`);
    },
  },
  {
    tool: 'jobs.get',
    mutates: false,
    description: 'Read one job posting in full — description, requirements, skills, rate range, posting type — plus whether the signed-in person has already applied to it (`myProposal`). Check that field before drafting an application: applying twice to the same posting is the most common self-inflicted wound in a job search.',
    parameters: obj({ jobId: S }, ['jobId']),
    run: async (ctx, a) => replayRoute(ctx, 'GET', `/api/jobs/${encodeURIComponent(requireText(a.jobId, 'jobId', 1))}`),
  },
  {
    tool: 'proposals.submit',
    mutates: true,
    description: 'Apply. Submits the signed-in person\'s proposal to a posting — a bid on a gig, or a job application on a full-time ("fte") posting: both are the same object on this platform, which is why the pipeline (submitted → shortlisted → accepted → declined) is the same too. Requires "available for hire" to be on. NEVER submit without showing the person the exact cover note first and getting explicit approval: this is outward-facing and it goes out under their name.',
    parameters: obj({ jobId: S, coverNote: S, rateCents: N }, ['jobId', 'coverNote']),
    run: async (ctx, a) => replayRoute(ctx, 'POST', `/api/jobs/${encodeURIComponent(requireText(a.jobId, 'jobId', 1))}/proposals`, {
      coverNote: requireText(a.coverNote, 'coverNote', 20),
      ...(a.rateCents == null ? {} : { rateCents: num(a.rateCents) }),
    }),
  },
  {
    tool: 'proposals.mine',
    mutates: false,
    description: 'List every proposal and application the signed-in person has submitted, with its current stage. THIS IS THE APPLICATION PIPELINE — the job search as one list instead of forty browser tabs. Use it to answer "where am I up to?", to spot what has gone quiet, and to decide what to follow up before sending anything new.',
    parameters: obj({}),
    run: async (ctx) => replayRoute(ctx, 'GET', '/api/jobs/proposals/mine'),
  },
  {
    tool: 'proposals.withdraw',
    mutates: true,
    description: 'Withdraw one of the signed-in person\'s own submitted proposals or applications. Confirm before calling: withdrawing is visible to the employer and cannot be undone by re-applying to the same posting.',
    parameters: obj({ proposalId: S }, ['proposalId']),
    run: async (ctx, a) => replayRoute(ctx, 'POST', `/api/jobs/proposals/${encodeURIComponent(requireText(a.proposalId, 'proposalId', 1))}/withdraw`, {}),
  },
  {
    tool: 'recruiter.source_candidates',
    mutates: false,
    description: 'Search the talent directory for people who have opted in to being hired, filtered by free text, discipline, skill or rate range. Each result carries their listing and reputation. Pair with recruiter.screen_candidate to evaluate a shortlist against a posting\'s stated criteria — and screen only on what the posting stated.',
    parameters: obj({ q: S, discipline: S, skill: S, minRate: N, maxRate: N, page: N, pageSize: N }),
    run: async (ctx, a) => {
      const params = new URLSearchParams();
      for (const key of ['q', 'discipline', 'skill', 'sort'] as const) {
        if (str(a[key]).trim()) params.set(key, str(a[key]).trim().slice(0, 200));
      }
      for (const key of ['minRate', 'maxRate', 'page', 'pageSize'] as const) {
        if (a[key] != null) params.set(key, String(num(a[key])));
      }
      const query = params.toString();
      return replayRoute(ctx, 'GET', `/api/freelancers${query ? `?${query}` : ''}`);
    },
  },
];

/** Every career row, spread into the builtin `CATALOG`. */
export const CAREER_TOOLS: BuiltinTool[] = [...PURE_TOOLS, ...TENANT_TOOLS];

/**
 * The career tools an ANONYMOUS visitor may run.
 *
 * Derived from `PURE_TOOLS` rather than hand-listed, because the property that makes a
 * tool guest-safe here is exactly the property that put it in that array: it runs on
 * text the caller supplies, reaches no tenant resource, no network and no clock. A tool
 * added to the tenant half can therefore never leak into the guest vocabulary by
 * someone forgetting to update a second list — the drift that
 * `packages/creation-canvas-contract/src/canvasTools.ts` exists to document.
 */
export const GUEST_SAFE_CAREER_TOOLS: readonly string[] = PURE_TOOLS.map((t) => t.tool);

/** Look up one guest-safe career tool's implementation by its dotted id. */
export function guestCareerTool(tool: string): BuiltinTool | undefined {
  return PURE_TOOLS.find((t) => t.tool === tool);
}

/** The seeking modes the listing tools accept — re-exported for the route layer. */
export type { SeekingMode };
