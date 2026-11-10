/**
 * knowledge/deploy/serverless.ts — a Serverless Framework `serverless.yml`: one function unit per `functions` entry
 * (keyed by that entry) — its handler file, the provider runtime, environment NAMES (provider-wide and its own),
 * `schedule` events as cron, and SQS / SNS events as queue / topic bindings it consumes. Pure.
 */

import { emptyUnit, envNames, resolveFrom, uniq, type DeployBinding, type DeployUnit } from './deployModel.js';
import { arr, field, str } from './safeRecord.js';
import { isYamlMap, parseYaml, yamlMap } from './yamlLite.js';

/** The last segment of an ARN, or the name as written (an ARN given as `Fn::GetAtt` is not readable here). */
const resourceName = (v: unknown): string | undefined => {
    const s = str(isYamlMap(v) ? v['arn'] ?? v['queueName'] ?? v['topicName'] : v);
    return s ? s.split(/[:/]/).pop() : undefined;
};

/** `src/handler.main` → the module `src/handler` (its extension is found when the graph is built). */
const handlerModule = (handler: string): string => handler.replace(/\.[^./]+$/, '');

export function parseServerless(path: string, text: string): DeployUnit[] {
    const doc = yamlMap(parseYaml(text));
    const provider = doc['provider'];
    const service = str(doc['service']) ?? str(field(doc['service'], 'name'));
    const runtime = str(field(provider, 'runtime')) ?? str(field(provider, 'name')) ?? 'serverless';
    const sharedEnv = envNames(field(provider, 'environment'));
    const units: DeployUnit[] = [];
    for (const [key, fn] of Object.entries(yamlMap(doc['functions']))) {
        const unit = emptyUnit(service ? `${service}-${key}` : key, 'function', key);
        unit.runtime = str(field(fn, 'runtime')) ?? str(field(fn, 'image')) ?? runtime;
        const handler = str(field(fn, 'handler'));
        const source = handler ? resolveFrom(path, handlerModule(handler)) : undefined;
        if (source) unit.sources.push(source);
        unit.env = uniq([...sharedEnv, ...envNames(field(fn, 'environment'))]);
        const bindings: DeployBinding[] = [];
        for (const ev of arr(field(fn, 'events'))) {
            const schedule = field(ev, 'schedule');
            const rates = isYamlMap(schedule) ? schedule['rate'] : schedule;
            for (const r of Array.isArray(rates) ? rates : [rates]) { const s = str(r); if (s) unit.cron.push(s); }
            const sqs = resourceName(field(ev, 'sqs'));
            if (sqs) bindings.push({ kind: 'queue', name: sqs, resource: sqs, direction: 'consumes' });
            const sns = resourceName(field(ev, 'sns'));
            if (sns) bindings.push({ kind: 'topic', name: sns, resource: sns, direction: 'consumes' });
        }
        unit.bindings = bindings;
        units.push(unit);
    }
    return units;
}
