import { createTranslator } from 'next-intl';
import { defaultMessages } from '@/i18n/catalog';
import { practiceProgress, type CanvasPracticeAttempt, type CanvasPracticeQuestion } from './canvasPractice';

export const COURSE_SCHEMA = 'https://builderforce.ai/schemas/course/v1' as const;
export const COURSE_EXPORT_STANDARDS = ['SCORM 2004 4th Edition', 'xAPI 1.0.3'] as const;

export type CourseLesson = {
  id: string;
  title: string;
  objective: string;
  content: string;
  activity: string;
  durationMinutes: number;
};

export type CourseModule = {
  id: string;
  title: string;
  description: string;
  lessons: CourseLesson[];
  assessment: { question: string; choices: string[]; answer: number; explanation: string };
};

export type CanvasCourse = {
  schema: typeof COURSE_SCHEMA;
  version: string;
  language: string;
  /** What this course is ABOUT, in the learner's words. A course object is
   * created empty and carrying only this, which is what makes "Course" a thing
   * you can point at photosynthesis rather than a fixed curriculum. */
  subject: string;
  audience: string;
  description: string;
  estimatedMinutes: number;
  passingScore: number;
  modules: CourseModule[];
  completedLessonIds: string[];
};

const lesson = (id: string, title: string, objective: string, content: string, activity: string, durationMinutes = 20): CourseLesson => ({
  id, title, objective, content, activity, durationMinutes,
});

/**
 * The translator the worked course is minted through: a key under the canvas's
 * `creationCanvas` namespace in, a string out. The canvas passes its own board
 * translator (`canvasText`), which is the same seam every other persisted default
 * title on the board is minted through — so the course lands in the BOARD's
 * language and stays there after every later edit, exactly like its title does.
 */
export type CourseTextTranslator = (key: string) => string;

/**
 * The worked LLM course's STRUCTURE — module ids, lesson ids, which choice is
 * correct. Its copy is catalog data under `creationCanvas.llmCourse.*`, in five
 * languages, and nowhere in this file: the course is persisted into the board the
 * moment it is created, so an English literal here was English on every zh, es,
 * fr and de board that ever asked for it.
 */
const LLM_COURSE_SHAPE = [
  { id: 'foundations', lessons: ['foundations-outcome', 'foundations-scale'], answer: 1 },
  { id: 'data', lessons: ['data-corpus', 'data-pipeline'], answer: 1 },
  { id: 'tokenizer', lessons: ['tokenizer-train', 'architecture-budget'], answer: 0 },
  { id: 'training', lessons: ['training-run', 'training-align'], answer: 1 },
  { id: 'evaluation', lessons: ['evaluation-suite', 'evaluation-redteam'], answer: 1 },
  { id: 'delivery', lessons: ['delivery-card', 'delivery-ops'], answer: 1 },
] as const;
const LLM_COURSE_CHOICES = ['a', 'b', 'c', 'd'] as const;
const LLM_COURSE_LESSON_FIELDS = ['title', 'objective', 'content', 'activity'] as const;

let englishCourseText: CourseTextTranslator | null = null;

/** The English catalog as a course translator — the default for callers with no
 *  board (the marketplace pack's stored copy, tests). Built once, on first use. */
function englishText(): CourseTextTranslator {
  if (!englishCourseText) {
    const t = createTranslator({ locale: 'en', messages: defaultMessages as never });
    englishCourseText = (key) => t(`creationCanvas.${key}` as never);
  }
  return englishCourseText;
}

/**
 * A complete, editable worked course—not placeholder copy. Brain can replace any
 * field through the registry contract, while this gives the blog CTA a useful
 * local result even when the network model is unavailable.
 *
 * @param t The board's `creationCanvas` translator. Omitted → English.
 * @param language The board's locale, recorded on the course (and so on the
 *   exported SCORM package's `<html lang>`).
 */
