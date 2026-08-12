import type { CanvasResumeDocument, CanvasResumeRevision } from './canvasResume';

export interface ResumeAtsAnalysis {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  resumeKeywords: string[];
  jobKeywords: string[];
}

const STOP_WORDS = new Set('a an and are as at be by for from has have in into is it its of on or our that the their this to with will you your years year experience required preferred responsibilities qualifications ability role team work working'.split(' '));

function keywords(text: string): string[] {
  const phrases = [...text.matchAll(/\b(?:[A-Z][A-Za-z0-9+#.-]*)(?:\s+[A-Z][A-Za-z0-9+#.-]*){1,2}\b/g)].map((match) => match[0].toLowerCase());
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  return [...new Set([...phrases, ...tokens].map((value) => value.replace(/^[.-]+|[.-]+$/g, '')).filter((value) => value && !STOP_WORDS.has(value)))];
}

function documentText(document: CanvasResumeDocument): string {
  const values: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string' || typeof value === 'number') values.push(String(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(document);
  return values.join('\n');
}

/** Explainable ATS keyword coverage; no invented qualifications and no opaque score. */
export function analyzeResumeAgainstJob(document: CanvasResumeDocument, jobDescription: string): ResumeAtsAnalysis {
  const resumeKeywords = keywords(documentText(document));
  const jobKeywords = keywords(jobDescription).slice(0, 80);
  const resumeSet = new Set(resumeKeywords);
  const matchedKeywords = jobKeywords.filter((keyword) => resumeSet.has(keyword) || [...resumeSet].some((candidate) => candidate.includes(keyword) || keyword.includes(candidate)));
  const matched = new Set(matchedKeywords);
  const missingKeywords = jobKeywords.filter((keyword) => !matched.has(keyword));
  const score = jobKeywords.length ? Math.round((matchedKeywords.length / jobKeywords.length) * 100) : 0;
  return { score, matchedKeywords, missingKeywords, resumeKeywords, jobKeywords };
}

/** Recruiter prompt whose required output matches Canvas's protected resumeDocument mutation contract. */
export function resumeTailorPrompt(revision: CanvasResumeRevision, jobDescription: string, analysis: ResumeAtsAnalysis): string {
  return `Act as the Recruiter. Tailor the selected résumé "${revision.title}" for the job description below.

NON-NEGOTIABLE:
- Preserve factual accuracy. Do not invent employers, dates, credentials, skills, metrics, responsibilities, or achievements.
- Use the selected résumé's canonical document as the only candidate evidence.
- Improve wording and ordering for the target role, but retain unsupported missing keywords as gaps rather than adding them.
- Call canvas_update_object on the selected resume object with fields.resumeDocument containing the COMPLETE tailored JSON Resume document. Canvas will create a derived version and protect Original automatically.
- Set fields.title to a concise target-role version name.

Current deterministic ATS coverage: ${analysis.score}%.
Matched terms: ${analysis.matchedKeywords.join(', ') || 'none'}.
Unsupported/missing terms: ${analysis.missingKeywords.join(', ') || 'none'}.

CANONICAL SOURCE RÉSUMÉ JSON:
${JSON.stringify(revision.document ?? {}, null, 2).slice(0, 30_000)}

JOB DESCRIPTION:
${jobDescription.trim().slice(0, 12_000)}`;
}
