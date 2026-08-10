import { describe, expect, it } from 'vitest';
import { buildLlmCourse, buildScormPackage, courseProgress, scormManifest } from './courseLms';

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
