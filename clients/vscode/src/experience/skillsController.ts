import * as path from "path";
import { newExperienceId, type Episode } from "@seanhogg/builderforce-memory-engine";
import type { SkillRunner, LiveRunState, StartRequest } from "./skillRunner";
import type { SkillOps } from "./skillOps";
import type { SkillSecrets } from "./skillSecrets";
import type { TeachHelperPort } from "./teachHelper";
import { buildReview, defaultEpisodeName } from "./skillsReview";
import { MAX_HISTORY, type SkillCardView, type SkillsInbound, type SkillsOutbound, type SkillsState } from "./skillsViewProtocol";

/** What the controller needs from the editor (settings, dialogs). */
export interface SkillsHostUi {
  enabled(): boolean;
  phoneApprovals(): boolean;
  signedIn(): Promise<boolean>;
  /** Ask for consent when first enabling, then turn the setting on. */
  enable(): Promise<void>;
  setPhoneApprovals(on: boolean): Promise<void>;
  pickProgram(): Promise<string | undefined>;
  confirmDelete(skillName: string): Promise<boolean>;
}

export interface SkillsControllerDeps {
  ops: SkillOps;
  helper: TeachHelperPort;
  runner: SkillRunner;
  secrets: SkillSecrets;
  ui: SkillsHostUi;
  /** The vendored helper is present and this platform can run it (decided without spawning it). */
  helperAvailable: boolean;
  labels(): Record<string, string>;
  /** A caught error in localized words for the person. */
  explain(error: unknown): string;
  post(message: SkillsOutbound): void;
  report(error: unknown, operation: string): void;
}



/**
 * The Skills view's brain: answers the page's messages (teach, review, run, schedule,
 * delete, toggles) and projects the store and the live run into the page's state. It
 * has no `vscode` import — the editor's dialogs and settings arrive as `ui`.
 */
export class SkillsController {
  private recording: { count: number; program: string; id: string } | null = null;
  private review: SkillsState["review"] = null;
  private live: LiveRunState | null = null;
  private error: string | null = null;
  /** The program the person chose in the host dialog; a page-supplied path is never trusted. */
  private pickedProgram: string | undefined;
  private readonly subscriptions: Array<{ dispose(): void }>;

  constructor(private readonly deps: SkillsControllerDeps) {
    this.subscriptions = [
      deps.runner.onState((s) => {
        this.live = s;
        void this.push();
      }),
      deps.helper.onEvent((e) => {
        if (e.event !== "record.step" || !this.recording) return;
        this.recording.count = e.count;
        deps.post({ type: "recording.count", count: e.count });
      }),
    ];
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
  }

  async handle(msg: SkillsInbound): Promise<void> {
    try {
      this.error = null;
      await this.dispatch(msg);
    } catch (error) {
      this.deps.report(error, `skills:${msg.type}`);
      this.error = this.deps.explain(error);
    }
    await this.push();
  }

  private async dispatch(msg: SkillsInbound): Promise<void> {
    const { ops, helper, runner, ui } = this.deps;
    switch (msg.type) {
      case "ready":
        return;
      case "enable":
        return ui.enable();
      case "phone.set":
        return ui.setPhoneApprovals(msg.on);
      case "program.pick": {
        const program = await ui.pickProgram();
        if (program) {
          this.pickedProgram = program;
          this.deps.post({ type: "program.picked", program });
        }
        return;
      }
      case "record.start": {
        if (!ui.enabled()) return;
        const program = this.pickedProgram;
        if (!program || runner.active || this.recording) return;
        const id = newExperienceId();
        await helper.recordStart({ program, shotsDir: path.join(await ops.episodesDir(), id) });
        this.recording = { count: 0, program, id };
        return;
      }
      case "record.stop":
        return this.stopRecording();
      case "review.compile":
        await ops.compile(msg.episodeId, msg.edits);
        this.review = null;
        return;
      case "review.discard":
        await ops.deleteEpisode(msg.episodeId);
        this.review = null;
        return;
      case "run.start": {
        if (!ui.enabled()) return;
        const req = await this.checkedRunRequest(msg);
        if (!req) return;
        const r = await runner.start(req);
        if (!r.ok) this.error = r.error;
        return;
      }
      case "run.stop":
        return runner.stop();
      case "approval.answer":
        return runner.answerApproval(msg.runId, msg.idx, msg.approved);
      case "skill.schedule":
        if (!ui.enabled()) return;
        await ops.schedule(msg.skillId, msg.routine);
        return;
      case "skill.delete":
        return this.deleteSkill(msg.skillId);
    }
  }

