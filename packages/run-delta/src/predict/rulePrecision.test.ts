import { describe, expect, it } from 'vitest';
import {
    DEMOTE_BOUND, MIN_VOTES_TO_MOVE, RESTORE_BOUND, RULE_PRECISION_MODEL_ID, RULE_PRECISION_PREDICTION_ID,
    evaluateRulePrecision, predictRulePrecision, shrinkRepoPosterior, tallyRuleVotes, type RuleVote,
} from './rulePrecision.js';

/** `n` votes, all on distinct lineages/voters, `tp` of them true positives. */
function votes(tp: number, fp: number): RuleVote[] {
    const out: RuleVote[] = [];
    for (let i = 0; i < tp; i++) out.push({ lineageId: `l${i}`, voterId: 'voter', tp: true });
    for (let i = 0; i < fp; i++) out.push({ lineageId: `m${i}`, voterId: 'voter', tp: false });
    return out;
}

describe('rule precision posterior (D3)', () => {
    it('a rule with 3 votes is never demoted', () => {
        // The "3 votes does not move" guarantee is the evidence floor (MIN_VOTES_TO_MOVE),
        // not a property of the credible bounds: even 0 TP / 3 FP at the flat prior, whose
        // upper bound sits below DEMOTE_BOUND, holds because 3 < 10 votes.
        const oneTpTwoFp = evaluateRulePrecision(1, 2);
        expect(oneTpTwoFp.decision).toBe('hold');
        const zeroTpThreeFp = evaluateRulePrecision(0, 3);
        expect(zeroTpThreeFp.decision).toBe('hold');
        expect(zeroTpThreeFp.posterior.high).toBeLessThan(DEMOTE_BOUND); // the floor, not the bound, saves it
        // At and just below the floor the rule this bad moves: the floor is what it says.
        expect(evaluateRulePrecision(0, MIN_VOTES_TO_MOVE).decision).toBe('demote');
        expect(evaluateRulePrecision(0, MIN_VOTES_TO_MOVE - 1).decision).toBe('hold');
    });

    it('a rule with 200 votes at 30% precision is demoted', () => {
        const { decision, posterior } = evaluateRulePrecision(60, 140);
        expect(decision).toBe('demote');
        expect(posterior.high).toBeLessThan(DEMOTE_BOUND);
        expect(posterior.mean).toBeGreaterThan(0.28);
        expect(posterior.mean).toBeLessThan(0.32);
    });

    it('restore fires when the lower bound rises above RESTORE_BOUND', () => {
        const { decision, posterior } = evaluateRulePrecision(190, 10);
        expect(decision).toBe('restore');
        expect(posterior.low).toBeGreaterThan(RESTORE_BOUND);
    });

    it('vote tally deduplicates by (lineage, voter), latest wins', () => {
        const all: RuleVote[] = [
            { lineageId: 'a', voterId: 'u1', tp: true },   // superseded by the later vote below
            { lineageId: 'a', voterId: 'u1', tp: false },  // latest wins → FP
            { lineageId: 'a', voterId: 'u2', tp: true },   // different voter, independent
            { lineageId: 'b', voterId: 'u1', tp: true },
        ];
        expect(tallyRuleVotes(all)).toEqual({ tp: 2, fp: 1 });
    });

    it('per-repo posterior shrinks toward the global one', () => {
        // The repo's effective prior is the global posterior re-scaled to `priorStrength`
        // pseudo-observations (empirical-Bayes shrinkage). The global's posterior mean is
        // preserved; what shrinks is how much a repo's own votes can move it, and a repo with
        // no votes of its own sits exactly at the global mean.
        const global = evaluateRulePrecision(900, 100).posterior; // 90% precision, tight
        // Full shrinkage: no repo votes ⇒ the repo mean IS the global mean.
        const empty = shrinkRepoPosterior(global, 0, 0);
        expect(empty.mean).toBeCloseTo(global.mean, 6);
        expect(empty.shrinkage).toBe(1);
        // The shrinkage share is the global's pseudo-evidence over the total: with no repo
        // votes it is 1 (fully global); adding repo votes dilutes it monotonically toward 0.
        const oneVote = shrinkRepoPosterior(global, 1, 0);
        expect(oneVote.shrinkage).toBeLessThan(empty.shrinkage);
        expect(oneVote.shrinkage).toBeGreaterThan(0);
        const manyVotes = shrinkRepoPosterior(global, 40, 40);
        expect(manyVotes.shrinkage).toBeLessThan(oneVote.shrinkage);
        // A small repo's own noisy votes dominate its posterior when the inherited prior is
        // light (the global prior mass is only `priorStrength` = 1 pseudo-observation), so a
        // repo that saw 10 straight false positives reflects that — it does NOT stay pinned to
        // the global mean. The point of shrinkage is the opposite case: with no votes the repo
        // sits exactly at the global mean, and its own rate pulls it off only in proportion to
        // how much evidence it has accumulated.
        const noisy = shrinkRepoPosterior(global, 0, 10);
        expect(noisy.mean).toBeLessThan(global.mean);
        expect(noisy.mean).toBeGreaterThan(0);
    });

    it('predictRulePrecision maps onto THE Prediction shape and honors the kill switch', () => {
        const ok = predictRulePrecision({ votes: votes(60, 140) });
        expect(ok.status).toBe('ok');
        expect(ok.decision).toBe('demote');
        expect(ok.prediction.id).toBe(RULE_PRECISION_PREDICTION_ID);
        expect(ok.prediction.modelId).toBe(RULE_PRECISION_MODEL_ID);
        expect(ok.prediction.status).toBe('ok');
        expect(ok.prediction.interval).toEqual([
            Math.round(ok.posterior.low * 1000) / 1000,
            Math.round(ok.posterior.high * 1000) / 1000,
        ]);
        expect(predictRulePrecision({ votes: votes(60, 140) }).prediction.inputDigest)
            .toBe(ok.prediction.inputDigest);

        const disabled = predictRulePrecision({ votes: votes(60, 140), disabled: true });
        expect(disabled.status).toBe('model-disabled');
        expect(disabled.prediction.status).toBe('model-disabled');

        const empty = predictRulePrecision({ votes: [] });
        expect(empty.status).toBe('insufficient-data');
        expect(empty.prediction.status).toBe('insufficient-data');
    });
});
