/**
 * Result CHROME — the strings the SHARED scorers wrap around a tool's own copy.
 *
 * Its own module, importing nothing, for one structural reason: `toolTypes.ts`
 * needs it (the scorers live there) and `toolMessages.ts` imports `toolTypes`
 * for its structural types. Putting this in `toolMessages.ts` would make that a
 * genuine import cycle with a VALUE on both sides.
 *
 * It is separate from the per-tool catalog for a second reason too: "Level 3 —
 * Defined" belongs to the engine, not to any tool. Every questionnaire emits it
 * identically, and a per-tool copy would be twenty-eight chances to translate one
 * sentence twenty-eight different ways.
 */

import { DEFAULT_EMAIL_LOCALE, type EmailLocale } from '../../infrastructure/email/emailLocale';

/** Same five locales the frontend and email serve — one supported set, imported. */
export type ToolLocale = EmailLocale;
export const DEFAULT_TOOL_LOCALE: ToolLocale = DEFAULT_EMAIL_LOCALE;

/** The chrome one scored result is wrapped in. */
export interface ResultCopy {
  /** The five CMMI band names, index 0 = Level 1. */
  levelNames: [string, string, string, string, string];
  notAssessed: string;
  notAnswered: string;
  insufficientData: string;
  selfAssessmentOnly: string;
  /** `Level 3 — Defined` */
  levelValue: (level: number | string, name: string) => string;
  /** `Software Delivery — to Level 4` */
  planTitle: (name: string, level: number) => string;
  /** Used when a section declares no action for the next level. */
  keepImproving: string;
  notEnoughAnswers: string;
  answerPrompt: string;
  /**
   * The TELEMETRY mode's empty state and byline, distinct from the
   * self-assessment's.
   *
   * "Not enough answers yet" is the wrong sentence in front of a scorecard
   * nobody was asked to answer: it is the WORKSPACE that has not produced enough
   * delivery data, and telling the reader to answer more questions sends them
   * somewhere that cannot help.
   */
  notEnoughTelemetry: string;
  telemetryPrompt: string;
  scoredFromTelemetry: string;
  /** `Aim for: <the next level's option text>` */
  aimFor: (text: string) => string;
  keepMaturing: string;
  /** `Reach Level 3 — Parallel agentic delivery` */
  reachLevel: (level: number, name: string) => string;
}

