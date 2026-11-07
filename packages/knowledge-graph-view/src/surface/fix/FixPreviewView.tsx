/** What a deterministic fix would change: the files, and the lines it removes or adds when the host can tell. Lists the finding's files otherwise, and says so. */

import type { FixPreview } from '../../fixPorts';
import type { KnowledgeGraphLabels } from '../../labels';
import { counted } from '../plural';
import { cssVar } from '../../scene/themeColors';
import { muted } from '../../styles';
import { TYPE } from '../ui/type';

const lineTone = (line: string): string => cssVar(line.startsWith('+') ? 'agrees' : line.startsWith('-') ? 'violation' : 'muted');

export function FixPreviewView({ files, fromHost, labels }: { files: FixPreview['files']; fromHost: boolean; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.fix;
    return (
        <section aria-label={t.previewTitle} data-testid="kg-fix-preview" style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <span style={muted}>{counted(labels, 'file', files.length)}</span>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, ...TYPE.mono, minWidth: 0 }}>
                {files.map((f) => (
                    <li key={f.path} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        <span style={{ overflowWrap: 'anywhere' }}>
                            {f.path}
                            {f.removed ? <span style={{ color: cssVar('violation') }}>{` −${f.removed}`}</span> : null}
                            {f.added ? <span style={{ color: cssVar('agrees') }}>{` +${f.added}`}</span> : null}
                        </span>
                        {f.lines && f.lines.length > 0 && (
                            <pre style={{ margin: 0, padding: '2px 8px', borderRadius: 6, background: cssVar('plane'), overflowX: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                {f.lines.map((line, i) => <span key={i} style={{ display: 'block', color: lineTone(line) }}>{line}</span>)}
                            </pre>
                        )}
                    </li>
                ))}
            </ul>
            {!fromHost && <span style={muted}>{t.previewFromFiles}</span>}
        </section>
    );
}
