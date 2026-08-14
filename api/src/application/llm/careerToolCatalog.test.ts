import { describe, it, expect } from 'vitest';
import { GUEST_CAREER_TOOL_NAMES, GUEST_CANVAS_TOOL_NAMES } from '@builderforce/creation-canvas-contract';
import { CAREER_TOOLS, GUEST_SAFE_CAREER_TOOLS, guestCareerTool } from './careerToolCatalog';
import { advertisedName } from './toolNaming';

/**
 * The contract this file defends is the one `canvasTools.ts` was written about: two
 * hand-maintained lists of the same vocabulary drift, the model is handed a tool the
 * dispatcher will not run, and the failure is SILENT — the turn "succeeds" with the
 * model narrating a call it could not make.
 *
 * So: the guest contract and the guest-safe catalog half must agree exactly, every
 * guest-safe tool must actually be dispatchable, and no tool that needs a tenant may
 * appear in the anonymous vocabulary.
 */

describe('career tool catalog', () => {
  it('declares the PRD 18 §1.2 recruiter and hr namespaces', () => {
    const ids = new Set(CAREER_TOOLS.map((t) => t.tool));
    for (const required of [
      'recruiter.tailor_resume', 'recruiter.score_resume', 'recruiter.match_job',
      'recruiter.parse_resume', 'recruiter.optimize_resume', 'recruiter.roast_resume',
      'recruiter.extract_skills', 'recruiter.interview_questions', 'recruiter.screen_candidate',
      'recruiter.build_packet', 'recruiter.source_candidates',
      'hr.career360_suggest_targets', 'hr.career360_select_target', 'hr.career360_state',
      'hr.coach', 'hr.value_proposition', 'hr.salary_analyze', 'hr.comp_analyze',
    ]) {
      expect(ids.has(required), `PRD 18 §1.2 declares "${required}" and the catalog does not`).toBe(true);
    }
  });

  it('declares the SEEKER half of the marketplace, not only the hiring half', () => {
    // The asymmetry this closes: `jobs.create` / `proposals.decline` shipped, while the
    // routes for finding work and applying to it had no tool at all.
    const ids = new Set(CAREER_TOOLS.map((t) => t.tool));
    for (const required of ['jobs.search', 'jobs.get', 'proposals.submit', 'proposals.mine', 'proposals.withdraw']) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it('has a unique id, a real description and a schema for every row', () => {
    const seen = new Set<string>();
    for (const tool of CAREER_TOOLS) {
      expect(seen.has(tool.tool), `duplicate tool id "${tool.tool}"`).toBe(false);
      seen.add(tool.tool);
      expect(tool.tool).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
      expect(tool.description.length, `${tool.tool} needs a description the model can act on`).toBeGreaterThan(80);
      expect(tool.parameters).toHaveProperty('type', 'object');
      expect(typeof tool.run).toBe('function');
    }
  });

  it('marks exactly the outward-facing tools as mutating', () => {
    const mutating = CAREER_TOOLS.filter((t) => t.mutates).map((t) => t.tool).sort();
    expect(mutating).toEqual([
      'listing.set_available_for_hire',
      'listing.update',
      'proposals.submit',
      'proposals.withdraw',
    ]);
  });
});

describe('the guest boundary', () => {
  it('advertises exactly what it will dispatch', () => {
    // The measured defect from the canvas contract, one domain over: the advertised set
    // being larger than the executable one fails silently.
    const advertised = [...GUEST_CAREER_TOOL_NAMES].sort();
    const executable = GUEST_SAFE_CAREER_TOOLS.map(advertisedName).sort();
    expect(advertised).toEqual(executable);
  });

  it('routes every advertised guest career name through the gateway filter', () => {
    for (const name of GUEST_CAREER_TOOL_NAMES) {
      expect(GUEST_CANVAS_TOOL_NAMES.has(name), `${name} is advertised but the gateway would strip it`).toBe(true);
    }
  });

  it('can resolve an implementation for every guest-safe id', () => {
    for (const id of GUEST_SAFE_CAREER_TOOLS) expect(guestCareerTool(id)).toBeTruthy();
  });

  it('never exposes a tool that needs a tenant', () => {
    // Anything that reads or writes a tenant resource replays an HTTP route; a pure tool
    // does not. This is the property, not a hand-kept list of exceptions.
    for (const id of GUEST_SAFE_CAREER_TOOLS) {
      expect(guestCareerTool(id)?.mutates, `${id} mutates and cannot be guest-safe`).toBe(false);
      expect(String(guestCareerTool(id)?.run)).not.toContain('replayRoute');
    }
  });

  it('runs a guest-safe tool with no context at all', async () => {
    // The guest route hands `undefined` as the context, which is only sound because
    // these functions never look at it. Prove it rather than assuming it.
    const score = guestCareerTool('recruiter.score_resume');
    const result = await score!.run(undefined as never, {
      resumeText: 'Jane Rivera\njane@example.com\n\nExperience\n- Led a migration of 14 services cutting latency 38%\n- Built a pipeline in Python on PostgreSQL\n\nSkills\nTypeScript, Python, PostgreSQL, AWS\n',
    });
    expect(result).toHaveProperty('overall');
    expect((result as { categories: unknown[] }).categories).toHaveLength(5);
  });

  it('refuses an empty résumé with a message that says what to do next', async () => {
    const score = guestCareerTool('recruiter.score_resume');
    await expect(score!.run(undefined as never, { resumeText: '' }))
      .rejects.toThrow(/paste their résumé|too short/i);
  });
});
