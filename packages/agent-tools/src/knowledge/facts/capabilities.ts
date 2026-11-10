/**
 * knowledge/facts/capabilities.ts — the capabilities a file reaches (PRD 41 §C5.3): process execution, filesystem
 * writes, network clients and servers, dynamic code, native addons, crypto (with the algorithm named at the call),
 * environment and secret reads. One table per language, as data; which algorithms are WEAK is run-delta registry data.
 *
 * A capability is recorded from what the file imports (the module grants it) and from the calls it makes with it, so a
 * file that imports `node:fs` only to read gets no `fs-write`.
 */

import type { CapabilityImportFact, CapabilityKind } from '@seanhogg/builderforce-memory/knowledge';
import { argsOf, calleeText, lastSegment, stringValue, walk, type FactNode } from './factsAst.js';

/** JS module → the capability importing it grants outright (calls refine fs and crypto below). */
const JS_MODULES: Readonly<Record<string, CapabilityKind>> = {
    child_process: 'process-exec', execa: 'process-exec', 'cross-spawn': 'process-exec',
    http: 'network-client', https: 'network-client', undici: 'network-client', axios: 'network-client', 'node-fetch': 'network-client', got: 'network-client',
    net: 'network-server', express: 'network-server', hono: 'network-server', fastify: 'network-server', koa: 'network-server', ws: 'network-server',
    vm: 'dynamic-code', bindings: 'native-addon', 'node-gyp-build': 'native-addon',
};
const FS_WRITES = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'unlink', 'unlinkSync',
    'rename', 'renameSync', 'createWriteStream', 'copyFile', 'copyFileSync', 'rmdir', 'rmdirSync', 'truncate', 'chmod']);
const CRYPTO_CALLS = new Set(['createHash', 'createHmac', 'createCipheriv', 'createDecipheriv', 'createCipher', 'createSign', 'pbkdf2', 'pbkdf2Sync']);
const SECRET_NAME = /SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL/i;

/** The package a specifier names: `node:fs/promises` → `fs`, `@scope/pkg/sub` → `@scope/pkg`. */
export const bare = (specifier: string): string => {
    const parts = specifier.replace(/^node:/, '').split('/');
    return parts[0]!.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]!;
};

const envRead = (name: string): CapabilityImportFact => ({ capability: SECRET_NAME.test(name) ? 'secret-read' : 'env-read', module: 'env', symbol: name });

/** The capabilities of a JS/TS file, from its import specifiers and the calls in `root`. */
export function jsCapabilities(root: FactNode, specifiers: readonly string[]): CapabilityImportFact[] {
    const out: CapabilityImportFact[] = [];
    const modules = new Set(specifiers.map(bare));
    for (const m of modules) {
        const capability = JS_MODULES[m];
        if (capability) out.push({ capability, module: m });
        if (m.endsWith('.node')) out.push({ capability: 'native-addon', module: m });
    }
    walk(root, (n) => {
        if (n.type === 'call_expression' || n.type === 'new_expression') {
            const callee = calleeText(n.childForFieldName(n.type === 'call_expression' ? 'function' : 'constructor'));
            const last = lastSegment(callee);
            if (callee === 'eval' || callee === 'Function') out.push({ capability: 'dynamic-code', module: 'global', symbol: callee });
            if (callee === 'fetch') out.push({ capability: 'network-client', module: 'global', symbol: 'fetch' });
            if (last === 'createServer') out.push({ capability: 'network-server', module: callee.split('.')[0] ?? '', symbol: 'createServer' });
            if ((modules.has('fs') || modules.has('fs-extra')) && FS_WRITES.has(last)) out.push({ capability: 'fs-write', module: 'fs', symbol: last });
            if (modules.has('crypto') && CRYPTO_CALLS.has(last)) {
                const algorithm = stringValue(argsOf(n)[0]);
                out.push({ capability: 'crypto', module: 'crypto', symbol: last, ...(algorithm ? { algorithm: algorithm.toLowerCase() } : {}) });
            }
            if (callee === 'Math.random') out.push({ capability: 'crypto', module: 'Math', symbol: 'random' });
        }
        if (n.type === 'member_expression') {
            const text = calleeText(n);
            if (text.startsWith('process.env.')) { out.push(envRead(text.slice('process.env.'.length).split('.')[0]!)); return false; }
        }
        // `const { A, B: b } = process.env`: each destructured name is a read.
        if (n.type === 'variable_declarator' && n.childForFieldName('name')?.type === 'object_pattern' && calleeText(n.childForFieldName('value')) === 'process.env') {
            for (const p of n.childForFieldName('name')!.namedChildren) {
                const key = p.type === 'pair_pattern' ? p.childForFieldName('key')?.text : p.type === 'shorthand_property_identifier_pattern' ? p.text : undefined;
                if (key) out.push(envRead(key));
            }
            return false;
        }
        if (n.type === 'subscript_expression' && calleeText(n.childForFieldName('object')) === 'process.env') {
            out.push(envRead(stringValue(n.childForFieldName('index')) ?? '*'));
            return false;
        }
    });
    return out;
}

/** Python module → capability. */
const PY_MODULES: Readonly<Record<string, CapabilityKind>> = {
    subprocess: 'process-exec', requests: 'network-client', httpx: 'network-client', urllib: 'network-client', aiohttp: 'network-client',
    flask: 'network-server', fastapi: 'network-server', django: 'network-server', socketserver: 'network-server', ctypes: 'native-addon', cffi: 'native-addon',
};
const PY_HASHES = new Set(['md5', 'sha1', 'sha256', 'sha512', 'new', 'blake2b']);

/** The capabilities of a Python file, from its imported modules and the calls in `root`. */
export function pythonCapabilities(root: FactNode, modules: readonly string[]): CapabilityImportFact[] {
    const out: CapabilityImportFact[] = [];
    const tops = new Set(modules.map((m) => m.replace(/^\.+/, '').split('.')[0]!).filter(Boolean));
    for (const m of tops) { const capability = PY_MODULES[m]; if (capability) out.push({ capability, module: m }); }
    walk(root, (n) => {
        if (n.type === 'call') {
            const callee = calleeText(n.childForFieldName('function'));
            const last = lastSegment(callee);
            if (callee === 'eval' || callee === 'exec' || callee === 'compile') out.push({ capability: 'dynamic-code', module: 'builtins', symbol: callee });
            if (callee === 'os.system' || callee.startsWith('os.popen') || callee.startsWith('os.exec')) out.push({ capability: 'process-exec', module: 'os', symbol: last });
            if (callee.startsWith('hashlib.') && PY_HASHES.has(last)) {
                const algorithm = last === 'new' ? stringValue(argsOf(n)[0]) : last;
                out.push({ capability: 'crypto', module: 'hashlib', symbol: last, ...(algorithm ? { algorithm: algorithm.toLowerCase() } : {}) });
            }
            if (callee === 'os.getenv' || callee === 'os.environ.get') out.push(envRead(stringValue(argsOf(n)[0]) ?? '*'));
            if (callee === 'random.random' || callee === 'random.randint') out.push({ capability: 'crypto', module: 'random', symbol: last });
        }
        if (n.type === 'subscript' && calleeText(n.childForFieldName('value')) === 'os.environ') {
            out.push(envRead(stringValue(n.childForFieldName('subscript')) ?? '*'));
            return false;
        }
    });
    return out;
}
