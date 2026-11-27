import type { KnowledgeGraphLabels } from '../../labels';
import type { AgentRunReport } from '../../types';
import type { DiagramId } from './catalog';
import type { Diagram } from './model';

export const RUN_DIAGRAMS = new Set<DiagramId>(['sequenceDiagram', 'msc', 'communicationDiagram', 'timingDiagram', 'bpmnProcess', 'flowchart', 'activityDiagram', 'interactionDiagram']);

/** Recorded turn order and elapsed time. The port provides turn summaries, without method-level spans or heap objects. */
export function agentRunDiagram(id: DiagramId, report: AgentRunReport, labels: KnowledgeGraphLabels): Diagram {
    const turns = report.turns.slice(0, 100);
    const t = labels.surface.agentRuns;
    let elapsed = 0;
    const nodes = turns.map((turn, i) => {
        const millis = Number.isFinite(turn.durationMs) ? Math.max(0, turn.durationMs) : 0;
        const x = elapsed;
        elapsed += millis;
        return { id: String(i), label: `${turn.index} · ${turn.role}`, kind: turn.kind === 'failed' ? 'event' : 'activity',
            ...(id === 'timingDiagram' ? { x, y: 70 + 60 * (i % 4) } : {}), members: [
                { text: turn.model }, { text: t.turnKinds[turn.kind] }, { text: `${(millis / 1000).toFixed(2)} s` },
            ].filter((member) => member.text) };
    });
    return { nodes, edges: turns.slice(1).map((turn, i) => ({ from: String(i), to: String(i + 1), kind: 'sequenceFlow', label: t.turnKinds[turn.kind] })) };
}
