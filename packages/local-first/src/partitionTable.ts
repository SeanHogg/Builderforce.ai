/**
 * The partition half of the committed state: what the store knows of every partitioned row
 * (its STUB), where each partition is stored (its POINTER, opaque to this package), which
 * partitions are in memory (SEGMENTS) and which types are partitioned (DECLARATIONS).
 *
 * A segment holds ONE partition's rows — one entity type, one home — so its Map order is that
 * partition's committed order. Partitioned rows are never in `CommittedState.records`.
 *
 * Keeping segments current is two steps that never block a commit:
 *   - `CommittedState.applyDelta` stays synchronous. Rows of a loaded segment are applied to
 *     it; a loaded segment whose pointer moved WITHOUT its rows in the delta is marked stale.
 *   - every partitioned read first awaits `load`, ONE in-flight catch-up per partition: read
 *     from the segment's loaded position to the current pointer, install only if the pointer
 *     is unchanged since the read began, otherwise read again.
 * With no `PartitionLoader` every partition is resident: a segment is created by the first row
 * written to it and nothing is ever read back, so there is ONE code path either way.
 */

import type { LocalEntityType, LocalRecord } from './records.js';
import type { LocalFirstDelta } from './localFirstDelta.js';
import type { LocalFirstSnapshot } from './storeContract.js';
import {
  partitionDeclarationOf,
  partitionIdOf,
  partitionTypeOf,
  type PartitionDeclaration,
  type PartitionLoader,
  type PartitionPointer,
  type RecordPartition,
  type RecordStub,
} from './recordPartition.js';

/** One partition's rows in memory, and how far they were read. */
export class PartitionSegment {
  readonly records = new Map<string, LocalRecord>();
  /** The pointer these rows are current to. `undefined`: created in memory, never read from storage. */
  loadedTo: PartitionPointer | undefined;
  /** The partition's pointer moved past `loadedTo` without the rows: a read must catch up first. */
  stale = false;
}

const samePointer = (a: PartitionPointer | undefined, b: PartitionPointer | undefined): boolean =>
  a === b || (!!a && !!b && a.file === b.file && a.length === b.length && a.generation === b.generation);

/** A segment can resume from `from` only inside the same file generation, and never backwards. */
const resumable = (from: PartitionPointer, to: PartitionPointer): boolean =>
  from.file === to.file && from.generation === to.generation && from.length <= to.length;

export class PartitionTable {
  /** The partitions THIS build declares (store options): what routes a new write. */
  private readonly active = new Map<LocalEntityType, RecordPartition>();
  private loader: PartitionLoader | undefined;
  private readonly stubs = new Map<LocalEntityType, Map<string, RecordStub>>();
  private readonly pointers = new Map<string, PartitionPointer>();
  /** The declarations the journal persisted, whatever this build declares. */
  private readonly declarations = new Map<LocalEntityType, PartitionDeclaration>();
  private readonly segments = new Map<string, PartitionSegment>();
  /** Every partition id seen, by type, in first-seen order: a whole-type read loads exactly these. */
  private readonly idsByType = new Map<LocalEntityType, Set<string>>();
  private readonly inflight = new Map<string, Promise<void>>();

  configure(partitions: readonly RecordPartition[], loader: PartitionLoader | undefined): void {
    this.active.clear();
    for (const partition of partitions) this.active.set(partition.index.entityType, partition);
    this.loader = loader;
  }

  /** Whether any type is partitioned: a store with none pays nothing for this table. */
  get enabled(): boolean {
    return this.active.size > 0 || this.declarations.size > 0 || this.stubs.size > 0;
  }

  /** Whether reads of `entityType` must consult stubs and segments. */
  concerns(entityType: LocalEntityType): boolean {
    return this.active.has(entityType) || this.declarations.has(entityType) || this.stubs.has(entityType);
  }

  partitionOf(entityType: LocalEntityType): RecordPartition | undefined {
    return this.active.get(entityType);
  }

  /** A type the journal declared partitioned cannot be written by a build that does not declare it: its rows would split. */
  assertWritable(entityType: LocalEntityType): void {
    if (this.declarations.has(entityType) && !this.active.has(entityType)) {
      throw new Error(`local_first_partition_undeclared: ${entityType} is partitioned in this store but not declared by this build`);
    }
  }

  stub(entityType: LocalEntityType, id: string): RecordStub | undefined {
    return this.stubs.get(entityType)?.get(id);
  }

  stubsOf(entityType: LocalEntityType): ReadonlyMap<string, RecordStub> | undefined {
    return this.stubs.get(entityType);
  }

  pointer(partitionId: string): PartitionPointer | undefined {
    return this.pointers.get(partitionId);
  }

  segment(partitionId: string): PartitionSegment | undefined {
    return this.segments.get(partitionId);
  }

