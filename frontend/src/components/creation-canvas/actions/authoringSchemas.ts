

export const COURSE_AUTHORING_CONTRACT = '{ version, language, audience, description, estimatedMinutes, passingScore, completedLessonIds: [], modules: [{ id, title, description, lessons: [{ id, title, objective, content, activity, durationMinutes }], assessment: { question, choices, answer, explanation } }] }';

export const COURSE_AUTHORING_SCHEMA = {
  type: 'object',
  required: ['version', 'language', 'audience', 'description', 'estimatedMinutes', 'passingScore', 'completedLessonIds', 'modules'],
  properties: {
    version: { type: 'string' }, language: { type: 'string' }, audience: { type: 'string' }, description: { type: 'string' },
    estimatedMinutes: { type: 'number' }, passingScore: { type: 'number' }, completedLessonIds: { type: 'array', items: { type: 'string' } },
    modules: {
      type: 'array', minItems: 1, items: {
        type: 'object', required: ['id', 'title', 'description', 'lessons', 'assessment'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
          lessons: {
            type: 'array', minItems: 1, items: {
              type: 'object', required: ['id', 'title', 'objective', 'content', 'activity', 'durationMinutes'],
              properties: { id: { type: 'string' }, title: { type: 'string' }, objective: { type: 'string' }, content: { type: 'string' }, activity: { type: 'string' }, durationMinutes: { type: 'number' } },
            },
          },
          assessment: {
            type: 'object', required: ['question', 'choices', 'answer', 'explanation'],
            properties: { question: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } }, answer: { type: 'number' }, explanation: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;

export const GUIDED_TOUR_AUTHORING_SCHEMA = {
  type: 'object',
  required: ['version', 'minimumVisits', 'offerTitle', 'offerBody', 'startLabel', 'cancelLabel', 'blurBackground', 'escapeHatch', 'steps'],
  properties: {
    version: { type: 'number' }, minimumVisits: { type: 'number' }, offerTitle: { type: 'string' }, offerBody: { type: 'string' },
    startLabel: { type: 'string' }, cancelLabel: { type: 'string' }, blurBackground: { type: 'boolean' }, escapeHatch: { type: 'boolean', const: true },
    steps: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'title', 'body', 'targetObjectId'], properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, targetObjectId: { type: 'string', description: 'Canvas object id to spotlight; use an empty string until a target exists.' } } } },
  },
} as const;

export const WEBSITE_SECTION_SCHEMA = {
  type: 'object', required: ['id', 'kind'], additionalProperties: false,
  properties: {
    id: { type: 'string' }, kind: { type: 'string', enum: ['hero', 'features', 'content', 'stats', 'testimonial', 'cta'] },
    eyebrow: { type: 'string' }, heading: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' }, secondaryCta: { type: 'string' },
    quote: { type: 'string' }, author: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, body: { type: 'string' }, value: { type: 'string' }, label: { type: 'string' } } } },
  },
};

export const WEBSITE_PAGES_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 8, items: {
    type: 'object', required: ['id', 'name', 'path', 'sections'], additionalProperties: false,
    properties: { id: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' }, sections: { type: 'array', minItems: 2, maxItems: 12, items: WEBSITE_SECTION_SCHEMA } },
  },
};

export const WEBSITE_THEME_SCHEMA = {
  type: 'object', required: ['style'], additionalProperties: false,
  properties: { style: { type: 'string', enum: ['editorial', 'bold', 'minimal', 'soft', 'technical'] }, background: { type: 'string' }, foreground: { type: 'string' }, accent: { type: 'string' } },
};