export function buildLlmCourse(t: CourseTextTranslator = englishText(), language = 'en-US'): CanvasCourse {
  const s = (key: string) => t(`llmCourse.${key}`);
  const modules: CourseModule[] = LLM_COURSE_SHAPE.map((shape) => ({
    id: shape.id,
    title: s(`module.${shape.id}.title`),
    description: s(`module.${shape.id}.description`),
    lessons: shape.lessons.map((id) => lesson(id, s(`lesson.${id}.title`), s(`lesson.${id}.objective`), s(`lesson.${id}.content`), s(`lesson.${id}.activity`))),
    assessment: {
      question: s(`assessment.${shape.id}.question`),
      choices: LLM_COURSE_CHOICES.map((choice) => s(`assessment.${shape.id}.choice.${choice}`)),
      answer: shape.answer,
      explanation: s(`assessment.${shape.id}.explanation`),
    },
  }));
  return {
    schema: COURSE_SCHEMA, version: '1.0.0', language, audience: s('audience'),
    description: s('description'),
    estimatedMinutes: modules.flatMap((item) => item.lessons).reduce((sum, item) => sum + item.durationMinutes, 0),
    subject: s('subject'),
    passingScore: 80, modules, completedLessonIds: [],
  };
}

/**
 * Is this the worked LLM course (in any language)? Recognized by its STRUCTURE —
 * the module ids — never by its copy, which is exactly what differs per board.
 * Lets a surface that places a stored copy (the marketplace pack) re-mint it in
 * the board's language instead of writing the English one.
 */
export function isWorkedLlmCourse(course: unknown): boolean {
  const modules = (course as Partial<CanvasCourse> | null | undefined)?.modules;
  return Array.isArray(modules)
    && modules.length === LLM_COURSE_SHAPE.length
    && LLM_COURSE_SHAPE.every((shape, index) => modules[index]?.id === shape.id);
}

/** Every catalog key the worked course reads, relative to `creationCanvas` — the
 *  ratchet's input, so a locale missing one fails a test rather than persisting a
 *  dotted key into somebody's course. */
export function llmCourseCatalogKeys(): string[] {
  return [
    ...['subject', 'audience', 'description'],
    ...LLM_COURSE_SHAPE.flatMap((shape) => [
      `module.${shape.id}.title`,
      `module.${shape.id}.description`,
      ...shape.lessons.flatMap((id) => LLM_COURSE_LESSON_FIELDS.map((field) => `lesson.${id}.${field}`)),
      `assessment.${shape.id}.question`,
      `assessment.${shape.id}.explanation`,
      ...LLM_COURSE_CHOICES.map((choice) => `assessment.${shape.id}.choice.${choice}`),
    ]),
  ].map((key) => `llmCourse.${key}`);
}

/**
 * A course that knows only its subject.
 *
 * This is what dragging "Course" onto the board makes. It used to make
 * {@link buildLlmCourse} — every course object on the platform, on any subject,
 * arrived as the same five modules about tokenizers and red-teaming, and a
 * learner studying photosynthesis had to delete someone else's curriculum before
 * they could start. The worked LLM course is still exactly that: a worked
 * example, reachable from the LLM Builder Academy template that advertises it.
 */
export function emptyCourse(subject = ''): CanvasCourse {
  return {
    schema: COURSE_SCHEMA, version: '1.0.0', language: 'en-US', subject,
    audience: '', description: '', estimatedMinutes: 0, passingScore: 80,
    modules: [], completedLessonIds: [],
  };
}

