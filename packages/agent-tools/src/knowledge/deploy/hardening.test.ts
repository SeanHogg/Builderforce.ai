import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../jsonc.js';
import { MAX_DESCRIPTOR_CHARS, parseDescriptor } from './parseDescriptor.js';
import { deployParser } from './deployParser.js';
import { REDACTED, redactDescriptorText } from './redactDescriptor.js';
import { parseToml } from './tomlLite.js';
import { parseYaml, parseYamlDocuments } from './yamlLite.js';

const unitsOf = (path: string, text: string) => parseDescriptor(path, text)?.units ?? [];
const ms = (fn: () => void): number => { const t0 = performance.now(); fn(); return performance.now() - t0; };

describe('regression: prototype pollution', () => {
    it('TOML, YAML and descriptor parsing never write through __proto__ / constructor / prototype', () => {
        parseToml('[__proto__]\npolluted = "yes"\n[a.__proto__]\npolluted = "yes"\n__proto__.polluted = "yes"\nconstructor.prototype.polluted = "yes"\n[[__proto__.list]]\npolluted = 1\n');
        parseYaml('__proto__:\n  polluted: yes\nconstructor:\n  prototype:\n    polluted: yes\nx: { __proto__: { polluted: yes } }\n');
        parseDescriptor('wrangler.toml', '[__proto__]\npolluted = "yes"\n[vars]\n__proto__ = "x"\n');
        parseDescriptor('docker-compose.yml', 'services:\n  __proto__:\n    image: x\n    polluted: yes\n');
        parseDescriptor('package.json', '{ "__proto__": { "polluted": "yes" }, "bin": { "__proto__": "x.js" } }');
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
        expect(Object.prototype).not.toHaveProperty('polluted');
    });

    it('parsed records are prototype-free and keep no forbidden key', () => {
        const t = parseToml('[__proto__]\na = 1\n[ok]\nb = 2\n');
        expect(Object.getPrototypeOf(t)).toBeNull();
        expect(Object.keys(t)).toEqual(['ok']);
        const y = parseYaml('constructor: 1\nname: x\n') as Record<string, unknown>;
        expect(Object.keys(y)).toEqual(['name']);
    });
});

describe('regression: parser cost on hostile input', () => {
    it('TOML: 10,000 lines of an unclosed [ parse in linear time, and parseToml never throws', () => {
        const text = `x = [\n${'  "a",\n'.repeat(10_000)}`;
        expect(ms(() => parseToml(text))).toBeLessThan(200);
        for (const bad of ['[[', '[a', 'a = """', 'a = {', '= 1', '[a]]\n[[b]', 'a.b.c', '"\\']) expect(() => parseToml(bad)).not.toThrow();
    });

    it('YAML: deep nesting stops at the cap with a partial result; a long key-less line scans linearly', () => {
        const deep = Array.from({ length: 500 }, (_, i) => `${' '.repeat(i * 2)}k${i}:`).join('\n');
        expect(() => parseYamlDocuments(deep)).not.toThrow();
        const doc = parseYaml(deep) as Record<string, unknown>;
        expect(Object.keys(doc)).toEqual(['k0']);
        expect(ms(() => parseYaml(`a${' b'.repeat(50_000)}`))).toBeLessThan(200);
        expect(ms(() => parseYaml(`k: ${'x:'.repeat(50_000)}`))).toBeLessThan(200);
    });

    it('a descriptor over the byte cap gives no units and no indexed section', () => {
        const big = `FROM node:22\n${'# pad\n'.repeat(Math.ceil(MAX_DESCRIPTOR_CHARS / 6) + 1)}`;
        expect(unitsOf('Dockerfile', big)).toEqual([]);
        const doc = { id: 'Dockerfile', tenantId: 't', content: { kind: 'text' as const, text: big, mediaType: 'text/plain' } };
        expect(deployParser().parse(doc)).toEqual([]);
    });
});

describe('regression: no value of a descriptor reaches a unit', () => {
    const SECRET = 'sk_live_51Hs3cr3tV4lue';
    const cases: Array<[string, string]> = [
        ['Procfile', `web: API_TOKEN=${SECRET} node server.js\nworker: TOKEN=${SECRET} python w.py\n`],
        ['docker-compose.yml', `services:\n  api:\n    image: x\n    environment:\n      - STRIPE_KEY=${SECRET}\n      - OTHER="${SECRET}"\n`],
        ['k8s/api.yaml', `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          image: x\n          env:\n            - name: STRIPE_KEY\n              value: ${SECRET}\n`],
        ['Dockerfile', `FROM node:22\nARG NPM_TOKEN=${SECRET}\nENV API_KEY=${SECRET} OTHER="${SECRET}"\nENV LEGACY ${SECRET}\n`],
        ['wrangler.toml', `name = "w"\nmain = "src/index.ts"\n[vars]\nSTRIPE_KEY = "${SECRET}"\n[env.production.vars]\nTOKEN = "${SECRET}"\n`],
    ];
    for (const [path, text] of cases) {
        it(`${path}: names only`, () => {
            const units = unitsOf(path, text);
            expect(units.length, path).toBeGreaterThan(0);
            expect(JSON.stringify(units)).not.toContain(SECRET);
        });
    }

    it('Procfile: a KEY=value before the program is never the runtime', () => {
        expect(unitsOf('Procfile', `web: API_TOKEN=${SECRET} node server.js\n`)[0]?.runtime).toBe('node');
        expect(unitsOf('Procfile', `web: A=${SECRET} B=c\n`)[0]?.runtime).toBeUndefined();
    });

    it('the indexed section text keeps keys and structure, never a value', () => {
        const parser = deployParser();
        for (const [path, text] of cases) {
            const doc = { id: path, tenantId: 't', content: { kind: 'text' as const, text, mediaType: 'text/plain' } };
            const [section] = parser.parse(doc);
            expect(section?.text, path).not.toContain(SECRET);
            expect(section?.text, path).toContain(REDACTED);
        }
        const yaml = redactDescriptorText('compose', 'compose.yml', cases[1]![1], parseJsonc);
        expect(yaml).toContain('image: x');
        expect(yaml).toContain('STRIPE_KEY=***');
        const toml = redactDescriptorText('wrangler', 'wrangler.toml', cases[4]![1], parseJsonc);
        expect(toml).toContain('main = "src/index.ts"');
        expect(toml).toContain('STRIPE_KEY = "***"');
        const json = redactDescriptorText('package', 'package.json', `{ "name": "a", "scripts": { "start": "TOKEN=${SECRET} node x.js" }, "dependencies": { "zod": "^4" } }`, parseJsonc);
        expect(JSON.parse(json)).toEqual({ name: 'a', scripts: { start: REDACTED }, dependencies: { zod: '^4' } });
    });
});

describe('unit identity', () => {
    it('a repeated Procfile process keys by its line; the first keeps its key', () => {
        expect(unitsOf('Procfile', 'web: node a.js\nweb: node b.js\n').map((u) => u.key)).toEqual(['web', 'web@L2']);
    });

    it('k8s keys carry namespace and kind; a Service only selects workloads of its namespace', () => {
        const text = ['a', 'b'].map((ns) => `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: ${ns}\nspec:\n  template:\n    metadata:\n      labels:\n        app: web\n`).join('---\n')
            + '---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\n  namespace: b\nspec:\n  selector:\n    app: web\n';
        const units = unitsOf('k8s/web.yaml', text);
        expect(units.map((u) => u.key)).toEqual(['a/Deployment/web', 'b/Deployment/web', 'b/Service/web']);
        expect(units[2]!.dependsOn).toEqual(['b/Deployment/web']);
    });
});