  /** Every partition of `entityType` the state knows of, in first-seen order. */
  partitionIdsOf(entityType: LocalEntityType): readonly string[] {
    return [...(this.idsByType.get(entityType) ?? [])];
  }

  allPartitionIds(): string[] {
    return [...this.idsByType.values()].flatMap((ids) => [...ids]);
  }

  /** The IN-MEMORY segments of a type, in partition order. */
  segmentsOf(entityType: LocalEntityType): PartitionSegment[] {
    const found: PartitionSegment[] = [];
    for (const id of this.idsByType.get(entityType) ?? []) {
      const segment = this.segments.get(id);
      if (segment) found.push(segment);
    }
    return found;
  }

  /** Every in-memory partitioned row, by partition. */
  *loadedRows(): IterableIterator<LocalRecord> {
    for (const segment of this.segments.values()) yield* segment.records.values();
  }

  /** The declarations of `types` this build holds that the journal has not persisted yet. */
  missingDeclarations(types: Iterable<LocalEntityType>): PartitionDeclaration[] {
    const missing: PartitionDeclaration[] = [];
    for (const type of new Set(types)) {
      const partition = this.active.get(type);
      if (partition && !this.declarations.has(type)) missing.push(partitionDeclarationOf(partition));
    }
    return missing;
  }

  // --- applying a commit (synchronous) -------------------------------------------------------

  declare(declarations: readonly PartitionDeclaration[] | undefined): void {
    for (const declaration of declarations ?? []) this.declarations.set(declaration.entityType, declaration);
  }

  /** Move pointers; returns the partitions whose pointer actually changed. */
  setPointers(pointers: Readonly<Record<string, PartitionPointer>> | undefined): string[] {
    const moved: string[] = [];
    for (const [id, pointer] of Object.entries(pointers ?? {})) {
      if (!samePointer(this.pointers.get(id), pointer)) moved.push(id);
      this.pointers.set(id, pointer);
      this.touch(partitionTypeOf(id), id);
    }
    return moved;
  }

  /**
   * Record a stub. A row whose home changed leaves its old partition's segment: the stub says
   * where it lives now, and a segment must never hold a row its stub files elsewhere.
   */
  putStub(stub: RecordStub): void {
    let rows = this.stubs.get(stub.entityType);
    if (!rows) this.stubs.set(stub.entityType, (rows = new Map()));
    const id = partitionIdOf(stub.entityType, stub.home);
    const prior = rows.get(stub.id);
    if (prior) {
      const priorId = partitionIdOf(prior.entityType, prior.home);
      if (priorId !== id) this.segments.get(priorId)?.records.delete(stub.id);
    }
    rows.set(stub.id, stub);
    this.touch(stub.entityType, id);
  }

  /**
   * Commit one partitioned row: its stub always, its row into its segment when that is in
   * memory. A partition that is in storage but not in memory is NOT filled from here (a later
   * load reads the row from its file); one that exists nowhere yet starts empty and resident.
   * `carried` collects the partitions whose ROWS this commit applied (see `settle`). `keep`:
   * the row came from memory, not from a delta, so it is never dropped for an unloaded partition.
   */
  applyRow(stub: RecordStub, record: LocalRecord, carried: Set<string>, keep = false): void {
    this.putStub(stub);
    const id = partitionIdOf(stub.entityType, stub.home);
    let segment = this.segments.get(id);
    if (!segment) {
      if (!keep && this.loader && this.pointers.has(id)) return;
      segment = this.createSegment(id);
    }
    segment.records.set(record.id, record);
    carried.add(id);
  }

  /** Remove a partitioned row and its stub. `carried` is given when the delta carried the row's deletion itself. */
  deleteRow(entityType: LocalEntityType, id: string, carried?: Set<string>): void {
    const stub = this.stubs.get(entityType)?.get(id);
    if (!stub) return;
    const partitionId = partitionIdOf(entityType, stub.home);
    const segment = this.segments.get(partitionId);
    segment?.records.delete(id);
    if (segment && carried) carried.add(partitionId);
    this.stubs.get(entityType)!.delete(id);
  }

  /**
   * After a delta: a loaded segment whose pointer moved is current to it only when the delta
   * carried its rows (and the segment was not already behind); otherwise it is stale.
   */
  settle(moved: readonly string[], carried: ReadonlySet<string>): void {
    for (const id of moved) {
      const segment = this.segments.get(id);
      if (!segment) continue;
      if (carried.has(id) && !segment.stale) segment.loadedTo = this.pointers.get(id);
      else segment.stale = true;
    }
  }

  /** Adopt the partition state of a snapshot (`CommittedState.from`). */
  restore(initial: Partial<Pick<LocalFirstSnapshot, 'stubs' | 'partitionPointers' | 'partitionDeclarations'>>): void {
    this.declare(initial.partitionDeclarations);
    this.setPointers(initial.partitionPointers);
    for (const stub of initial.stubs ?? []) this.putStub(stub);
  }

