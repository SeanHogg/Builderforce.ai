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
  { id: 'entrepreneurship', icon: '🚀', accent: 'var(--orange-bright)' },
  { id: 'recruiting', icon: '🤝', accent: 'var(--violet-bright)' },
  { id: 'product', icon: '◈', accent: 'var(--sky-bright)' },
  { id: 'marketing', icon: '◎', accent: 'var(--pink-bright)' },
  { id: 'leadership', icon: '✦', accent: 'var(--amber-bright)' },
  { id: 'finance', icon: '↗', accent: 'var(--emerald-bright)' },
  { id: 'softwareAi', icon: '⌨', accent: 'var(--coral-bright)' },
  { id: 'career', icon: '△', accent: 'var(--purple-bright)' },
] as const;
