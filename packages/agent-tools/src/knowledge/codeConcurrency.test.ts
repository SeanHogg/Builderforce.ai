import { describe, expect, it } from 'vitest';
import { concurrencyBadge, concurrencyOf } from './codeConcurrency.js';
import { importSpecifiers } from './codePatterns.js';
import { maskSource } from './codeMask.js';

const of = (text: string): string[] => {
    const { code, bare } = maskSource(text, 'js');
    return concurrencyOf(bare, importSpecifiers(code));
};

describe('concurrency detection', () => {
    it('finds an exported Worker scheduled handler, a queue consumer and queue producers by binding', () => {
        const text = `export default {
  async fetch(req: Request, env: Env) { await env.JOBS.send({ id: 1 }); await env.EVENTS_QUEUE.sendBatch([]); return new Response('ok'); },
  async queue(batch: MessageBatch, env: Env) { for (const m of batch.messages) m.ack(); },
  async scheduled(event: ScheduledEvent) { void event; },
};`;
        expect(of(text)).toEqual(['cron:scheduled', 'queue-consumer', 'queue-producer:EVENTS_QUEUE', 'queue-producer:JOBS']);
    });

    it('names the Durable Object class, either declared form', () => {
        expect(of('export class ChatRoom {\n  private state: DurableObjectState;\n  constructor(state: DurableObjectState) { this.state = state; }\n}\n'))
            .toEqual(['durable-object:ChatRoom']);
        expect(of("import { DurableObject } from 'cloudflare:workers';\nexport class Counter extends DurableObject<Env> {}\n"))
            .toEqual(['durable-object:Counter']);
    });

    it('tells worker threads from BullMQ workers, and finds pollers and cron libraries', () => {
        expect(of("import { Worker } from 'node:worker_threads';\nnew Worker('./w.js');\n")).toEqual(['worker-thread']);
        expect(of("import { Queue, Worker } from 'bullmq';\nconst q = new Queue('mail');\nnew Worker('mail', async () => {});\n"))
            .toEqual(['queue-consumer', 'queue-producer']);
        expect(of("import cron from 'node-cron';\ncron.schedule('* * * * *', tick);\nsetInterval(poll, 5000);\n")).toEqual(['cron', 'poller']);
    });

    it('ignores mentions inside comments and strings, and gives no badge to a file that starts nothing', () => {
        expect(of('// setInterval(poll, 1000)\n/* new Worker("x") */\nexport const x = 1;\n')).toEqual([]);
        expect(of('export const help = "call setInterval(f) or new Worker(url) or class A extends DurableObject";\n')).toEqual([]);
        expect(concurrencyBadge('export const x = 1;', [])).toBeUndefined();
        expect(concurrencyBadge('setInterval(f, 1);', [])).toBe('poller');
    });

    it('regression: an email binding .send() is no queue producer, and scheduled()/queue() count only on an exported Worker handler', () => {
        expect(of('export default { async fetch(r: Request, env: Env) { await env.SEND_EMAIL.send(msg); await env.MAILER.send(m); } };')).toEqual([]);
        // A service method merely called `queue` / `scheduled` (hired.video's AdminArticleReviewService) is not a handler.
        expect(of('export class ReviewService {\n  async queue(status: string, limit: number) { return []; }\n  async scheduled(event: unknown) { return event; }\n}\n')).toEqual([]);
        expect(of('class Api extends WorkerEntrypoint { async scheduled(event: ScheduledEvent) {} }')).toEqual(['cron:scheduled']);
    });

    it('perf: 8,000 classes and constructors scan in linear time', () => {
        const text = Array.from({ length: 8000 }, (_, i) => `class C${i} extends Base {\n  constructor(state: DurableObjectState) { super(); }\n}\n`).join('');
        const { code, bare } = maskSource(text, 'js');
        const t0 = performance.now();
        const entries = concurrencyOf(bare, importSpecifiers(code));
        expect(performance.now() - t0).toBeLessThan(200);
        expect(entries.length).toBe(12);
    });
});
