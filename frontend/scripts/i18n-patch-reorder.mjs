// i18n patch: reorderable dashboard grid handle labels.
const r = (drag, moveLeft, moveRight) => ({ widgets: { reorder: { drag, moveLeft, moveRight } } });

export const PATCHES = {
  en: r('Drag to reorder', 'Move left', 'Move right'),
  zh: r('拖动以重新排序', '左移', '右移'),
  es: r('Arrastrar para reordenar', 'Mover a la izquierda', 'Mover a la derecha'),
  fr: r('Glisser pour réorganiser', 'Déplacer à gauche', 'Déplacer à droite'),
  de: r('Zum Umsortieren ziehen', 'Nach links', 'Nach rechts'),
};
