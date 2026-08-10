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

/** A complete, editable worked course—not placeholder copy. Brain can replace
 * any field through the registry contract, while this gives the blog CTA a
 * useful local result even when the network model is unavailable. */
export function buildLlmCourse(): CanvasCourse {
  const modules: CourseModule[] = [
    {
      id: 'foundations', title: '1. Define the model', description: 'Turn a capability goal into measurable model requirements.',
      lessons: [
        lesson('foundations-outcome', 'Choose an outcome', 'Define one behavior the model must perform reliably.', 'An LLM predicts the next token. A useful product wraps that capability in a clear audience, task, context window, latency target, safety boundary, and evaluation plan.', 'Write a one-sentence model card: “For [audience], the model will [behavior], using [evidence], and succeeds when [metric].”'),
        lesson('foundations-scale', 'Pick the right build path', 'Compare prompting, retrieval, fine-tuning, and pretraining.', 'Start with the least expensive intervention that can meet the requirement. Prompting changes instructions, retrieval supplies current knowledge, fine-tuning changes behavior, and pretraining learns representations from a corpus.', 'List two reasons your goal requires training rather than prompting or retrieval.'),
      ],
      assessment: { question: 'When should you consider pretraining a model from scratch?', choices: ['Whenever prompts are inconvenient', 'When you have distinctive data, sufficient compute, and a requirement base models cannot meet', 'Before defining evaluations', 'For every private knowledge base'], answer: 1, explanation: 'Pretraining is justified only by requirements and resources that simpler approaches cannot satisfy.' },
    },
    {
      id: 'data', title: '2. Build the dataset', description: 'Create a licensed, representative, contamination-aware corpus.',
      lessons: [
        lesson('data-corpus', 'Source and govern data', 'Create a traceable corpus with usage rights.', 'Record provenance, license, consent, retention, language, domain, and quality signals for every source. Remove secrets and personal data before training.', 'Draft a dataset card with allowed use, exclusions, and known representation gaps.'),
        lesson('data-pipeline', 'Clean, deduplicate, and split', 'Prevent leakage and evaluation contamination.', 'Normalize encoding, remove low-quality documents, deduplicate before splitting, and reserve test data that cannot enter training or prompt development.', 'Design train, validation, and test splits and state how you will detect near-duplicates.'),
      ],
      assessment: { question: 'Why deduplicate before creating data splits?', choices: ['To increase token count', 'To prevent near-identical examples leaking into evaluation', 'To remove the need for a tokenizer', 'To guarantee factuality'], answer: 1, explanation: 'Cross-split duplicates inflate evaluation results and hide poor generalization.' },
    },
    {
      id: 'tokenizer', title: '3. Tokenization and architecture', description: 'Translate text into model inputs and choose a defensible scale.',
      lessons: [
        lesson('tokenizer-train', 'Train and inspect a tokenizer', 'Measure how vocabulary choices affect your domain.', 'A BPE or unigram tokenizer learns reusable text pieces. Inspect fertility, unknown bytes, multilingual coverage, and handling of code or domain terminology.', 'Tokenize 20 representative samples and flag words that fragment excessively.'),
        lesson('architecture-budget', 'Budget model shape and compute', 'Relate parameters, tokens, memory, and throughput.', 'Choose layers, hidden width, attention heads, context length, and parameter count together. Estimate training FLOPs, optimizer memory, checkpoint size, and inference cost before the run.', 'Create a budget table for parameters, training tokens, accelerator hours, storage, and serving latency.'),
      ],
      assessment: { question: 'What does tokenizer fertility measure?', choices: ['Tokens produced per word or text unit', 'GPU utilization', 'Model accuracy', 'Dataset license quality'], answer: 0, explanation: 'High fertility can make a domain inefficient and reduce usable context.' },
    },
    {
      id: 'training', title: '4. Train safely', description: 'Run reproducible pretraining and instruction tuning.',
      lessons: [
        lesson('training-run', 'Configure the training run', 'Make a run reproducible and observable.', 'Version code, data, tokenizer, configuration, and seeds. Track loss, gradient norm, learning rate, throughput, data batches, and checkpoint health.', 'Write a preflight checklist including a tiny overfit test and checkpoint recovery drill.'),
        lesson('training-align', 'Instruction tune and align', 'Teach task behavior without erasing base capability.', 'Use reviewed instruction-response examples, an explicit mixture, held-out tasks, and conservative hyperparameters. Preference optimization can refine behavior after supervised fine-tuning.', 'Create three instruction examples and a rubric that distinguishes correctness from style.'),
      ],
      assessment: { question: 'What should happen before a full training run?', choices: ['Disable checkpoints', 'Run a small end-to-end overfit and recovery test', 'Use the test split for tuning', 'Publish the model card'], answer: 1, explanation: 'A small rehearsal validates data, code, metrics, and recovery before expensive compute begins.' },
    },
    {
      id: 'evaluation', title: '5. Evaluate and red-team', description: 'Measure capability, safety, robustness, and cost.',
      lessons: [
        lesson('evaluation-suite', 'Build an evaluation suite', 'Connect every requirement to a test.', 'Combine deterministic checks, model-graded rubrics with calibration, expert review, and adversarial cases. Report uncertainty and slice results by domain and audience.', 'Create a release scorecard with thresholds for quality, safety, latency, and cost.'),
        lesson('evaluation-redteam', 'Probe failure modes', 'Discover harmful or brittle behavior before release.', 'Test prompt injection, data extraction, unsafe advice, bias, hallucination, long-context degradation, multilingual behavior, and distribution shift.', 'Write five abuse cases and define the expected refusal or safe-completion behavior.'),
      ],
      assessment: { question: 'A single average benchmark score is insufficient because…', choices: ['benchmarks never work', 'it can hide failures in important slices and safety cases', 'latency is always constant', 'training loss is the only valid metric'], answer: 1, explanation: 'Release decisions need disaggregated capability and safety evidence.' },
    },
    {
      id: 'delivery', title: '6. Package, deploy, and improve', description: 'Ship a versioned model with operational controls.',
      lessons: [
        lesson('delivery-card', 'Publish the model card', 'Document intended use, evidence, and limits.', 'Package immutable weights, tokenizer, inference configuration, licenses, evaluation results, and a model card. Sign artifacts and retain a rollback target.', 'Complete a model card covering intended use, out-of-scope use, data, evaluations, limitations, and ownership.'),
        lesson('delivery-ops', 'Operate the learning loop', 'Monitor quality without training on unreviewed feedback.', 'Observe latency, cost, drift, safety events, and user outcomes. Route candidate feedback through review, regression evaluation, approval, and a new version.', 'Draw the promotion path from candidate evidence to approved dataset to evaluated release.'),
      ],
      assessment: { question: 'Which feedback should automatically enter the next training set?', choices: ['All user conversations', 'Only reviewed, consented, policy-compliant evidence', 'Only negative feedback', 'Any high-volume prompt'], answer: 1, explanation: 'Human review and governance prevent privacy, poisoning, and quality failures.' },
    },
  ];
  return {
    schema: COURSE_SCHEMA, version: '1.0.0', language: 'en-US', audience: 'Software and ML practitioners',
    description: 'A hands-on path from model requirements and governed data through tokenization, training, evaluation, packaging, and operations.',
    estimatedMinutes: modules.flatMap((item) => item.lessons).reduce((sum, item) => sum + item.durationMinutes, 0),
    passingScore: 80, modules, completedLessonIds: [],
  };
}

export function courseFromNode(data: Readonly<Record<string, unknown>>): CanvasCourse {
  const fallback = buildLlmCourse();
  const candidate = data.course && typeof data.course === 'object' && !Array.isArray(data.course) ? data.course as Partial<CanvasCourse> : {};
  return {
    ...fallback, ...candidate, schema: COURSE_SCHEMA,
    modules: Array.isArray(candidate.modules) && candidate.modules.length ? candidate.modules.slice(0, 30) as CourseModule[] : fallback.modules,
    completedLessonIds: Array.isArray(candidate.completedLessonIds) ? candidate.completedLessonIds.filter((id): id is string => typeof id === 'string').slice(0, 500) : [],
  };
}

export function courseProgress(course: CanvasCourse): { completed: number; total: number; percent: number } {
  const ids = new Set(course.modules.flatMap((module) => module.lessons.map((item) => item.id)));
  const completed = new Set(course.completedLessonIds.filter((id) => ids.has(id))).size;
  return { completed, total: ids.size, percent: ids.size ? Math.round(completed / ids.size * 100) : 0 };
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
