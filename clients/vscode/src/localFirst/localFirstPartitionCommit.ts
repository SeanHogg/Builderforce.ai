/**
 * The commit protocol of a partitioned store (AE-G031 "Commit order"), under the cross-window lock the
 * caller already holds and with the main journal caught up:
 *
 *   1. each partition the delta touches: truncate the file to the caught-up POINTER, append the frame
 *      (stamped with the commit's `commitSeq`) and fsync; a new file also fsyncs its directory;
 *   2. the caller appends the MAIN frame this module returns — stub changes plus each touched partition's
 *      new length. THAT is the commit point;
 *   3. a main append that fails changes nothing here: the pointers this module tracks move only in
 *      `committed`, so the next commit truncates the leftover (and a first commit of a new partition reuses
 *      the file it already named).
 *
 * `PointerTracker` is the host's own mirror of the state's pointers. A commit needs the pointer of every
 * partition it touches, and `view()` would build every stub of the store to give it.
 */

import {
  encodeDeltaFrame,
  encodeJournalFrame,
  mintJournalGeneration,
  partitionTypeOf,
  splitPartitionedDelta,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
  type PartitionDeclaration,
  type PartitionPointer,
} from "@builderforce/local-first";
import { appendPartitionFrame, PartitionDamagedError } from "./localFirstPartitionFiles";
import { asVsixPointer, partitionFileName, partitionRelativePath, type VsixPartitionPointer } from "./localFirstPartitionNames";

/** The pointers the committed state holds, kept in step with every delta this store applies. */
export class PointerTracker {
  private readonly pointers = new Map<string, VsixPartitionPointer>();
  private maxSeq = 0;

  get(id: string): VsixPartitionPointer | undefined {
    return this.pointers.get(id);
  }

  entries(): IterableIterator<[string, VsixPartitionPointer]> {
    return this.pointers.entries();
  }

  /** Every file a pointer names, relative to the store directory. */
  files(): Set<string> {
    return new Set([...this.pointers.values()].map((pointer) => pointer.file));
  }

  /** The sequence the next partition frame carries: one above every sequence a pointer holds. */
  nextCommitSeq(): number {
    return this.maxSeq + 1;
  }

  /** A delta the state is about to apply (or has applied): a reset starts over, a pointer moves. */
  apply(delta: Pick<LocalFirstDelta, "reset" | "partitionPointers">): void {
    if (delta.reset) this.seed(undefined);
    for (const [id, pointer] of Object.entries(delta.partitionPointers ?? {})) this.set(id, pointer);
  }

  /** Adopt the pointers of a loaded or rebuilt state. */
  seed(pointers: Readonly<Record<string, PartitionPointer>> | undefined): void {
    this.pointers.clear();
    this.maxSeq = 0;
    for (const [id, pointer] of Object.entries(pointers ?? {})) this.set(id, pointer);
  }

  private set(id: string, pointer: PartitionPointer): void {
    const wide = asVsixPointer(pointer);
    this.pointers.set(id, wide);
    if (wide.commitSeq > this.maxSeq) this.maxSeq = wide.commitSeq;
  }
}

export interface PartitionCommitPorts {
  directory: string;
  pointers: PointerTracker;
  /** The entity types this build partitions. */
  types: readonly Pick<PartitionDeclaration, "entityType">[];
  /** A partition file is not what its pointer says. Reported, never thrown from here. */
  onDamaged(partitionId: string, pointer: VsixPartitionPointer, reason: string): void;
}

export interface PartitionCommit {
  /**
   * Write the delta's partition frames and return the MAIN frame. Sets `delta.partitionPointers` on the delta
   * itself (the state applies that same object once the main frame is durable). `first`: the main journal is
   * empty, so its first frame is a whole snapshot (`snapshotAfter`).
   */
  prepare(delta: LocalFirstDelta, first: boolean, snapshotAfter: (delta: LocalFirstDelta) => LocalFirstSnapshot): Promise<Uint8Array>;
  /** The main frame is durable and the state has (or is about to have) the delta. */
  committed(delta: LocalFirstDelta): void;
}

export function createPartitionCommit(ports: PartitionCommitPorts): PartitionCommit {
  /** A partition first written by a commit that has not reached main yet: its retry reuses the file. */
  const fresh = new Map<string, { file: string; generation: string }>();

  const targetOf = (id: string, prior: VsixPartitionPointer | undefined): { file: string; generation: string } => {
    if (prior) return { file: prior.file, generation: prior.generation ?? "" };
    let target = fresh.get(id);
    if (!target) {
      const generation = mintJournalGeneration();
      const home = id.slice(id.indexOf("\u0000") + 1);
      target = { file: partitionRelativePath(partitionFileName(partitionTypeOf(id), home, generation)), generation };
      fresh.set(id, target);
    }
    return target;
  };

  return {
    async prepare(delta, first, snapshotAfter) {
      const { main, partitions } = splitPartitionedDelta(delta, ports.types);
      if (partitions.size > 0) {
        const commitSeq = ports.pointers.nextCommitSeq();
        const moved: Record<string, VsixPartitionPointer> = {};
        for (const [id, part] of partitions) {
          const prior = ports.pointers.get(id);
          const target = targetOf(id, prior);
          // `commitSeq` is the frame's first key: a reader can find it without parsing the rows.
          const frame = encodeDeltaFrame({ commitSeq, ...part } as LocalFirstDelta);
          let length: number;
          try {
            length = await appendPartitionFrame(ports.directory, target.file, frame, prior?.length ?? 0, !prior);
          } catch (error) {
            if (error instanceof PartitionDamagedError && prior) ports.onDamaged(id, prior, error.message);
            throw error;
          }
          moved[id] = {
            file: target.file,
            length,
            generation: target.generation,
            commitSeq,
            base: prior?.base ?? 0,
            tailFrames: (prior?.tailFrames ?? 0) + 1,
          };
        }
        const pointers = { ...(delta.partitionPointers ?? {}), ...moved };
        delta.partitionPointers = pointers;
        main.partitionPointers = pointers;
      }
      return first ? encodeJournalFrame(snapshotAfter(main)) : encodeDeltaFrame(main);
    },
    committed(delta) {
      fresh.clear();
      ports.pointers.apply(delta);
    },
  };
}
