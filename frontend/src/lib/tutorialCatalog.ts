export type TutorialTopicId =
  | 'entrepreneurship'
  | 'recruiting'
  | 'product'
  | 'marketing'
  | 'leadership'
  | 'finance'
  | 'softwareAi'
  | 'career';

export type TutorialTopicDefinition = {
  id: TutorialTopicId;
  icon: string;
  accent: string;
};

/** Stable topic identity and presentation metadata. Localized teaching copy lives
 * in the message catalogs so navigation, cards, and generated starter prompts
 * always follow the learner's selected language. */
export const TUTORIAL_TOPICS: readonly TutorialTopicDefinition[] = [
  { id: 'entrepreneurship', icon: '🚀', accent: '#ff8066' },
  { id: 'recruiting', icon: '🤝', accent: '#9b7cff' },
  { id: 'product', icon: '◈', accent: '#44b9ff' },
  { id: 'marketing', icon: '◎', accent: '#ff5da2' },
  { id: 'leadership', icon: '✦', accent: '#f1b84b' },
  { id: 'finance', icon: '↗', accent: '#35cf9a' },
  { id: 'softwareAi', icon: '⌨', accent: '#6fa8ff' },
  { id: 'career', icon: '△', accent: '#b18cff' },
] as const;
