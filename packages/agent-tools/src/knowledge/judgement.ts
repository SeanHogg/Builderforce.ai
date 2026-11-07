/**
 * knowledge/judgement.ts — a `JudgementPort` over any text completion (PRD 38 §4.3): the
 * judgement pass of a review, for hosts that call a model themselves (VS Code: its local
 * engines first, then the gateway). Browser hosts and on-prem use the API's routed call
 * (`POST …/knowledge/judge`) instead, which asks the SAME questions with these prompts.
 *
 * One completion per item: `extract` asks a section for its claims and entities, `compare`
 * asks whether two near-duplicate claims contradict or agree. Every reply is validated with
 * memory's own validators (`validateExtract` / `validateCompare`); invalid output is dropped
 * and counted, never stored. Pure: the model is reached only through the injected call.
 */

import {
    validateCompare, validateExtract,
    type JudgementPort, type JudgementRequest, type JudgementResult,
} from '@seanhogg/builderforce-memory/knowledge';

/** Characters of section text sent per item — quotes are bounded to 3 lines anyway. */
export const MAX_JUDGE_TEXT = 8_000;

export const KNOWLEDGE_EXTRACT_SYSTEM = [
    'You read one section of a document and list what it asserts.',
    'Reply with JSON only: {"extract":[{"ref":<the ref given>,"claims":[{"subject","predicate","object","quote"}],"entities":[{"name","type"}]}]}.',
    'A claim is one factual assertion the text makes. "quote" is the supporting text, at most 3 lines, copied verbatim.',
    'Entities are the named things the section is about (people, organisations, systems, documents, terms).',
    'Return empty arrays when the section asserts nothing.',
].join('\n');

export const KNOWLEDGE_COMPARE_SYSTEM = [
    'You compare two claims.',
    'Reply with JSON only: {"compare":[{"a":<ref a>,"b":<ref b>,"relation":"contradicts"|"agrees"|"unrelated","confidence":<0..1>}]}.',
].join('\n');

/** One structured completion: the system prompt, the user turn (JSON), and the run's Stop. */
export type JudgeCompletion = (req: { system: string; user: string; signal?: AbortSignal }) => Promise<string>;

/** The JSON object in a model's reply (fenced or bare), or undefined when there is none. */
export function replyJson(text: string): unknown {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const body = fenced?.[1] ?? text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch {
        return undefined;
    }
}

/**
 * The ONE judgement loop (PRD 38 §4.3): every host — VS Code's local engines, the API's
 * routed `POST …/knowledge/judge` — asks these prompts through its own `ask`, which returns
 * the parsed JSON reply (or anything; it is validated here). Same prompts, same bounds,
 * same validation on every host.
 */
export async function judgeWith(
    ask: (system: string, payload: unknown) => Promise<unknown>,
    req: JudgementRequest,
): Promise<JudgementResult> {
    if (req.kind === 'compare') {
        const [a, b] = req.items;
        if (!a || !b) return { compare: [], invalid: 1 };
        const out = await ask(KNOWLEDGE_COMPARE_SYSTEM, {
            a: { ref: a.ref, claim: a.text.slice(0, MAX_JUDGE_TEXT) },
            b: { ref: b.ref, claim: b.text.slice(0, MAX_JUDGE_TEXT) },
        });
        const v = validateCompare(out, a.ref, b.ref);
        return {
            compare: v.relation ? [{ a: a.ref, b: b.ref, relation: v.relation, confidence: v.confidence }] : [],
            invalid: v.invalid,
        };
    }
    const result: JudgementResult = { extract: [], invalid: 0 };
    for (const item of req.items) {
        const out = await ask(KNOWLEDGE_EXTRACT_SYSTEM, { ref: item.ref, text: item.text.slice(0, MAX_JUDGE_TEXT) });
        const v = validateExtract(out, item.ref);
        result.invalid += v.invalid;
        result.extract!.push({ ref: item.ref, claims: v.claims, entities: v.entities });
    }
    return result;
}