const RESULT_COPY: Record<ToolLocale, ResultCopy> = {
  en: {
    levelNames: ['Initial', 'Managed', 'Defined', 'Quantitatively Managed', 'Optimizing'],
    notAssessed: 'Not assessed',
    notAnswered: 'Not answered',
    insufficientData: 'Insufficient data',
    selfAssessmentOnly: 'Self-assessment only',
    levelValue: (level, name) => `Level ${level} — ${name}`,
    planTitle: (name, level) => `${name} — to Level ${level}`,
    keepImproving: 'Continue improving this area.',
    notEnoughAnswers: 'Not enough answers yet',
    answerPrompt: 'Answer the questions to see your rating and plan.',
    aimFor: (text) => `Aim for: ${text}`,
    keepMaturing: 'Keep maturing this dimension.',
    notEnoughTelemetry: 'Not enough telemetry yet',
    telemetryPrompt: 'Run some work (deploys, tasks, agent runs) and check back, or use the self-assessment.',
    scoredFromTelemetry: 'Scored objectively from your last delivery window — DORA, cycle time, rework, and agent outcomes.',
    reachLevel: (level, name) => `Reach Level ${level} — ${name}`,
  },
  zh: {
    levelNames: ['初始级', '已管理级', '已定义级', '量化管理级', '优化级'],
    notAssessed: '未评估',
    notAnswered: '未作答',
    insufficientData: '数据不足',
    selfAssessmentOnly: '仅限自评',
    levelValue: (level, name) => `等级 ${level} — ${name}`,
    planTitle: (name, level) => `${name} — 提升到等级 ${level}`,
    keepImproving: '继续改进这一领域。',
    notEnoughAnswers: '作答尚不足',
    answerPrompt: '回答这些问题即可查看评分与改进计划。',
    aimFor: (text) => `目标：${text}`,
    keepMaturing: '继续提升这一维度的成熟度。',
    notEnoughTelemetry: '遥测数据尚不足',
    telemetryPrompt: '先做一些实际工作（部署、任务、智能体运行）再回来看，或者改用自评模式。',
    scoredFromTelemetry: '基于最近一个交付周期客观评分——DORA、周期时间、返工与智能体产出。',
    reachLevel: (level, name) => `达到等级 ${level} — ${name}`,
  },
  es: {
    levelNames: ['Inicial', 'Gestionado', 'Definido', 'Gestionado cuantitativamente', 'En optimización'],
    notAssessed: 'Sin evaluar',
    notAnswered: 'Sin responder',
    insufficientData: 'Datos insuficientes',
    selfAssessmentOnly: 'Solo autoevaluación',
    levelValue: (level, name) => `Nivel ${level} — ${name}`,
    planTitle: (name, level) => `${name} — hasta el nivel ${level}`,
    keepImproving: 'Sigue mejorando en esta área.',
    notEnoughAnswers: 'Todavía no hay suficientes respuestas',
    answerPrompt: 'Responde a las preguntas para ver tu valoración y tu plan.',
    aimFor: (text) => `Objetivo: ${text}`,
    keepMaturing: 'Sigue madurando esta dimensión.',
    notEnoughTelemetry: 'Todavía no hay suficiente telemetría',
    telemetryPrompt: 'Haz algo de trabajo (despliegues, tareas, ejecuciones de agentes) y vuelve, o usa la autoevaluación.',
    scoredFromTelemetry: 'Puntuado objetivamente a partir de tu última ventana de entrega — DORA, tiempo de ciclo, retrabajo y resultados de los agentes.',
    reachLevel: (level, name) => `Alcanzar el nivel ${level} — ${name}`,
  },
  fr: {
    levelNames: ['Initial', 'Géré', 'Défini', 'Géré quantitativement', 'En optimisation'],
    notAssessed: 'Non évalué',
    notAnswered: 'Sans réponse',
    insufficientData: 'Données insuffisantes',
    selfAssessmentOnly: 'Auto-évaluation uniquement',
    levelValue: (level, name) => `Niveau ${level} — ${name}`,
    planTitle: (name, level) => `${name} — vers le niveau ${level}`,
    keepImproving: 'Continuez à améliorer ce domaine.',
    notEnoughAnswers: 'Pas encore assez de réponses',
    answerPrompt: 'Répondez aux questions pour voir votre évaluation et votre plan.',
    aimFor: (text) => `Objectif : ${text}`,
    keepMaturing: 'Continuez à faire mûrir cette dimension.',
    notEnoughTelemetry: 'Pas encore assez de données',
    telemetryPrompt: 'Faites tourner un peu de travail (déploiements, tâches, exécutions d’agents) puis revenez, ou utilisez l’auto-évaluation.',
    scoredFromTelemetry: 'Évalué objectivement sur votre dernière fenêtre de livraison — DORA, temps de cycle, reprises et résultats des agents.',
    reachLevel: (level, name) => `Atteindre le niveau ${level} — ${name}`,
  },
  de: {
    levelNames: ['Initial', 'Gesteuert', 'Definiert', 'Quantitativ gesteuert', 'Optimierend'],
    notAssessed: 'Nicht bewertet',
    notAnswered: 'Nicht beantwortet',
    insufficientData: 'Zu wenig Daten',
    selfAssessmentOnly: 'Nur Selbsteinschätzung',
    levelValue: (level, name) => `Stufe ${level} — ${name}`,
    planTitle: (name, level) => `${name} — auf Stufe ${level}`,
    keepImproving: 'Verbessere diesen Bereich weiter.',
    notEnoughAnswers: 'Noch nicht genug Antworten',
    answerPrompt: 'Beantworte die Fragen, um Bewertung und Plan zu sehen.',
    aimFor: (text) => `Ziel: ${text}`,
    keepMaturing: 'Entwickle diese Dimension weiter.',
    notEnoughTelemetry: 'Noch nicht genug Telemetrie',
    telemetryPrompt: 'Lass etwas Arbeit laufen (Deployments, Aufgaben, Agentenläufe) und schau wieder vorbei — oder nutze die Selbsteinschätzung.',
    scoredFromTelemetry: 'Objektiv aus deinem letzten Lieferzeitraum bewertet — DORA, Durchlaufzeit, Nacharbeit und Agentenergebnisse.',
    reachLevel: (level, name) => `Stufe ${level} erreichen — ${name}`,
  },
};

/** The ONE accessor the scorers use. Falls back to English for a locale that
 *  somehow escaped narrowing, so a bad locale degrades but never renders
 *  `undefined` into a public result. */
export function resultCopy(locale: ToolLocale): ResultCopy {
  return RESULT_COPY[locale] ?? RESULT_COPY[DEFAULT_TOOL_LOCALE];
}