export function courseFromNode(data: Readonly<Record<string, unknown>>): CanvasCourse {
  const base = emptyCourse();
  const candidate = data.course && typeof data.course === 'object' && !Array.isArray(data.course) ? data.course as Partial<CanvasCourse> : {};
  return {
    ...base, ...candidate, schema: COURSE_SCHEMA,
    // An empty module list is a REAL state — a course waiting for its subject to
    // be written. Substituting the LLM course here (which is what used to happen)
    // is how a blank course object came to teach machine learning.
    modules: Array.isArray(candidate.modules) ? candidate.modules.slice(0, 30) as CourseModule[] : [],
    completedLessonIds: Array.isArray(candidate.completedLessonIds) ? candidate.completedLessonIds.filter((id): id is string => typeof id === 'string').slice(0, 500) : [],
    subject: typeof candidate.subject === 'string' ? candidate.subject.slice(0, 300) : base.subject,
  };
}

export function courseProgress(course: CanvasCourse): { completed: number; total: number; percent: number } {
  const ids = new Set(course.modules.flatMap((module) => module.lessons.map((item) => item.id)));
  const completed = new Set(course.completedLessonIds.filter((id) => ids.has(id))).size;
  return { completed, total: ids.size, percent: ids.size ? Math.round(completed / ids.size * 100) : 0 };
}

/**
 * The course's knowledge checks, as practice questions.
 *
 * A module assessment and a Practice question are the same thing wearing two
 * shapes, so they are graded, recorded and scored by the ONE model in
 * `canvasPractice` rather than by a second implementation living in the course
 * card. The question id is the module id, which is what lets an attempt made
 * today still point at the right module after the course is edited.
 */
export function courseAssessmentQuestions(course: CanvasCourse): CanvasPracticeQuestion[] {
  return course.modules.flatMap((module) => module.assessment?.question
    ? [{
      id: module.id,
      prompt: module.assessment.question,
      choices: module.assessment.choices,
      answerIndex: module.assessment.answer,
      ...(module.assessment.explanation ? { explanation: module.assessment.explanation } : {}),
    }]
    : []);
}

/**
 * Knowledge-check score, and whether it clears the course's own passing mark.
 *
 * Attempts are passed in rather than read off the course because they live on
 * the OBJECT, not inside the authored course document: the course body is
 * model-writable (a teacher agent rewrites modules), and a learner's record of
 * what they actually answered must not be rewritable by the thing being studied.
 */
export function courseScore(course: CanvasCourse, attempts: readonly CanvasPracticeAttempt[]): { answered: number; total: number; percent: number; passed: boolean } {
  const questions = courseAssessmentQuestions(course);
  const progress = practiceProgress(questions, attempts);
  // Mastery (a correct streak), not "ever got it right once" — the same bar the
  // Practice object uses, so a course score means what a practice score means.
  const percent = progress.percent;
  return { answered: progress.answered, total: progress.total, percent, passed: progress.total > 0 && percent >= course.passingScore };
}

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const html = (value: string) => xml(value);

