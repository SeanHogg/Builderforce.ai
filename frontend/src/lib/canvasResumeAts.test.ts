import { describe, expect, it } from 'vitest';
import { createResumeFamily, originalResumeRevision } from './canvasResume';
import { analyzeResumeAgainstJob, resumeTailorPrompt } from './canvasResumeAts';

describe('canvas résumé ATS analysis', () => {
  const document = {
    basics: { name: 'Ada Lovelace', summary: 'Software engineer building distributed systems.' },
    skills: [{ name: 'TypeScript', keywords: ['React', 'Node.js'] }],
  };

  it('reports explainable matched and missing job terms without treating schema keys as résumé content', () => {
    const result = analyzeResumeAgainstJob(document, 'Seeking a software engineer with TypeScript, React, Kubernetes, and mentoring expertise.');
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['software', 'engineer', 'typescript', 'react']));
    expect(result.missingKeywords).toEqual(expect.arrayContaining(['kubernetes', 'mentoring']));
    expect(result.resumeKeywords).not.toContain('basics');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });

  it('binds the canonical source and anti-fabrication rules into the Recruiter mutation contract', () => {
    const family = createResumeFamily({ title: 'Original', markdown: '# Ada', document, now: '2026-08-11T00:00:00.000Z', idFactory: () => 'original' });
    const revision = originalResumeRevision(family);
    const analysis = analyzeResumeAgainstJob(document, 'TypeScript engineer with Kubernetes experience and distributed systems expertise.');
    const prompt = resumeTailorPrompt(revision, 'TypeScript engineer with Kubernetes experience and distributed systems expertise.', analysis);
    expect(prompt).toContain('Do not invent employers, dates, credentials, skills, metrics');
    expect(prompt).toContain('canvas_update_object');
    expect(prompt).toContain('fields.resumeDocument');
    expect(prompt).toContain('"name": "Ada Lovelace"');
    expect(prompt).toContain('Kubernetes experience');
  });
});
