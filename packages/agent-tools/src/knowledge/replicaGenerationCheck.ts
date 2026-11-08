/**
 * knowledge/replicaGenerationCheck.ts — how a QUIET root (acked, nothing dirty) learns the server moved.
 *
 * A root with nothing to send never contacts the server, so it would never see that a heal invalidated one of its leaves
 * (the server advances the generation with it). It reads the server's GENERATION — one tiny request, not the 4,096-bucket
 * manifest — on pump start and then at most once per {@link GENERATION_CHECK_INTERVAL_MS}; a generation that differs from its
 * ack makes it reconcile. The read is a single attempt: a quiet root never waits out a backoff or reports "sending" for it.
 */

/** A quiet root asks for the server's generation at most this often (the host also starts a pump this often). */
export const GENERATION_CHECK_INTERVAL_MS = 10 * 60_000;

/** The reads a probe may use: the generation-only view when the client has it, else the manifest. */
export interface GenerationReader {
    syncGeneration?(rootId: string): Promise<{ generation: number }>;
    syncManifest(rootId: string): Promise<{ generation: number }>;
}

/** Whether a quiet root is due to ask: never asked yet (pump start), or the interval has passed. */
export const generationCheckDue = (lastCheckedAt: number | undefined, now: number): boolean =>
    lastCheckedAt === undefined || now - lastCheckedAt >= GENERATION_CHECK_INTERVAL_MS;

/** The server's generation for the root, from one un-retried read; undefined when it could not be read (asked again next cycle). */
export async function readServerGeneration(client: GenerationReader, rootId: string): Promise<number | undefined> {
    try {
        const answer = client.syncGeneration ? await client.syncGeneration(rootId) : await client.syncManifest(rootId);
        return answer.generation;
    } catch {
        return undefined;
    }
}
