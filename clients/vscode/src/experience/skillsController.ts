import * as path from "path";
import { newExperienceId, type Episode } from "@seanhogg/builderforce-memory-engine";
import type { SkillRunner, LiveRunState } from "./skillRunner";
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
  post(message: SkillsOutbound): void;
  report(error: unknown, operation: string): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
      this.error = messageOf(error);
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
        if (program) this.deps.post({ type: "program.picked", program });
        return;
      }
      case "record.start": {
        if (runner.active || this.recording) return;
        const id = newExperienceId();
        await helper.recordStart({ program: msg.program, shotsDir: path.join(await ops.episodesDir(), id) });
        this.recording = { count: 0, program: msg.program, id };
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
        const r = await runner.start({ skillId: msg.skillId, trigger: "manual", values: msg.values, remember: msg.remember });
        if (!r.ok) this.error = r.error;
        return;
      }
      case "run.stop":
        return runner.stop();
      case "approval.answer":
        return runner.answerApproval(msg.approved);
      case "skill.schedule":
        await ops.schedule(msg.skillId, msg.routine);
        return;
      case "skill.delete":
        return this.deleteSkill(msg.skillId);
    }
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
      base.error = base.error ?? messageOf(error);
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
