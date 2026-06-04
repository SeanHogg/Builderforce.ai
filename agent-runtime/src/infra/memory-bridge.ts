/**
 * Mediator that breaks the circular dependency between KnowledgeLoopService and
 * SsmMemoryService. Neither service imports the other directly; both register
 * here via setter functions, and the mediator exposes typed accessors.
 */

export interface IKnowledgeLoop {
  pullTeamMemory(limit?: number): Promise<unknown[]>;
  pushMemoryToMesh(runId: string, summary: string, tags?: string[]): Promise<void>;
}

let _knowledgeLoop: IKnowledgeLoop | null = null;
let _buildTeamMemoryContext: (() => Promise<string>) | null = null;

export function registerKnowledgeLoop(svc: IKnowledgeLoop): void {
  _knowledgeLoop = svc;
}

export function registerTeamMemoryContextBuilder(fn: () => Promise<string>): void {
  _buildTeamMemoryContext = fn;
}

export function getKnowledgeLoop(): IKnowledgeLoop | null {
  return _knowledgeLoop;
}

export async function buildTeamMemoryContext(): Promise<string> {
  if (!_buildTeamMemoryContext) {
    return "";
  }
  return _buildTeamMemoryContext();
}
