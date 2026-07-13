/**
 * Native event stream — the pi-free replacement for `@mariozechner/pi-ai`'s
 * `EventStream`/`AssistantMessageEventStream`/`createAssistantMessageEventStream`
 * (PI cutover, loop stage). A pushable async-iterable queue: producers `push()` events
 * and `end()`; consumers `for await` over it and `await result()` for the terminal value.
 *
 * Because the native loop owns BOTH the producer (the gateway stream fn) and the consumer
 * (the native Agent), this can be a plain native class — unlike pi-ai's class, whose
 * `private` fields made it nominally un-substitutable during the type-only migration.
 */

import type { AssistantMessage, AssistantMessageEvent } from "../model/types.js";

export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;
  private finalResultPromise: Promise<R>;
  private resolveFinalResult!: (r: R) => void;

  constructor(
    private isComplete: (event: T) => boolean,
    private extractResult: (event: T) => R,
  ) {
    this.finalResultPromise = new Promise<R>((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  push(event: T): void {
    if (this.done) return;
    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }
    const waiter = this.waiting.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.queue.push(event);
  }

  end(result?: R): void {
    this.done = true;
    if (result !== undefined) this.resolveFinalResult(result);
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      waiter?.({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift() as T;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) =>
          this.waiting.push(resolve),
        );
        if (result.done) return;
        yield result.value;
      }
    }
  }

  result(): Promise<R> {
    return this.finalResultPromise;
  }
}

export class AssistantMessageEventStream extends EventStream<
  AssistantMessageEvent,
  AssistantMessage
> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type for final result");
      },
    );
  }
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
  return new AssistantMessageEventStream();
}
