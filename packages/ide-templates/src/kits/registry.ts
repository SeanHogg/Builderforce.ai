/**
 * The starter-kit part registry — the ONE list of frontends, backends and extras.
 *
 * Hosts build the `/starter-kit` composer command and its `/help` text from
 * {@link listKitOptions}; nothing else lists kits or parts (PRD 31 §W11, Rev 2 item 4:
 * this package is private, so published packages take the entries the host injects).
 */
import type { KitPart, KitPartKind } from './types';
import { AGENTS } from './parts/agents';
import { ANGULAR_PART } from './parts/angular';
import { DOTNET_MINIMAL } from './parts/dotnetMinimal';
import { LARAVEL } from './parts/laravel';
import { NODE_EXPRESS } from './parts/nodeExpress';
import { POSTGRES } from './parts/postgres';
import { PYTHON_FASTAPI } from './parts/pythonFastapi';
import { REACT_VITE } from './parts/reactVite';
import { VUE_VITE } from './parts/vueVite';

const PARTS: readonly KitPart[] = [REACT_VITE, ANGULAR_PART, VUE_VITE, NODE_EXPRESS, PYTHON_FASTAPI, LARAVEL, DOTNET_MINIMAL, POSTGRES, AGENTS];

/** Every part, by canonical id. */
export const KIT_PARTS: Readonly<Record<string, KitPart>> = Object.fromEntries(PARTS.map((part) => [part.id, part]));

/** The kits named in the W11 acceptance matrix. Any frontend × backend pair whose parts exist is accepted too. */
export const NAMED_KITS: readonly string[] = ['react-node', 'angular-node', 'react-laravel', 'react-dotnet', 'react-fastapi', 'vue-node'];

const BY_NAME: ReadonlyMap<string, KitPart> = new Map(
  PARTS.flatMap((part) => [[part.id, part] as const, ...(part.aliases ?? []).map((alias) => [alias, part] as const)]),
);

/** The part a canonical id or alias names, when it is of `kind`. */
export function findKitPart(name: string, kind: KitPartKind): KitPart | undefined {
  const part = BY_NAME.get(name.trim().toLowerCase());
  return part?.kind === kind ? part : undefined;
}

export interface KitPartOption {
  id: string;
  label: string;
  aliases: readonly string[];
}

export interface KitOptions {
  frontends: KitPartOption[];
  backends: KitPartOption[];
  extras: KitPartOption[];
  namedKits: readonly string[];
}

const optionsOf = (kind: KitPartKind): KitPartOption[] =>
  PARTS.filter((part) => part.kind === kind).map((part) => ({ id: part.id, label: part.label, aliases: part.aliases ?? [] }));

/** What `/starter-kit` accepts, for the command entry and its `/help` text. */
export function listKitOptions(): KitOptions {
  return { frontends: optionsOf('frontend'), backends: optionsOf('backend'), extras: optionsOf('extra'), namedKits: NAMED_KITS };
}
