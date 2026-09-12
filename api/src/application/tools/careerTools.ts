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
//
// ── WHERE THE TOOLS LIVE ─────────────────────────────────────────────────────────
// One module per domain under `./career/`: `resume` (one résumé as a document),
// `targeting` (a résumé against a posting or an employer), `profile` (the public
// profile and direction), `finance` (salary and runway), and `helpers` (the shared
// shaping). This file only assembles the catalogue, in the order the hub shows it.
import type { AnalyzerTool } from './toolTypes';
import { resumeConsolidator, resumeOptimizer, resumeParser, resumeScorer, summaryWriter, toneCheck } from './career/resume';
import {
  employerResearch, interviewPrep, jobResumeMatch, resumeTailor, skillExtractor, valuePropositionTool,
} from './career/targeting';
import { career360, profileAudit, vendorSync } from './career/profile';
import { personalRunway, salaryCalculator } from './career/finance';

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
