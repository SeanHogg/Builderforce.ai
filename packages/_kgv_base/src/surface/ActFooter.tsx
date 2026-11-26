/**
 * The Act rail's path parts, both only for a path with at least one hop (a single stop has nothing to
 * test and nothing to finish): the "Keep this run as a test" card, and the pinned "This path is done
 * when…" footer with one checkable line per finding on the path.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { counted } from './plural';
import { cssVar } from '../scene/themeColors';
import { acceptanceChecks, testRequestFor } from './actModel';
import type { PathModel } from './path';
import { smallButton } from './ActCards';
import { Card } from './ui';
import type { Partners } from './coChange';
import { PartnerList } from './PartnerList';
import { TYPE } from './ui/type';

/** A path worth keeping as a test or finishing: it has at least one hop. */
export const hasHops = (path: PathModel | null | undefined): path is PathModel => !!path && path.hops.length >= 1;

export interface PathPartProps {
    path: PathModel;
    pathName: string;
    findings: readonly Finding[];
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
}

export function KeepTestCard({ path, pathName, findings, labels, index, onCompose }: PathPartProps & { onCompose(text: string): void }) {
    const t = labels.surface.act;
    return (
        <Card as="section" label={t.keepTitle} style={{ display: 'grid', gap: 6 }}>
            <strong style={TYPE.bodyLarge}>{t.keepTitle}</strong>
            <p style={{ ...TYPE.bodyMuted, margin: 0, overflowWrap: 'anywhere' }}>{fillTemplate(t.keepBody, { path: pathName })}</p>
            <div><button type="button" data-act="keep-test" style={smallButton} onClick={() => onCompose(testRequestFor(path, pathName, findings, labels, index))}>{t.keepButton}</button></div>
        </Card>
    );
}

export function DoneWhen({ findings, labels, index, partners }: Pick<PathPartProps, 'findings' | 'labels' | 'index'> & { partners?: Partners | undefined }) {
    const t = labels.surface.act;
    const done = acceptanceChecks(findings, labels, index);
    return (
        <footer data-testid="kg-done-when" style={{ flex: 'none', padding: '10px 12px', borderTop: `1px solid ${cssVar('border')}`, background: cssVar('panel'), display: 'grid', gap: 6 }}>
            <h3 style={{ ...TYPE.subtitle }}>{t.doneTitle}</h3>
            {done.checks.length === 0 ? <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.doneNone}</p> : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                    {done.checks.map((c) => (
                        <li key={c} style={{ ...TYPE.body, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <span aria-hidden="true" style={{ flex: 'none', width: 12, height: 12, marginTop: 2, borderRadius: 3, border: `1.5px solid ${cssVar('edge')}` }} />
                            <span style={{ overflowWrap: 'anywhere' }}>{c}</span>
                        </li>
                    ))}
                </ul>
            )}
            {done.more > 0 && <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{counted(labels, 'moreChecks', done.more)}</p>}
            {partners !== undefined && (
                <section aria-label={labels.surface.predict.partnersTitle} data-testid="kg-done-partners" style={{ display: 'grid', gap: 4 }}>
                    <span style={TYPE.meta}>{labels.surface.predict.partnersTitle}</span>
                    <PartnerList partners={partners} labels={labels} template={labels.surface.predict.doneAlso} none={labels.surface.predict.partnersNone} />
                </section>
            )}
        </footer>
    );
}
