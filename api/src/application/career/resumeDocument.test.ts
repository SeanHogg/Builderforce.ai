import { describe, expect, it } from 'vitest';
import { resumeDocumentFromText, resumeDocumentIsThin } from '@builderforce/creation-canvas-contract';
import { jobDocumentFromText } from './jobDocument';
import { looksLikeBinaryText, stripResumeControlChars } from './resumeExtract';
import { inferYearsOfExperience, resumeSkillNames } from '../hiring/candidateResumeProjection';

const RESUME = `Dana Okafor
dana.okafor@example.com | +1 415 555 0132 | https://linkedin.com/in/danaokafor

Professional Summary
Staff engineer with a decade building payments infrastructure at scale.

Experience

Senior Platform Engineer
Northwind Payments
Jan 2019 - Present
- Cut settlement latency by 43% across 12 markets
- Led a team of 6 engineers through a zero-downtime ledger migration

Backend Engineer
Kestrel Systems
2016 - 2019
- Built the reconciliation service handling 4m transactions daily

Education

BSc Computer Science
University of Manchester
2012 - 2016

Skills
Python, PostgreSQL, Kubernetes, Terraform, Go
`;

describe('resumeDocumentFromText', () => {
  const document = resumeDocumentFromText(RESUME);

  it('reads the person out of the header rather than a contact line', () => {
    expect(document.basics?.name).toBe('Dana Okafor');
    expect(document.basics?.email).toBe('dana.okafor@example.com');
    // The LinkedIn URL is preferred over any other link.
    expect(document.basics?.url).toContain('linkedin.com');
  });

  it('keeps the summary section as the summary', () => {
    expect(document.basics?.summary).toContain('payments infrastructure');
  });

  it('groups experience into dated entries with their bullets', () => {
    expect(document.work).toHaveLength(2);
    const [current] = document.work!;
    expect(current!.startDate).toBe('2019-01');
    expect(current!.endDate).toBe('Present');
    expect(current!.highlights).toHaveLength(2);
    expect(current!.highlights?.[0]).toContain('settlement latency');
  });

  it('tells a job title from an employer by the words in it, not by line order', () => {
    const [current] = document.work!;
    expect(current!.position).toBe('Senior Platform Engineer');
    expect(current!.name).toBe('Northwind Payments');
  });

  it('reads education as its own section', () => {
    expect(document.education?.[0]?.institution).toBe('University of Manchester');
    expect(document.education?.[0]?.studyType).toContain('BSc');
  });

  it('prefers the declared skills section over detected tokens', () => {
    const names = (document.skills ?? []).map((skill) => skill.name);
    expect(names).toContain('Python');
    expect(names).toContain('Kubernetes');
  });

  it('derives a headline when the résumé never states one', () => {
    expect(document.basics?.label).toBe('Senior Platform Engineer at Northwind Payments');
  });

  it('never throws on junk, and reports the result as thin', () => {
    const empty = resumeDocumentFromText('   ');
    expect(empty.basics).toBeDefined();
    expect(resumeDocumentIsThin(empty)).toBe(true);
    expect(resumeDocumentIsThin(document)).toBe(false);
  });
});

describe('resumeExtract guards', () => {
  it('detects raw container bytes read as text', () => {
    expect(looksLikeBinaryText('%PDF-1.7 ...')).toBe(true);
    expect(looksLikeBinaryText('PK')).toBe(true);
    expect(looksLikeBinaryText(`a${String.fromCharCode(0)}b`)).toBe(true);
    expect(looksLikeBinaryText(RESUME)).toBe(false);
  });

  it('strips control characters without touching tabs and newlines', () => {
    const cleaned = stripResumeControlChars(`a${String.fromCharCode(7)}b\tc\nd`);
    expect(cleaned).toBe('ab\tc\nd');
  });
});

describe('jobDocumentFromText', () => {
  const job = jobDocumentFromText(`Senior Platform Engineer
Company: Northwind Payments
Location: Manchester, UK
This is a hybrid role, full-time.

What you'll do
- Own the settlement pipeline
- Mentor two engineers

Requirements
- 5+ years with Python and PostgreSQL
- Experience running Kubernetes in production

Benefits
- Private healthcare
`);

  it('reads the labelled fields', () => {
    expect(job.title).toBe('Senior Platform Engineer');
    expect(job.company).toBe('Northwind Payments');
    expect(job.location).toBe('Manchester, UK');
  });

  it('prefers hybrid over remote when a posting says both', () => {
    expect(job.workMode).toBe('hybrid');
    expect(job.employmentType).toBe('full-time');
  });

  it('splits the three lists by their headings', () => {
    expect(job.responsibilities).toHaveLength(2);
    expect(job.requirements).toHaveLength(2);
    expect(job.benefits).toHaveLength(1);
    expect(job.requirements[0]).toContain('Python');
  });

  it('extracts skills through the shared lexicon', () => {
    expect(job.skills.length).toBeGreaterThan(0);
  });
});

describe('candidate résumé projection helpers', () => {
  const document = resumeDocumentFromText(RESUME);

  it('infers experience from the earliest dated role', () => {
    // Earliest start is 2016; measured against a fixed "now" so the test cannot rot.
    expect(inferYearsOfExperience(document, new Date('2026-01-01T00:00:00Z'))).toBe(10);
  });

  it('returns null rather than zero when nothing is dated', () => {
    expect(inferYearsOfExperience({ work: [{ name: 'X' }] })).toBeNull();
  });

  it('deduplicates skill names case-insensitively', () => {
    const names = resumeSkillNames({ skills: [{ name: 'Python' }, { name: 'python' }, { name: 'Go' }] });
    expect(names).toEqual(['Python', 'Go']);
  });
});
