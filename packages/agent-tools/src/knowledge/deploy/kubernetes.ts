/**
 * knowledge/deploy/kubernetes.ts — Kubernetes manifests (every `---` document with `apiVersion` + `kind`): a
 * workload (Deployment, StatefulSet, DaemonSet, ReplicaSet, Pod, Job, CronJob) is a container unit — the first
 * container's image, every container port, env NAMES (`env[].name`; `value` / `valueFrom` / Secret contents never
 * read), mounted claims as volume bindings and a CronJob's schedule. A Service is a service unit that depends on the
 * workloads of its namespace its selector picks; an Ingress depends on the Services its rules route to. Each unit's
 * key is `<namespace>/<Kind>/<name>`, so a Deployment and its Service of one name are two units. Pure.
 */

import { emptyUnit, envNames, portOf, uniq, type DeployUnit } from './deployModel.js';
import { arr, field, str } from './safeRecord.js';
import { parseYamlDocuments, yamlMap, type YamlMap } from './yamlLite.js';

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Pod', 'Job', 'CronJob']);

/** The pod template of a workload (a CronJob nests it one level deeper; a Pod is its own). */
function podSpecOf(kind: string, doc: YamlMap): { spec: unknown; labels: YamlMap } {
    const spec = doc['spec'];
    if (kind === 'Pod') return { spec, labels: yamlMap(field(doc['metadata'], 'labels')) };
    const template = kind === 'CronJob' ? field(field(field(spec, 'jobTemplate'), 'spec'), 'template') : field(spec, 'template');
    return { spec: field(template, 'spec'), labels: yamlMap(field(field(template, 'metadata'), 'labels')) };
}

const matches = (selector: YamlMap, labels: YamlMap): boolean =>
    Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => Object.hasOwn(labels, k) && str(labels[k]) === str(v));

/** The Services an Ingress routes to (`spec.rules[].http.paths[].backend.service.name`, and the v1beta1 `serviceName`). */
function ingressBackends(spec: unknown): string[] {
    const names: string[] = [];
    const add = (backend: unknown): void => {
        const n = str(field(field(backend, 'service'), 'name')) ?? str(field(backend, 'serviceName'));
        if (n) names.push(n);
    };
    add(field(spec, 'defaultBackend'));
    for (const rule of arr(field(spec, 'rules'))) for (const p of arr(field(field(rule, 'http'), 'paths'))) add(field(p, 'backend'));
    return names;
}

export function parseKubernetes(_path: string, text: string): DeployUnit[] {
    const units: DeployUnit[] = [];
    const workloads: Array<{ unit: DeployUnit; ns: string; labels: YamlMap }> = [];
    const services: Array<{ unit: DeployUnit; ns: string; selector: YamlMap }> = [];
    const ingresses: Array<{ unit: DeployUnit; ns: string; backends: string[] }> = [];
    for (const raw of parseYamlDocuments(text)) {
        const doc = yamlMap(raw);
        const kind = str(doc['kind']);
        const name = str(field(doc['metadata'], 'name'));
        if (!kind || !name || !str(doc['apiVersion'])) continue;
        const ns = str(field(doc['metadata'], 'namespace')) ?? 'default';
        const key = `${ns}/${kind}/${name}`;
        if (WORKLOADS.has(kind)) {
            const unit = emptyUnit(name, 'container', key);
            const { spec, labels } = podSpecOf(kind, doc);
            const containers = arr(field(spec, 'containers'));
            const image = str(field(containers[0], 'image'));
            if (image) unit.runtime = image;
            for (const c of containers) {
                for (const p of arr(field(c, 'ports'))) { const port = portOf(field(p, 'containerPort')); if (port) unit.ports.push(port); }
                unit.env.push(...envNames(arr(field(c, 'env'))));
            }
            for (const v of arr(field(spec, 'volumes'))) {
                const claim = str(field(field(v, 'persistentVolumeClaim'), 'claimName'));
                if (claim) unit.bindings.push({ kind: 'volume', name: claim });
            }
            const schedule = kind === 'CronJob' ? str(field(doc['spec'], 'schedule')) : undefined;
            if (schedule) unit.cron.push(schedule);
            unit.ports = uniq(unit.ports);
            unit.env = uniq(unit.env);
            workloads.push({ unit, ns, labels });
            units.push(unit);
        } else if (kind === 'Service') {
            const unit = emptyUnit(name, 'service', key);
            for (const p of arr(field(doc['spec'], 'ports'))) { const port = portOf(field(p, 'port')); if (port) unit.ports.push(port); }
            unit.ports = uniq(unit.ports);
            services.push({ unit, ns, selector: yamlMap(field(doc['spec'], 'selector')) });
            units.push(unit);
        } else if (kind === 'Ingress') {
            const unit = emptyUnit(name, 'service', key);
            ingresses.push({ unit, ns, backends: ingressBackends(doc['spec']) });
            units.push(unit);
        }
    }
    for (const { unit, ns, selector } of services) {
        unit.dependsOn = workloads.filter((w) => w.ns === ns && matches(selector, w.labels)).map((w) => w.unit.key);
    }
    for (const { unit, ns, backends } of ingresses) {
        unit.dependsOn = uniq(services.filter((s) => s.ns === ns && backends.includes(s.unit.name)).map((s) => s.unit.key));
    }
    return units;
}
