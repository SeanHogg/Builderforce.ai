/**
 * The names of the editor's files under `.builderforce/knowledge/` (PRD 38 §4.7, §5.1; PRD 41 A7). The local graph and the
 * review manifest are no longer kept in them: every root's knowledge is a row in the folder's SQLite store
 * (`folderKnowledge.ts`, G03). What remains here is the ONE disk-name rule the legacy import, the replica queue and the
 * knowledge index share, and the {@link KnowledgeFiles} port (the workspace-fs adapter is `knowledgeFs.ts`).
 */

// The manifest and file names are the ONE disk rule (`.builderforce/knowledge/<stem>.*`,
// shared with the knowledge index and on-prem).
import { extractedLogFileName, manifestFileName, snapshotFileName, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";

export { extractedLogFileName, manifestFileName, snapshotFileName, type KnowledgeFiles };