  /**
   * What the page asked to run, checked against the skill: `values` must be strings keyed
   * by the skill's own parameters, `remember` a list of its secret parameters. Anything
   * else is refused (undefined). A kept secret whose "Remember" is not ticked is forgotten
   * once the run has read it.
   */
  private async checkedRunRequest(msg: Extract<SkillsInbound, { type: "run.start" }>): Promise<StartRequest | undefined> {
    const skill = await this.deps.ops.getSkill(msg.skillId);
    if (!skill) return undefined;
    const names = new Set(skill.params.map((p) => p.name));
    const secretNames = new Set(skill.params.filter((p) => p.secret).map((p) => p.name));
    const values = msg.values as unknown;
    const remember = msg.remember as unknown;
    if (!values || typeof values !== "object" || Array.isArray(values)) return undefined;
    if (Object.entries(values).some(([k, v]) => typeof v !== "string" || !names.has(k))) return undefined;
    if (!Array.isArray(remember) || remember.some((n) => typeof n !== "string" || !secretNames.has(n))) return undefined;
    const forget: string[] = [];
    for (const p of skill.params) {
      if (p.secret && !remember.includes(p.name) && (await this.deps.secrets.get(skill.id, p.name)) !== undefined) forget.push(p.name);
    }
    return { skillId: skill.id, trigger: "manual", values: values as Record<string, string>, remember: remember as string[], forget };
  }

  private async stopRecording(): Promise<void> {
    const rec = this.recording;
    this.recording = null;
    const raw = (await this.deps.helper.recordStop()) as Partial<Episode> | null;
    if (!rec || !raw) return;
    // The screenshots already sit in `episodes/<id>/`, so the episode takes that id.
    const id = await this.deps.ops.saveEpisode({ ...raw, id: rec.id, name: raw.name?.trim() || defaultEpisodeName(rec.program) });
    const stored = await this.deps.ops.getEpisode(id);
    if (stored) this.review = buildReview(stored);
  }

  private async deleteSkill(skillId: string): Promise<void> {
    const { ops, secrets, ui } = this.deps;
    const skill = await ops.getSkill(skillId);
    if (!skill || !(await ui.confirmDelete(skill.name))) return;
    await ops.deleteSkill(skillId);
    await secrets.clear(skillId, skill.params.filter((p) => p.secret).map((p) => p.name));
  }

  async snapshot(): Promise<SkillsState> {
    const { ui } = this.deps;
    const enabled = ui.enabled();
    const base: SkillsState = {
      supported: this.deps.helperAvailable,
      enabled,
      signedIn: await ui.signedIn(),
      phoneApprovals: ui.phoneApprovals(),
      skills: [],
      runs: [],
      live: this.live,
      recording: this.recording ? { count: this.recording.count, program: this.recording.program } : null,
      review: this.review,
      error: this.error,
    };
    if (!enabled || !base.supported) return base;
    try {
      base.supported = (await this.deps.helper.probe()).supported;
      if (!base.supported) return base;
      base.skills = await this.skillCards();
      base.runs = (await this.deps.ops.listRuns(MAX_HISTORY)).slice(0, MAX_HISTORY).map((r) => ({
        id: r.id,
        skillName: r.skillName,
        trigger: r.trigger,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt ?? null,
        error: r.error ?? null,
        steps: r.steps.map((s) => ({ idx: s.idx, stepId: s.stepId, outcome: s.outcome, detail: s.detail ?? null })),
      }));
    } catch (error) {
      this.deps.report(error, "skills:snapshot");
      base.error = base.error ?? this.deps.explain(error);
    }
    return base;
  }

  private async skillCards(): Promise<SkillCardView[]> {
    const cards: SkillCardView[] = [];
    for (const s of await this.deps.ops.listSkills()) {
      const params = [];
      for (const p of s.params) {
        const kept = p.secret ? (await this.deps.secrets.get(s.id, p.name)) !== undefined : false;
        params.push({ name: p.name, label: p.label, secret: p.secret, default: p.default ?? null, kept });
      }
      cards.push({
        id: s.id,
        name: s.name,
        program: s.program,
        stepCount: s.steps.length,
        params,
        routine: s.routine ? { schedule: s.routine.schedule, values: s.routine.values, enabled: s.routine.enabled } : null,
      });
    }
    return cards;
  }

  /** Send the page a fresh state frame. */
  async push(): Promise<void> {
    try {
      this.deps.post({ type: "state", state: await this.snapshot(), labels: this.deps.labels() });
    } catch (error) {
      this.deps.report(error, "skills:push");
    }
  }
}
