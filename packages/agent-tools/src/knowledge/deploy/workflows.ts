/**
 * knowledge/deploy/workflows.ts — the deploy jobs of a GitHub Actions workflow (`.github/workflows/*.yml`): a job
 * whose steps run a deploy command (`wrangler deploy`, `pages deploy`, `vercel --prod`, `fly deploy`, `kubectl apply`,
 * `helm upgrade`, `docker push`, `serverless deploy`, `npm publish`, `vsce publish` …) or use a deploy action, or whose
 * id / name says deploy / release / publish. Each is a workflow unit keyed by its job id: its runner, the folders it
 * deploys from (`working-directory`, a `cd dir &&` before the command), env NAMES (job and step `env:`), the
 * workflow's schedules, and `needs` on other deploy jobs as dependencies. Paths in a workflow are relative to the
 * repository root. Commands are tested, never kept. Pure.
 */

import { emptyUnit, resolveFrom, uniq, type DeployUnit } from './deployModel.js';
import { arr, field, obj, str } from './safeRecord.js';
import { parseYaml, yamlMap } from './yamlLite.js';

/** Commands that ship something somewhere (every gap bounded, so a long line costs linear time). */
const DEPLOY_COMMAND = /\b(?:wrangler(?:@\S{1,40})?\s+(?:deploy|publish|pages\s+deploy)|pages\s+deploy|vercel\s+deploy|vercel\b[^\n]{0,200}--prod|fly(?:ctl)?\s+deploy|kubectl\s+(?:apply|rollout)|helm\s+(?:upgrade|install)|docker\s+push|docker\s+buildx\s+build[^\n]{0,200}--push|(?:serverless|sls)\s+deploy|(?:npm|pnpm)\s+publish|yarn\s+npm\s+publish|(?:vsce|ovsx)\s+publish|gcloud\s+(?:run|app|functions)\s+deploy|aws\s+(?:ecs\s+update-service|lambda\s+update-function-code|s3\s+sync)|firebase\s+deploy|netlify\s+deploy|railway\s+up)\b/i;
/** Actions that deploy. */
const DEPLOY_ACTION = /^(cloudflare\/(wrangler|pages)-action|amondnet\/vercel-action|superfly\/flyctl-actions|docker\/build-push-action|aws-actions\/amazon-ecs-deploy|google-github-actions\/deploy-|azure\/(webapps|functions|k8s)-deploy|JS-DevTools\/npm-publish|peaceiris\/actions-gh-pages|actions\/deploy-pages|FirebaseExtended\/action-hosting-deploy|netlify\/actions|mnao305\/chrome-extension-upload)/i;
const DEPLOY_NAME = /\b(deploy|release|publish)/i;

/** The folders a step works in: its `working-directory` / action `workingDirectory`, and `cd dir` before a command. */
function stepDirs(step: unknown, run: string, jobDir: string | undefined): string[] {
    const dirs: string[] = [];
    const wd = str(field(step, 'working-directory')) ?? str(field(field(step, 'with'), 'workingDirectory'))
        ?? str(field(field(step, 'with'), 'working-directory')) ?? jobDir;
    if (wd) dirs.push(wd);
    for (const m of run.matchAll(/(?:^|[;&|]\s{0,8})cd\s+([\w./-]{1,200})/gm)) dirs.push(m[1]!);
    return dirs;
}

/** The workflow's `on.schedule[].cron` strings. */
function schedules(doc: object): string[] {
    const on = field(doc, 'on') ?? field(doc, 'true');
    return arr(field(on, 'schedule')).map((s) => str(field(s, 'cron'))).filter((c): c is string => !!c);
}

export function parseWorkflow(_path: string, text: string): DeployUnit[] {
    const doc = yamlMap(parseYaml(text));
    const cron = schedules(doc);
    const units: DeployUnit[] = [];
    const needsOf = new Map<string, string[]>();
    for (const [id, job] of Object.entries(yamlMap(doc['jobs']))) {
        const jobDir = str(field(field(field(job, 'defaults'), 'run'), 'working-directory'));
        let deploys = 0;
        const dirs: string[] = [];
        const env: string[] = Object.keys(obj(field(job, 'env')));
        for (const step of arr(field(job, 'steps'))) {
            const run = str(field(step, 'run')) ?? '';
            const uses = str(field(step, 'uses')) ?? '';
            if (!DEPLOY_COMMAND.test(run) && !DEPLOY_ACTION.test(uses)) continue;
            deploys += 1;
            dirs.push(...stepDirs(step, run, jobDir));
            env.push(...Object.keys(obj(field(step, 'env'))));
        }
        const name = str(field(job, 'name')) ?? '';
        if (deploys === 0 && !DEPLOY_NAME.test(id) && !DEPLOY_NAME.test(name)) continue;
        const unit = emptyUnit(id, 'workflow');
        const runsOn = field(job, 'runs-on');
        unit.runtime = Array.isArray(runsOn) ? runsOn.map(String).join(',') : str(runsOn) ?? 'github-actions';
        unit.sources = uniq(dirs.map((d) => resolveFrom('', d)).filter((d): d is string => d !== undefined && d !== ''));
        unit.env = uniq(env);
        unit.cron = [...cron];
        const needs = field(job, 'needs');
        needsOf.set(id, Array.isArray(needs) ? needs.map(String) : str(needs) ? [str(needs)!] : []);
        units.push(unit);
    }
    const deployIds = new Set(units.map((u) => u.key));
    for (const u of units) u.dependsOn = (needsOf.get(u.key) ?? []).filter((n) => deployIds.has(n));
    return units;
}
