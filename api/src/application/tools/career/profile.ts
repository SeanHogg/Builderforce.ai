/**
 * Career analyzers about the PERSON'S PUBLIC PROFILE and direction — the profile
 * audit, Career 360 (readiness against a target role) and the profile-sync blocks.
 * Adapters only; every measurement is an `application/career` function (see the
 * header of `../careerTools.ts`).
 */
import { auditProfile, planForTarget, suggestTargets, summarizeResume, ROLE_PROFILES } from '../../career';
import { parseResume } from '@builderforce/creation-canvas-contract';
import { enumSlug } from '../analyzerCopy';
import type { AnalyzerTool } from '../toolTypes';
import {
  countMetric, counted, grade, instructionRec, listMetric, needsInput, pctMetric, text, tier,
} from './helpers';

// ── 11. Profile Audit ─────────────────────────────────────────────────────────

export const profileAudit: AnalyzerTool = {
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

export const career360: AnalyzerTool = {
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

// ── 15. Vendor Sync ───────────────────────────────────────────────────────────

export const vendorSync: AnalyzerTool = {
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