export function scormManifest(course: CanvasCourse, title: string): string {
  const resources = course.modules.map((module) => `<resource identifier="RES-${xml(module.id)}" type="webcontent" adlcp:scormType="sco" href="index.html#${xml(module.id)}"><file href="index.html"/></resource>`).join('');
  const items = course.modules.map((module) => `<item identifier="ITEM-${xml(module.id)}" identifierref="RES-${xml(module.id)}"><title>${xml(module.title)}</title></item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><manifest identifier="builderforce-course" version="1.0" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata><organizations default="ORG"><organization identifier="ORG"><title>${xml(title)}</title>${items}</organization></organizations><resources>${resources}</resources></manifest>`;
}

export function courseLaunchHtml(course: CanvasCourse, title: string): string {
  const modules = course.modules.map((module) => `<section id="${html(module.id)}"><h2>${html(module.title)}</h2><p>${html(module.description)}</p>${module.lessons.map((item) => `<article><h3>${html(item.title)}</h3><p><strong>Objective:</strong> ${html(item.objective)}</p><p>${html(item.content)}</p><p><strong>Practice:</strong> ${html(item.activity)}</p></article>`).join('')}<details><summary>Knowledge check</summary><p>${html(module.assessment.question)}</p><ol>${module.assessment.choices.map((choice) => `<li>${html(choice)}</li>`).join('')}</ol></details></section>`).join('');
  return `<!doctype html><html lang="${html(course.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(title)}</title><style>body{font:16px/1.6 system-ui;max-width:850px;margin:auto;padding:2rem;color:#182039}nav a{margin-right:1rem}section{border-top:1px solid #ccd3e2;padding:2rem 0}article{background:#f5f7fb;padding:1rem;margin:1rem 0;border-radius:.5rem}</style></head><body><header><h1>${html(title)}</h1><p>${html(course.description)}</p><nav>${course.modules.map((module) => `<a href="#${html(module.id)}">${html(module.title)}</a>`).join(' ')}</nav></header>${modules}<script>var api=null;function findApi(w){for(var i=0;i<10&&w;i++,w=w.parent){if(w.API_1484_11)return w.API_1484_11}return null}api=findApi(window);if(api){api.Initialize('');api.SetValue('cmi.completion_status','incomplete');api.SetValue('cmi.score.scaled','0');api.Commit('')}addEventListener('beforeunload',function(){if(api){api.Commit('');api.Terminate('')}});</script></body></html>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
const u16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value, true);
const u32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value, true);

/** Dependency-free ZIP writer using the standards-compliant STORE method. LMS
 * packages are small text assets, so compression would add complexity without
 * changing interoperability. */
export function zipFiles(files: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([name, content]) => ({ name: encoder.encode(name), body: encoder.encode(content) }));
  const localSize = entries.reduce((sum, item) => sum + 30 + item.name.length + item.body.length, 0);
  const centralSize = entries.reduce((sum, item) => sum + 46 + item.name.length, 0);
  const output = new Uint8Array(new ArrayBuffer(localSize + centralSize + 22)); const view = new DataView(output.buffer); let offset = 0; let localOffset = 0;
  for (const item of entries) {
    const crc = crc32(item.body); u32(view, offset, 0x04034b50); u16(view, offset + 4, 20); u16(view, offset + 6, 0x0800); u16(view, offset + 8, 0); u32(view, offset + 14, crc); u32(view, offset + 18, item.body.length); u32(view, offset + 22, item.body.length); u16(view, offset + 26, item.name.length); output.set(item.name, offset + 30); output.set(item.body, offset + 30 + item.name.length); offset += 30 + item.name.length + item.body.length;
  }
  localOffset = 0;
  for (const item of entries) {
    const crc = crc32(item.body); u32(view, offset, 0x02014b50); u16(view, offset + 4, 20); u16(view, offset + 6, 20); u16(view, offset + 8, 0x0800); u16(view, offset + 10, 0); u32(view, offset + 16, crc); u32(view, offset + 20, item.body.length); u32(view, offset + 24, item.body.length); u16(view, offset + 28, item.name.length); u32(view, offset + 42, localOffset); output.set(item.name, offset + 46); offset += 46 + item.name.length; localOffset += 30 + item.name.length + item.body.length;
  }
  u32(view, offset, 0x06054b50); u16(view, offset + 8, entries.length); u16(view, offset + 10, entries.length); u32(view, offset + 12, centralSize); u32(view, offset + 16, localSize); return output;
}

export function buildScormPackage(course: CanvasCourse, title: string): Uint8Array<ArrayBuffer> {
  return zipFiles({
    'imsmanifest.xml': scormManifest(course, title),
    'index.html': courseLaunchHtml(course, title),
    // `schema` comes from the course itself — spreading it after a literal
    // `schema` key silently overwrote the literal (TS2783).
    'course.json': JSON.stringify({ title, ...course }, null, 2),
    'xapi-profile.json': JSON.stringify({ version: '1.0.3', verbs: ['http://adlnet.gov/expapi/verbs/experienced', 'http://adlnet.gov/expapi/verbs/completed', 'http://adlnet.gov/expapi/verbs/passed'], activityType: 'http://adlnet.gov/expapi/activities/course' }, null, 2),
  });
}
