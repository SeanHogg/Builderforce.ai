/**
 * The compact COLUMN encoding of a BASE frame's stubs and mappings (`journalCompaction.ts`).
 *
 * A base holds every stub and every mapping, and both are enormous in count and repetitive in
 * content: 208k mappings and 177k stubs share a handful of destinations, devices and entity
 * types. As JSON objects each row repeats its keys and its destination; as columns each field
 * is one array and the repeated strings are written once, in a table, and referenced by index.
 * A stub or mapping costs ~70 bytes instead of ~250 — what keeps the main journal's base small
 * once the messages are out of it.
 *
 * A block decodes to EXACTLY the rows it was made from. A delta frame (one commit) keeps plain
 * objects: it carries a few rows, so there is nothing to win. `expandBlocks` runs when a frame
 * is read, so the state never sees a block, and a journal written without blocks reads as before.
 */

import type { EntityDestination, LocalEntityType, ServerMapping } from './records.js';
import type { LocalFirstDelta } from './localFirstDelta.js';
import type { RecordStub } from './recordPartition.js';

export interface StubBlock {
  /** Interned tables: a row names its entry by index. */
  types: string[];
  devices: string[];
  sources: string[];
  destinations: string[];
  id: string[];
  type: number[];
  home: Array<string | number>;
  version: number[];
  /** bit 0: deleted, bit 1: unbound. */
  flags: number[];
  device: number[];
  source: number[];
  destination: number[];
  /** Present only when some stub has an ordinal; `null` for one without. */
  ordinal?: Array<number | null>;
}

export interface MappingBlock {
  destinations: EntityDestination[];
  types: string[];
  destination: number[];
  type: number[];
  clientEntityId: string[];
  serverVersion: number[];
  /** `null` is an EXPLICIT null syncId; a row whose syncId is absent is listed in `noSyncId`. */
  syncId: Array<number | null>;
  noSyncId?: number[];
  /** `null`: absent. */
  mappedSeq: Array<number | null>;
  serverId: Array<string | null>;
  /** Sparse: `[row, text]` for the few rows that carry one (planning-tier tickets). */
  externalRef?: Array<[number, string]>;
}

/** A value table: `intern` returns the index of an equal value, adding it the first time. */
class Interner<V> {
  readonly table: V[] = [];
  private readonly indexes = new Map<string, number>();

  constructor(private readonly keyOf: (value: V) => string) {}

  intern(value: V): number {
    const key = this.keyOf(value);
    let index = this.indexes.get(key);
    if (index === undefined) {
      index = this.table.length;
      this.table.push(value);
      this.indexes.set(key, index);
    }
    return index;
  }
}

const text = (value: string): string => value;
const DELETED = 1;
const UNBOUND = 2;

export function encodeStubBlock(stubs: readonly RecordStub[]): StubBlock {
  const types = new Interner<string>(text);
  const devices = new Interner<string>(text);
  const sources = new Interner<string>(text);
  const destinations = new Interner<string>(text);
  const block: StubBlock = {
    types: types.table, devices: devices.table, sources: sources.table, destinations: destinations.table,
    id: [], type: [], home: [], version: [], flags: [], device: [], source: [], destination: [],
  };
  const ordinals: Array<number | null> = [];
  let anyOrdinal = false;
  for (const stub of stubs) {
    block.id.push(stub.id);
    block.type.push(types.intern(stub.entityType));
    block.home.push(stub.home);
    block.version.push(stub.version);
    block.flags.push((stub.deleted ? DELETED : 0) | (stub.unbound ? UNBOUND : 0));
    block.device.push(devices.intern(stub.deviceId));
    block.source.push(sources.intern(stub.source));
    block.destination.push(destinations.intern(stub.destinationKey));
    ordinals.push(stub.ordinal ?? null);
    anyOrdinal ||= stub.ordinal !== undefined;
  }
  if (anyOrdinal) block.ordinal = ordinals;
  return block;
}

export function decodeStubBlock(block: StubBlock): RecordStub[] {
  const stubs: RecordStub[] = [];
  for (let row = 0; row < block.id.length; row += 1) {
    const ordinal = block.ordinal?.[row];
    stubs.push({
      id: block.id[row]!,
      entityType: block.types[block.type[row]!]! as LocalEntityType,
      home: block.home[row]!,
      version: block.version[row]!,
      deleted: (block.flags[row]! & DELETED) !== 0,
      deviceId: block.devices[block.device[row]!]!,
      source: block.sources[block.source[row]!]!,
      destinationKey: block.destinations[block.destination[row]!]!,
      unbound: (block.flags[row]! & UNBOUND) !== 0,
      ...(ordinal !== undefined && ordinal !== null ? { ordinal } : {}),
    });
  }
  return stubs;
}

