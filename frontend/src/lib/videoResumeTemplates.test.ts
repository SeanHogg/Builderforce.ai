import { describe, expect, it } from 'vitest';
import { VIDEO_RESUME_TEMPLATES, videoResumeTemplatePatch } from './videoResumeTemplates';

describe('Hired video resume templates', () => {
  it('ports every first-party template ID with internally consistent scene timing', () => {
    expect(VIDEO_RESUME_TEMPLATES).toHaveLength(15);
    expect(new Set(VIDEO_RESUME_TEMPLATES.map((template) => template.id)).size).toBe(15);
    expect(VIDEO_RESUME_TEMPLATES.every((template) => template.firstParty && template.creator === 'Hired.VIDEO')).toBe(true);
    for (const template of VIDEO_RESUME_TEMPLATES) {
      expect(template.scenes.reduce((sum, scene) => sum + scene.duration, 0)).toBe(template.duration);
      expect(template.colors).toHaveLength(4);
    }
  });

  it('applies a non-destructive storyboard patch to a Canvas video object', () => {
    const template = VIDEO_RESUME_TEMPLATES.find((item) => item.id === 'video-resume-story-led')!;
    expect(videoResumeTemplatePatch(template)).toMatchObject({ videoResumeTemplateId: template.id, duration: 75, videoStoryboard: template.scenes });
  });
});
