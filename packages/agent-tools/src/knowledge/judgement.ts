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
}
