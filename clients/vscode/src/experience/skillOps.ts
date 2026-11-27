import type { Episode, EpisodeSummary, ReviewEdits, Run, RunStatus, Skill, SkillRoutine } from "@seanhogg/builderforce-memory-engine";
import type { OpResult } from "@seanhogg/builderforce-memory-mcp/experience";
import type { ExperienceHostProvider } from "./experienceHost";
import type { RunStore } from "./skillRunnerPorts";

/**
 * Every store operation the Skills feature performs, as plain async calls over the
 * experience host. The rules live in memory-mcp's `experience` operations (validation,
 * routine-secret stripping, run bookkeeping); this only binds them to the host and turns
 * an `OpResult` failure into a thrown `Error` the caller reports.
 */
export interface SkillOps extends RunStore {
  listSkills(): Promise<Skill[]>;
  deleteSkill(id: string): Promise<boolean>;
  listEpisodes(): Promise<EpisodeSummary[]>;
  getEpisode(id: string): Promise<Episode | undefined>;
  /** Validates and stores a recorded episode; returns its id. */
  saveEpisode(raw: unknown): Promise<string>;
  /** Train Once: compile (and save) a skill from an episode and the review's edits. */
  compile(episodeId: string, edits: ReviewEdits | undefined): Promise<Skill>;
  /** Give a skill a routine, or remove it with null. */
  schedule(skillId: string, routine: Omit<SkillRoutine, "lastRunAt"> | null): Promise<Skill>;
  /** Skills whose routine is due now. */
  due(): Promise<Skill[]>;
  /** Forget an episode (and its screenshot folder). */
  deleteEpisode(id: string): Promise<boolean>;
  /** Where each episode's screenshots go: `<episodesDir>/<episodeId>/`. */
  episodesDir(): Promise<string>;
}

function unwrap<T>(r: OpResult<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

export function createSkillOps(provider: ExperienceHostProvider): SkillOps {
  const ops = () => import("@seanhogg/builderforce-memory-mcp/experience");
  return {
    async listSkills() {
      return (await provider.get()).store.listSkills();
    },
    async getSkill(id) {
      return (await provider.get()).store.getSkill(id);
    },
    async deleteSkill(id) {
      return (await provider.get()).store.deleteSkill(id);
    },
    async listEpisodes() {
      return (await provider.get()).store.listEpisodes();
    },
    async getEpisode(id) {
      return (await provider.get()).store.getEpisode(id);
    },
    async deleteEpisode(id) {
      return (await provider.get()).store.deleteEpisode(id);
    },
    async episodesDir() {
      return (await provider.get()).episodesDir;
    },
    async listRuns(limit) {
      return (await provider.get()).store.listRuns(limit);
    },
    async saveEpisode(raw) {
      const [host, m] = await Promise.all([provider.get(), ops()]);
      return unwrap(await m.saveEpisode(host, raw)).id;
    },
    async compile(episodeId, edits) {
      const [host, m] = await Promise.all([provider.get(), ops()]);
      return unwrap(await m.compileSkill(host, episodeId, edits, true));
    },
    async schedule(skillId, routine) {
      const [host, m] = await Promise.all([provider.get(), ops()]);
      return unwrap(await m.scheduleSkill(host, skillId, routine));
    },
    async due() {
      const [host, m] = await Promise.all([provider.get(), ops()]);
      return m.skillsDue(host);
    },
    async startRun(skillId, trigger): Promise<Run> {
      const [host, m] = await Promise.all([provider.get(), ops()]);
      return unwrap(await m.startRun(host, skillId, trigger));
    },
    async stepRun(input) {
      const [host, m] = await Promise.all([provider.get(), ops()]);
      unwrap(await m.stepRun(host, input));
    },
    async finishRun(runId, status: RunStatus, error) {
      const [host, m] = await Promise.all([provider.get(), ops()]);
      unwrap(await m.finishRun(host, runId, status, error));
    },
  };
}
