/**
 * The AI-model project types: the ONE registry, stored as data.
 *
 * A host (the VS Code extension's `builderforce.newAiProject` command and its
 * walkthrough) renders this list and runs each entry's `firstRun`; adding a type is
 * adding an entry here plus its label keys in the host's catalogs. The package has no
 * i18n, so an entry carries KEYS (`labelKey`, `descriptionKey`) that the host resolves.
 *
 * `modality` is a project modality id the API accepts on `POST /api/projects`
 * (`IDE_MODALITIES` in `api/src/application/project/ideProjectBinding.ts`; the web
 * registry is `frontend/src/lib/modality.ts`).
 */

/** A step run after the project exists. Discriminated on `kind`. */
export type ProjectTypeAction =
  /** Run an editor command. `labelKey` names the option when it sits inside a `choice`. */
  | { kind: 'command'; command: string; labelKey?: string }
  /** Open a web-app path in the browser; `{projectId}` is replaced by the new project's id. */
  | { kind: 'openWeb'; path: string }
  /** Let the person pick the model the project will use. */
  | { kind: 'pickModel' }
  /** Offer the options as a choice and run the one picked. */
  | { kind: 'choice'; placeholderKey: string; options: readonly ProjectTypeAction[] };

export type ProjectTypeId = 'ai-scratch' | 'ai-existing' | 'ai-knowledge-pack';

/** The modalities an AI project type is created with. */
export type ProjectTypeModality = 'evermind' | 'finetune';

export interface ProjectTypeEntry {
  id: ProjectTypeId;
  labelKey: string;
  descriptionKey: string;
  modality: ProjectTypeModality;
  /** A starter kit (`./kits`) to seed the workspace with, when the type has one. */
  kit?: string;
  firstRun: readonly ProjectTypeAction[];
}

export const PROJECT_TYPES: readonly ProjectTypeEntry[] = [
  {
    id: 'ai-scratch',
    labelKey: 'projectType.aiScratch.label',
    descriptionKey: 'projectType.aiScratch.description',
    modality: 'evermind',
    // The Evermind sidebar view; VS Code registers `<viewId>.focus` for every view.
    firstRun: [{ kind: 'command', command: 'builderforce.evermind.focus' }],
  },
  {
    id: 'ai-existing',
    labelKey: 'projectType.aiExisting.label',
    descriptionKey: 'projectType.aiExisting.description',
    modality: 'finetune',
    // `/studio/project/<id>` is the durable-project studio; the project's modality picks the Finetune panels.
    firstRun: [{ kind: 'pickModel' }, { kind: 'openWeb', path: '/studio/project/{projectId}' }],
  },
  {
    id: 'ai-knowledge-pack',
    labelKey: 'projectType.aiKnowledgePack.label',
    descriptionKey: 'projectType.aiKnowledgePack.description',
    modality: 'evermind',
    firstRun: [
      {
        kind: 'choice',
        placeholderKey: 'projectType.aiKnowledgePack.choice',
        options: [
          { kind: 'command', command: 'builderforce.createKnowledgePack', labelKey: 'projectType.aiKnowledgePack.create' },
          { kind: 'command', command: 'builderforce.loadKnowledgePack', labelKey: 'projectType.aiKnowledgePack.load' },
        ],
      },
    ],
  },
];

/** The entry with this id, or undefined. */
export function projectTypeById(id: string | null | undefined): ProjectTypeEntry | undefined {
  return PROJECT_TYPES.find((type) => type.id === id);
}

/** A path template with `{projectId}` filled in. */
export function projectTypePath(template: string, projectId: number | string): string {
  return template.replace(/\{projectId\}/g, encodeURIComponent(String(projectId)));
}