/** A `JudgementPort` over a text completion: {@link judgeWith} with {@link replyJson}. */
export function completionJudgement(complete: JudgeCompletion): JudgementPort {
    return {
        judge: (req: JudgementRequest): Promise<JudgementResult> =>
            judgeWith(
                async (system, payload) =>
                    replyJson(await complete({ system, user: JSON.stringify(payload), ...(req.signal ? { signal: req.signal } : {}) })),
                req,
            ),
    };
}

/** Default ceiling for one judgement request before it is treated as unjudged (a stalled engine). */
export const DEFAULT_JUDGEMENT_TIMEOUT_MS = 60_000;

/**
 * The first port that answers: a port that THROWS (no engine running, signed out, a
 * refused call) hands the request to the next; a stopped review stops here. A port that
 * answers with invalid output has answered — that output is counted, not retried.
 */
export function fallbackJudgement(ports: ReadonlyArray<JudgementPort>): JudgementPort {
    return {
        async judge(req) {
            let last: unknown = new Error('knowledge: no judgement port');
            for (const port of ports) {
                try {
                    return await port.judge(req);
                } catch (error) {
                    if (req.signal?.aborted) throw error;
                    last = error;
                }
            }
            throw last;
        },
    };
}/** After the timer fires the real call is aborted; the wrapper waits up to this long (never more than the timeout itself) for it to end before it gives up on it (a port that ignores its signal). */
export const JUDGEMENT_ABORT_GRACE_MS = 10_000;

/** Thrown for a request that did not settle in time: a failed call (the section stays UNJUDGED and owed), never an answer. */
export class JudgementTimeout extends Error {
    constructor(ms: number) { super(`judge: timeout after ${Math.round(ms / 1000)}s`); this.name = "JudgementTimeout"; }
}

/**
 * Wrap a `JudgementPort` with a per-request timeout (PRD 41 A10 rule 9). A request that does not settle
 * within `ms` is ABORTED through a signal combined with the caller's, and the wrapper settles only once the
 * real call has ended (or after {@link JUDGEMENT_ABORT_GRACE_MS}), so the review's model limiter keeps its
 * slot for as long as the call really runs. It then THROWS {@link JudgementTimeout}: memory counts a thrown
 * call as an error and leaves the section unjudged — not recorded as judged — so a later run judges it again.
 * (An empty result used to be recorded as a judgement of nothing, and the section was never retried.)
 * A caller's abort passes through untouched.
 */
export function judgementWithTimeout(port: JudgementPort, ms: number = DEFAULT_JUDGEMENT_TIMEOUT_MS): JudgementPort {
    return {
        async judge(req: JudgementRequest): Promise<JudgementResult> {
            const own = new AbortController();
            const relay = (): void => own.abort(req.signal?.reason);
            if (req.signal?.aborted) relay(); else req.signal?.addEventListener("abort", relay, { once: true });
            const real = port.judge({ ...req, signal: own.signal });
            const giveUp = new Promise<"gave-up">((resolve) => {
                const t = setTimeout(() => { own.abort(new JudgementTimeout(ms)); const g = setTimeout(() => resolve("gave-up"), Math.min(JUDGEMENT_ABORT_GRACE_MS, ms)); (g as { unref?: () => void }).unref?.(); }, ms);
                void real.then(() => clearTimeout(t), () => clearTimeout(t));
            });
            try {
                const out = await Promise.race([real, giveUp]);
                if (out !== "gave-up") return out;
            } catch (error) {
                // The caller's abort, or the call's own failure, passes through; only OUR abort is a timeout.
                if (!(own.signal.reason instanceof JudgementTimeout) || req.signal?.aborted) throw error;
            } finally {
                req.signal?.removeEventListener("abort", relay);
            }
            throw new JudgementTimeout(ms);
        },
    };
}
