// i18n patch: the generic TrackerSurface's own chrome (governance.tracker) —
// add/new/edit headings, empty + failure states. Field labels stay data in
// trackerConfigs.ts. Deep-merged additively by scripts/i18n-merge.mjs.
const build = (tracker) => ({ governance: { tracker } });

export const PATCHES = {
  en: build({
    add: '+ Add', newTitle: 'New {title}', editTitle: 'Edit {title}', loadingTitle: 'Loading {title}…',
    noEntries: 'No entries yet.', loadFailed: 'Could not load.', deleteFailed: 'Delete failed.',
    saveFailed: 'Save failed (manager role required for changes).', required: '{field} is required',
  }),
  zh: build({
    add: '+ 添加', newTitle: '新建{title}', editTitle: '编辑{title}', loadingTitle: '正在加载{title}…',
    noEntries: '暂无条目。', loadFailed: '无法加载。', deleteFailed: '删除失败。',
    saveFailed: '保存失败（更改需要管理者角色）。', required: '{field}为必填项',
  }),
  es: build({
    add: '+ Añadir', newTitle: 'Nuevo: {title}', editTitle: 'Editar: {title}', loadingTitle: 'Cargando {title}…',
    noEntries: 'Aún no hay entradas.', loadFailed: 'No se pudo cargar.', deleteFailed: 'Error al eliminar.',
    saveFailed: 'Error al guardar (se requiere el rol de gestor para hacer cambios).', required: '{field} es obligatorio',
  }),
  fr: build({
    add: '+ Ajouter', newTitle: 'Nouveau : {title}', editTitle: 'Modifier : {title}', loadingTitle: 'Chargement : {title}…',
    noEntries: 'Aucune entrée pour l’instant.', loadFailed: 'Chargement impossible.', deleteFailed: 'Échec de la suppression.',
    saveFailed: 'Échec de l’enregistrement (rôle manager requis pour les modifications).', required: '{field} est obligatoire',
  }),
  de: build({
    add: '+ Hinzufügen', newTitle: 'Neu: {title}', editTitle: 'Bearbeiten: {title}', loadingTitle: '{title} wird geladen…',
    noEntries: 'Noch keine Einträge.', loadFailed: 'Laden fehlgeschlagen.', deleteFailed: 'Löschen fehlgeschlagen.',
    saveFailed: 'Speichern fehlgeschlagen (Manager-Rolle für Änderungen erforderlich).', required: '{field} ist erforderlich',
  }),
};