const MAPPING_KEYS = new Set(['destination', 'entityType', 'clientEntityId', 'syncId', 'serverVersion', 'externalRef', 'mappedSeq', 'serverId']);

/** A mapping the columns can hold without changing it: known keys, and the value types the columns carry. */
function isColumnar(mapping: ServerMapping): boolean {
  const loose = mapping as unknown as Record<string, unknown>;
  for (const key of Object.keys(loose)) if (!MAPPING_KEYS.has(key)) return false;
  return (loose.syncId === undefined || loose.syncId === null || typeof loose.syncId === 'number')
    && (loose.mappedSeq === undefined || typeof loose.mappedSeq === 'number')
    && (loose.serverId === undefined || typeof loose.serverId === 'string')
    && (loose.externalRef === undefined || typeof loose.externalRef === 'string');
}

/** The mappings as columns, or `undefined` when any of them has a shape the columns cannot reproduce (the caller writes them plain). */
export function encodeMappingBlock(mappings: readonly ServerMapping[]): MappingBlock | undefined {
  if (!mappings.every(isColumnar)) return undefined;
  const destinations = new Interner<EntityDestination>((destination) => JSON.stringify(destination));
  const types = new Interner<string>(text);
  const block: MappingBlock = {
    destinations: destinations.table, types: types.table,
    destination: [], type: [], clientEntityId: [], serverVersion: [], syncId: [], mappedSeq: [], serverId: [],
  };
  mappings.forEach((mapping, row) => {
    block.destination.push(destinations.intern(mapping.destination));
    block.type.push(types.intern(mapping.entityType));
    block.clientEntityId.push(mapping.clientEntityId);
    block.serverVersion.push(mapping.serverVersion);
    if (mapping.syncId === undefined) (block.noSyncId ??= []).push(row);
    block.syncId.push(mapping.syncId === undefined ? null : (mapping.syncId as number | null));
    block.mappedSeq.push(mapping.mappedSeq ?? null);
    block.serverId.push(mapping.serverId ?? null);
    if (mapping.externalRef !== undefined) (block.externalRef ??= []).push([row, mapping.externalRef]);
  });
  return block;
}

export function decodeMappingBlock(block: MappingBlock): ServerMapping[] {
  const noSyncId = new Set(block.noSyncId);
  const externalRefs = new Map(block.externalRef);
  const mappings: ServerMapping[] = [];
  for (let row = 0; row < block.clientEntityId.length; row += 1) {
    const mappedSeq = block.mappedSeq[row];
    const serverId = block.serverId[row];
    const externalRef = externalRefs.get(row);
    mappings.push({
      destination: block.destinations[block.destination[row]!]!,
      entityType: block.types[block.type[row]!]! as LocalEntityType,
      clientEntityId: block.clientEntityId[row]!,
      ...(noSyncId.has(row) ? {} : { syncId: block.syncId[row] as ServerMapping['syncId'] }),
      serverVersion: block.serverVersion[row]!,
      ...(externalRef !== undefined ? { externalRef } : {}),
      ...(mappedSeq !== null && mappedSeq !== undefined ? { mappedSeq } : {}),
      ...(serverId !== null && serverId !== undefined ? { serverId } : {}),
    });
  }
  return mappings;
}

/**
 * A read frame with its blocks decoded into plain `stubs` / `mappings` (the same object when it
 * has none). A block's rows come AFTER any plain rows the frame also carries.
 */
export function expandBlocks(delta: LocalFirstDelta): LocalFirstDelta {
  if (!delta.stubBlock && !delta.mappingBlock) return delta;
  const { stubBlock, mappingBlock, ...rest } = delta;
  return {
    ...rest,
    ...(stubBlock ? { stubs: [...(delta.stubs ?? []), ...decodeStubBlock(stubBlock)] } : {}),
    ...(mappingBlock ? { mappings: [...(delta.mappings ?? []), ...decodeMappingBlock(mappingBlock)] } : {}),
  };
}
