/**
 * What sits NEXT TO the modules a build loaded and can change how they compile or resolve, though
 * Rollup never loads it as a module (`buildInputs.mjs` hashes what this finds):
 *
 *   - the nearest `package.json` (exports, `sideEffects`, `type`) and nearest `tsconfig.json`
 *     (jsx, target, paths) of every module, plus each tsconfig's `extends` chain;
 *   - the sorted file listing of every module's directory, so a NEW file that shadows an import
 *     (`foo.ts` beside `foo.tsx`, a new `index.ts`) changes the answer.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const CONFIG_NAMES = ['package.json', 'tsconfig.json'];

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** `name` in `dir` or its nearest ancestor; null when there is none. Cached per (name, dir). */
function nearestUp(dir, name, cache) {
  const key = `${name}\0${dir}`;
  if (cache.has(key)) return cache.get(key);
  const candidate = path.join(dir, name);
  const parent = path.dirname(dir);
  const found = isFile(candidate) ? candidate : parent === dir ? null : nearestUp(parent, name, cache);
  cache.set(key, found);
  return found;
}

/** JSON-with-comments and trailing commas (tsconfig's dialect) -> value. Strings are left alone. */
function parseTsconfig(text) {
  const stripped = text.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => (match.startsWith('"') ? match : ''));
  return JSON.parse(stripped.replace(/,(\s*[}\]])/g, '$1'));
}

/** The files a tsconfig's `extends` names, relative ones and installed packages alike. */
function extendedConfigs(tsconfig) {
  const raw = parseTsconfig(fs.readFileSync(tsconfig, 'utf8')).extends;
  const names = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  const found = [];
  for (const name of names) {
    const candidates = name.startsWith('.') || path.isAbsolute(name)
      ? [path.resolve(path.dirname(tsconfig), name), path.resolve(path.dirname(tsconfig), `${name}.json`)]
      : [name, `${name}.json`];
    for (const candidate of candidates) {
      try {
        const resolved = name.startsWith('.') || path.isAbsolute(name) ? candidate : createRequire(tsconfig).resolve(candidate);
        if (isFile(resolved)) {
          found.push(resolved);
          break;
        }
      } catch {
        // try the next spelling; an extends that resolves nowhere fails tsc, not this stamp
      }
    }
  }
  return found;
}

/** Nearest package.json and tsconfig.json of every file, with each tsconfig's `extends` chain. */
export function nearestConfigFiles(files) {
  const cache = new Map();
  const out = new Set();
  const tsconfigs = new Set();
  for (const dir of new Set([...files].map((file) => path.dirname(file)))) {
    for (const name of CONFIG_NAMES) {
      const found = nearestUp(dir, name, cache);
      if (!found) continue;
      out.add(found);
      if (name === 'tsconfig.json') tsconfigs.add(found);
    }
  }
  // Every file an `extends` names is itself a tsconfig, whatever it is called.
  for (const tsconfig of tsconfigs) {
    for (const extended of extendedConfigs(tsconfig)) {
      if (out.has(extended)) continue;
      out.add(extended);
      tsconfigs.add(extended); // a Set iterates what is added while looping
    }
  }
  return out;
}

/** `{ directory: sha256 of its sorted entry names }` for each directory that holds one of `files`. */
export function directoryListings(files) {
  const out = new Map();
  for (const dir of new Set([...files].map((file) => path.dirname(file)))) {
    let names;
    try {
      names = fs.readdirSync(dir).sort();
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      out.set(dir, 'missing');
      continue;
    }
    out.set(dir, createHash('sha256').update(names.join('\n')).digest('hex'));
  }
  return out;
}
