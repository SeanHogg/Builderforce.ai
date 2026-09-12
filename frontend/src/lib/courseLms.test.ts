import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import { buildLlmCourse, buildScormPackage, courseProgress, isWorkedLlmCourse, llmCourseCatalogKeys, scormManifest } from './courseLms';

/** The board's `creationCanvas` translator, as the canvas hands it in. */
function boardText(messages: Record<string, unknown>, locale: string) {
  const t = createTranslator({ locale, messages: messages as never, namespace: 'creationCanvas' as never, onError: () => {} });
  return (key: string) => t(key as never);
}

describe('the worked LLM course is minted in the board’s language', () => {
  it('reads every field from the catalog, and defaults to English', () => {
    const course = buildLlmCourse();
    const english = boardText(en, 'en');
    expect(course.subject).toBe(english('llmCourse.subject'));
    expect(course.modules[0].lessons[0].content).toBe(english('llmCourse.lesson.foundations-outcome.content'));
    expect(course.language).toBe('en-US');
  });

  it('writes a zh board’s course in Chinese, with the same structure', () => {
    const englishCourse = buildLlmCourse();
    const zhCourse = buildLlmCourse(boardText(zh, 'zh'), 'zh');
    expect(zhCourse.language).toBe('zh');
    expect(zhCourse.subject).not.toBe(englishCourse.subject);
    expect(zhCourse.modules.map((m) => m.id)).toEqual(englishCourse.modules.map((m) => m.id));
    expect(zhCourse.modules.flatMap((m) => m.lessons.map((l) => l.id))).toEqual(englishCourse.modules.flatMap((m) => m.lessons.map((l) => l.id)));
    expect(zhCourse.modules.map((m) => m.assessment.answer)).toEqual(englishCourse.modules.map((m) => m.assessment.answer));
    // No field fell back to a dotted key.
    const text = JSON.stringify(zhCourse);
    expect(text).not.toMatch(/llmCourse\./);
  });

  it('recognizes the worked course by structure in any language, and nothing else', () => {
    expect(isWorkedLlmCourse(buildLlmCourse())).toBe(true);
    expect(isWorkedLlmCourse(buildLlmCourse(boardText(zh, 'zh'), 'zh'))).toBe(true);
    expect(isWorkedLlmCourse({ modules: [] })).toBe(false);
    expect(isWorkedLlmCourse(undefined)).toBe(false);
  });

  it('names catalog keys that exist', () => {
    const english = boardText(en, 'en');
    expect(llmCourseCatalogKeys().filter((key) => english(key) === `creationCanvas.${key}` || english(key) === key)).toEqual([]);
  });
});

describe('course LMS standard', () => {
  it('ships a complete LLM learning path with stable progress', () => {
    const course = buildLlmCourse();
    expect(course.modules).toHaveLength(6);
    expect(course.modules.every((module) => module.lessons.length >= 2 && module.assessment.choices.length >= 2)).toBe(true);
    expect(courseProgress({ ...course, completedLessonIds: [course.modules[0].lessons[0].id] })).toEqual({ completed: 1, total: 12, percent: 8 });
  });

  it('builds a SCORM 2004 package with a root manifest', () => {
    const course = buildLlmCourse();
    const manifest = scormManifest(course, 'Build an LLM');
    expect(manifest).toContain('<schemaversion>2004 4th Edition</schemaversion>');
    expect(manifest).toContain('adlcp:scormType="sco"');
    const archive = buildScormPackage(course, 'Build an LLM');
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(archive)).toContain('imsmanifest.xml');
  });
});
