/**
 * knowledge/codeConcurrency.ts — the concurrency a source file starts (the 4+1 Process view): threads, queues, Durable
 * Objects, schedules and pollers, as the file's `concurrency` badge — comma-joined `id` or `id:Owner` entries, sorted,
 * where Owner is the class or binding that holds it:
 *
 *   worker-thread             `worker_threads` / `new Worker(` / `new SharedWorker(` (not a BullMQ Worker)
 *   queue-producer[:BINDING]  Cloudflare `env.BINDING.send(` / `.sendBatch(` on a queue-named binding (never an email
 *                             one: `send_email` bindings also `.send(`), BullMQ `new Queue(`
 *   queue-consumer            an exported Worker's `queue(batch …)` handler, BullMQ `new Worker(`
 *   durable-object:Class      `class X extends / implements DurableObject` (on its header), or a class constructed
 *                             with `DurableObjectState`
 *   cron:scheduled            an exported Worker's `scheduled(` handler; `cron.schedule(` / `new CronJob(` give `cron`
 *   poller                    `setInterval(`
 *   thread                    Python `threading.Thread(` / `ThreadPoolExecutor` / `multiprocessing`
 *
 * Reads the text with comments AND string contents blanked (`maskSource(…).bare`), so a mention in a string or a
 * comment is no concurrency; module specifiers come in separately. Every pattern is bounded, so a file of thousands of
 * classes costs linear time. Deterministic, pure.
 */

import { compareStr } from '@seanhogg/builderforce-memory/knowledge';

/** Most entries one file's badge lists. */
const MAX_CONCURRENCY = 12;

/** A Workers binding that names a queue (and not mail: `send_email` bindings have a `.send(` too). */
const QUEUE_BINDING = /(?:^|_)(?:QUEUE|QUEUES|Q|JOBS?|TASKS?|EVENTS?|WORK|INGEST|OUTBOX|PIPELINE|MESSAGES?)(?:_|$)/;
const MAIL_BINDING = /MAIL|EMAIL|SMTP/;

/** The file exports a Worker handler: `export default { … }`, an exported class, or a `WorkerEntrypoint`. */
const WORKER_HANDLER = /\bexport\s+default\s+(?:\{|class\b)|\bextends\s+WorkerEntrypoint\b|\bsatisfies\s+ExportedHandler\b/;

/** Every `class X` header: its name, where it starts, and its text up to the body (bounded). */
function classHeaders(code: string): Array<{ name: string; at: number; header: string }> {
    return [...code.matchAll(/\bclass\s+([A-Za-z_$][\w$]{0,200})([^{;\n]{0,300})/g)].map((m) => ({ name: m[1]!, at: m.index ?? 0, header: m[2]! }));
}

/** The Durable Object classes: declared as one on the header, or constructed with a `DurableObjectState`. */
function durableObjects(code: string): string[] {
    const classes = classHeaders(code);
    const out = classes.filter((c) => /\b(?:extends|implements)\s+(?:[\w$]+\.)?DurableObject\b/.test(c.header)).map((c) => c.name);
    let k = -1;
    for (const m of code.matchAll(/\bconstructor\s*\([^)]{0,300}\bDurableObjectState\b/g)) {
        const at = m.index ?? 0;
        while (k + 1 < classes.length && classes[k + 1]!.at < at) k += 1;
        if (k >= 0) out.push(classes[k]!.name);
    }
    return out;
}

/** The concurrency entries of one file (`bare`: comments and strings blanked; `imports`: its module specifiers). */
export function concurrencyOf(bare: string, imports: readonly string[]): string[] {
    const out = new Set<string>();
    const bull = imports.some((i) => /^(bullmq|bull|bee-queue)(\/|$)/.test(i));
    if (imports.some((i) => /^(node:)?worker_threads$/.test(i)) || /\bnew\s+SharedWorker\s*\(/.test(bare)) out.add('worker-thread');
    if (/\bnew\s+Worker\s*\(/.test(bare)) out.add(bull ? 'queue-consumer' : 'worker-thread');
    if (bull && /\bnew\s+Queue\s*\(/.test(bare)) out.add('queue-producer');
    for (const m of bare.matchAll(/\benv\.([A-Z][A-Z0-9_]{0,63})\.send(?:Batch)?\s*\(/g)) {
        const binding = m[1]!;
        if (QUEUE_BINDING.test(binding) && !MAIL_BINDING.test(binding)) out.add(`queue-producer:${binding}`);
    }
    const handler = WORKER_HANDLER.test(bare);
    if (handler && /\bqueue\s*\(\s*\w{1,40}\s*:\s*MessageBatch\b|\basync\s+queue\s*\(\s*(?:batch|messages)\s*[,):]|\bqueue\s*:\s*async\s*\(\s*(?:batch|messages)\b/.test(bare)) out.add('queue-consumer');
    if (handler && /\basync\s+scheduled\s*\(|\bscheduled\s*\(\s*\w{1,40}\s*:\s*ScheduledEvent\b|\bscheduled\s*:\s*async\b/.test(bare)) out.add('cron:scheduled');
    for (const name of durableObjects(bare)) out.add(`durable-object:${name}`);
    if (/\bcron\.schedule\s*\(|\bnew\s+CronJob\s*\(|\bschedule\.scheduleJob\s*\(/.test(bare)) out.add('cron');
    if (/\bsetInterval\s*\(/.test(bare)) out.add('poller');
    if (/\bthreading\.Thread\s*\(|\bThreadPoolExecutor\s*\(|\bProcessPoolExecutor\s*\(|\bmultiprocessing\.Process\s*\(/.test(bare)) out.add('thread');
    return [...out].sort(compareStr).slice(0, MAX_CONCURRENCY);
}

/** The `concurrency` badge value, or undefined when the file starts none. */
export function concurrencyBadge(bare: string, imports: readonly string[]): string | undefined {
    const entries = concurrencyOf(bare, imports);
    return entries.length > 0 ? entries.join(',') : undefined;
}