  /** Only the parts that exist: a store with no partitions snapshots exactly as it always did. */
  view(): Pick<LocalFirstSnapshot, 'stubs' | 'partitionPointers' | 'partitionDeclarations'> {
    const view: Pick<LocalFirstSnapshot, 'stubs' | 'partitionPointers' | 'partitionDeclarations'> = {};
    const stubs: RecordStub[] = [];
    for (const rows of this.stubs.values()) for (const stub of rows.values()) stubs.push(stub);
    if (stubs.length > 0) view.stubs = stubs;
    if (this.pointers.size > 0) view.partitionPointers = Object.fromEntries(this.pointers);
    if (this.declarations.size > 0) view.partitionDeclarations = [...this.declarations.values()];
    return view;
  }

  /** A reset drops every segment (the reset's own stubs and pointers refill what is known). */
  clear(): void {
    this.stubs.clear();
    this.pointers.clear();
    this.declarations.clear();
    this.segments.clear();
    this.idsByType.clear();
  }

  // --- loading (asynchronous, never a commit) --------------------------------------------------

  /**
   * Bring these partitions' segments current. Returns nothing to await when they already are
   * (or there is no loader: everything is resident), so a read of an in-memory partition costs
   * no extra turn. A load fills memory only: it is not a commit and notifies nobody.
   */
  load(partitionIds: Iterable<string>): Promise<void> | undefined {
    if (!this.loader) return undefined;
    let waits: Promise<void>[] | undefined;
    for (const id of partitionIds) {
      const wait = this.catchUp(id);
      if (wait) (waits ??= []).push(wait);
    }
    return waits && Promise.all(waits).then(() => undefined);
  }

  private catchUp(id: string): Promise<void> | undefined {
    const running = this.inflight.get(id);
    if (running) return running;
    if (!this.behind(id)) return undefined;
    const run = this.readUntilCurrent(id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, run);
    return run;
  }

  /** A partition with no pointer exists nowhere but memory (or nowhere at all): there is nothing to read. */
  private behind(id: string): boolean {
    const pointer = this.pointers.get(id);
    if (!pointer) return false;
    const segment = this.segments.get(id);
    return !segment || segment.stale || !samePointer(segment.loadedTo, pointer);
  }

  private async readUntilCurrent(id: string): Promise<void> {
    for (;;) {
      const pointer = this.pointers.get(id);
      if (!pointer) return; // a reset dropped it while this read ran
      const segment = this.segments.get(id);
      const from = segment?.loadedTo && resumable(segment.loadedTo, pointer) ? segment.loadedTo : undefined;
      const read = await this.loader!.load(id, pointer, from && { file: from.file, length: from.length });
      // The pointer moved (a commit, another window's tail, a reset) while this read ran, or the
      // segment it was resuming was replaced: what was read is older than the state, so read again.
      if (!samePointer(this.pointers.get(id), pointer) || this.segments.get(id) !== segment) continue;
      this.install(id, pointer, read, from === undefined);
      return;
    }
  }

  /**
   * Drop loaded segments so the next read of each loads it whole. A host calls it when a read
   * left a partition's memory in doubt (a recovery). A partition with no pointer exists only in
   * memory, and a store with no loader holds every row only in memory: neither is evicted.
   */
  evict(partitionIds: Iterable<string>): void {
    if (!this.loader) return;
    for (const id of partitionIds) if (this.pointers.has(id)) this.segments.delete(id);
  }

  /** Called only with a RESOLVED read: a loader that failed rejected, so nothing wrong is ever installed. */
  private install(id: string, pointer: PartitionPointer, read: LocalFirstDelta, whole: boolean): void {
    let segment = this.segments.get(id);
    if (!segment || whole) segment = this.createSegment(id);
    // A file can hold a row its stub has since moved elsewhere (or never had): the stub is the truth.
    const belongs = (record: LocalRecord): boolean => {
      const stub = this.stubs.get(record.entityType)?.get(record.id);
      return !!stub && partitionIdOf(stub.entityType, stub.home) === id;
    };
    for (const gone of read.deletedRecords ?? []) segment.records.delete(gone.id);
    for (const record of read.records ?? []) if (belongs(record)) segment.records.set(record.id, record);
    segment.loadedTo = pointer;
    segment.stale = false;
  }

  private createSegment(id: string): PartitionSegment {
    const segment = new PartitionSegment();
    this.segments.set(id, segment);
    this.touch(partitionTypeOf(id), id);
    return segment;
  }

  private touch(entityType: LocalEntityType, id: string): void {
    let ids = this.idsByType.get(entityType);
    if (!ids) this.idsByType.set(entityType, (ids = new Set()));
    ids.add(id);
  }
}
