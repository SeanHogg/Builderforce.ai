/**
 * run-delta/sarifExport.ts — `RunDelta` → SARIF 2.1.0 (PRD 41 §C12), so GitHub code scanning, IDE SARIF
 * viewers and CI consume a delta.
 *
 *  - ONE `run` per tool: a finding imported from an external analyzer carries its tool in `params.tool`
 *    (the SARIF-import adapter sets it); every other finding is this engine's own ({@link RUN_DELTA_TOOL}).
 *  - `result.baselineState` from lineage: introduced → `new`, resolved → `absent`, changed → `updated`,
 *    persisting → `unchanged`. A `present` finding (no lineage, C9) carries none.
 *  - `partialFingerprints['anchor/v1']` = `identity.anchor`, the line-free identity a consumer matches on.
 *
 * Pure and deterministic: runs sorted by tool, results by rule then identity, rules by id. The message is
 * the rule id and its params — SARIF has no localized catalog for them, and the UI renders its own. An external
 * tool's finding is exported under that tool's own rule id (`params.sarifRule`); the delta rule id rides in
 * `properties.deltaRule`.
 */

import {
    ANCHOR_FINGERPRINT, sarifLocation, sarifLog,
    type SarifBaselineState, type SarifLevel, type SarifLog, type SarifResult, type SarifRun,
} from '@builderforce/sarif';
import type { DeltaFinding, DimensionId, Lineage, RunDelta, Severity } from './contract.js';
import { compareStr } from './engine/text.js';

/** The tool name of the engine's own rules. */
export const RUN_DELTA_TOOL = 'builderforce-run-delta';

const BASELINE: Readonly<Record<Lineage, SarifBaselineState | undefined>> = {
    introduced: 'new',
    resolved: 'absent',
    changed: 'updated',
    persisting: 'unchanged',
    present: undefined,
};

const LEVEL: Readonly<Record<Severity, SarifLevel>> = { error: 'error', warn: 'warning', info: 'note' };

export const baselineStateOf = (lineage: Lineage): SarifBaselineState | undefined => BASELINE[lineage];

function toolOf(f: DeltaFinding): string {
    const tool = f.params.tool;
    return typeof tool === 'string' && tool.trim() ? tool : RUN_DELTA_TOOL;
}

function messageOf(f: DeltaFinding): string {
    const params = Object.keys(f.params).filter((k) => k !== 'tool').sort(compareStr).map((k) => `${k}=${f.params[k]}`);
    return params.length ? `${f.ruleId} (${params.join(', ')})` : f.ruleId;
}

/**
 * The SARIF `ruleId`: an external tool's own rule (`params.sarifRule`, kept by the import) for its findings, so a
 * consumer sees the rule that tool reported; the engine's rule id otherwise.
 */
function sarifRuleOf(f: DeltaFinding): string {
    const external = f.params.sarifRule;
    return toolOf(f) !== RUN_DELTA_TOOL && typeof external === 'string' && external.trim() ? external : f.ruleId;
}

function resultOf(f: DeltaFinding, dimension: DimensionId): SarifResult {
    // A resolved finding exists only on the before side; every other lineage is read on the after side.
    const side = f.lineage === 'resolved' ? 'before' : 'after';
    const evidence = f.evidence.find((e) => e.side === side) ?? f.evidence[0];
    const baselineState = BASELINE[f.lineage];
    return {
        ruleId: sarifRuleOf(f),
        level: LEVEL[f.severity],
        message: { text: messageOf(f) },
        ...(evidence ? { locations: [sarifLocation(evidence.path, evidence.line, evidence.snippet)] } : {}),
        ...(baselineState ? { baselineState } : {}),
        partialFingerprints: { [ANCHOR_FINGERPRINT]: f.identity.anchor },
        properties: {
            dimension,
            deltaRule: f.ruleId,
            ruleVersion: f.ruleVersion,
            lineage: f.lineage,
            confidence: f.confidence,
            identity: f.identity.id,
            members: [...f.identity.members],
            ...(f.change ? { change: f.change } : {}),
            ...(f.waiver ? { waived: true } : {}),
        },
    };
}

/** The delta as one SARIF log. */
interface ToolEntry {
    results: Array<{ f: DeltaFinding; r: SarifResult }>;
    rules: Map<string, { dimension: DimensionId; version: number }>;
}

export function runDeltaToSarif(delta: RunDelta): SarifLog {
    const byTool = new Map<string, ToolEntry>();
    for (const d of delta.dimensions) {
        for (const f of d.findings) {
            const tool = toolOf(f);
            const entry: ToolEntry = byTool.get(tool) ?? { results: [], rules: new Map() };
            entry.results.push({ f, r: resultOf(f, d.id) });
            entry.rules.set(sarifRuleOf(f), { dimension: d.id, version: f.ruleVersion });
            byTool.set(tool, entry);
        }
    }
    const versions = new Map<string, string>();
    for (const d of delta.dimensions) for (const m of d.measuredBy) if (m.status === 'ok' && !versions.has(m.tool)) versions.set(m.tool, m.version);

    const runs: SarifRun[] = [...byTool.keys()].sort(compareStr).map((tool) => {
        const entry = byTool.get(tool)!;
        const version = tool === RUN_DELTA_TOOL ? String(delta.version) : versions.get(tool);
        return {
            tool: {
                driver: {
                    name: tool,
                    ...(version ? { version } : {}),
                    rules: [...entry.rules].sort((a, b) => compareStr(a[0], b[0]))
                        .map(([id, rule]) => ({ id, properties: { dimension: rule.dimension, ruleVersion: rule.version } })),
                },
            },
            automationDetails: { id: `run-delta/${delta.runId}` },
            results: entry.results
                .sort((a, b) => compareStr(a.r.ruleId, b.r.ruleId) || compareStr(a.f.identity.id, b.f.identity.id) || compareStr(a.f.lineage, b.f.lineage))
                .map((x) => x.r),
            properties: { runId: delta.runId, digest: delta.digest, headline: delta.headline },
        };
    });
    return sarifLog(runs);
}
