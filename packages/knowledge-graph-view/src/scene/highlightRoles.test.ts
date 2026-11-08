import { describe, expect, it } from 'vitest';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { highlightFor } from '../surface/towerHighlight';
import type { Body } from './channels';
import { applyRoles } from './highlightRoles';

const body = (ref: string): Body => ({ ref, x: 0, y: 0, z: 0, radius: 1, height: 1, tone: 'nodeFile', dim: false, shell: false });
const f = (kind: string, nodes: string[]): Finding => ({ id: nodes.join('|'), kind, pack: 'code', nodes: nodes as Finding['nodes'], severity: 'warn', params: {} });

describe('Tower highlight roles', () => {
    it('a layer violation lights its first file as the offender and what it reaches into as partner; a god module is its own offender', () => {
        const h = highlightFor([f('partition-violation', ['a', 'b']), f('god-module', ['c'])]);
        expect([...h.roles]).toEqual([['a', 'offender'], ['b', 'partner'], ['c', 'offender']]);
    });

    it('an offender is never demoted to partner', () => {
        const h = highlightFor([f('partition-violation', ['a', 'b']), f('partition-violation', ['c', 'a'])]);
        expect(h.roles.get('a')).toBe('offender');
    });

    it('paints offenders violation, partners partner and dims everything else; no roles leaves the bodies alone', () => {
        const bodies = [body('a'), body('b'), body('z')];
        const out = applyRoles(bodies, new Map([['a', 'offender'], ['b', 'partner']]));
        expect(out.map((b) => [b.tone, b.dim])).toEqual([['violation', false], ['partner', false], ['nodeFile', true]]);
        expect(applyRoles(bodies, undefined)).toBe(bodies);
    });
});
