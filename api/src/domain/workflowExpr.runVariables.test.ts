import { describe, it, expect } from 'vitest';
import {
  RUN_VARIABLES_KEY, contextFromInput, evaluateBool, referencesRunVariables, renderTransform, renderValueTemplate,
  withRunVariables,
} from './workflowExpr';

describe('referencesRunVariables', () => {
  it('is true only when an expression names $vars', () => {
    expect(referencesRunVariables(['{"id": {{ json $vars.orderId }}}'])).toBe(true);
    expect(referencesRunVariables(['order.id', '', null, undefined])).toBe(false);
  });

  it('looks inside non-string config (router routes authored as an array)', () => {
    expect(referencesRunVariables([[{ name: 'vip', condition: '$vars.tier == "gold"' }]])).toBe(true);
    expect(referencesRunVariables([[{ name: 'vip', condition: 'tier == "gold"' }]])).toBe(false);
  });
});

describe('withRunVariables', () => {
  const vars = { orderId: '7', status: 'ready', order: '{"id":7,"lines":[{"sku":"A"}]}' };

  it('lets a DATA IN mapping read a variable published steps earlier, not only the payload in front of it', () => {
    const ctx = withRunVariables(contextFromInput('{"customer":{"email":"a@b.com"}}'), vars);
    const out = renderTransform('{"order": {{ json $vars.orderId }}, "who": {{ json customer.email }}}', '', ctx);
    expect(JSON.parse(out)).toEqual({ order: '7', who: 'a@b.com' });
  });

  it('reaches into a variable that holds a JSON object', () => {
    const ctx = withRunVariables(contextFromInput('{}'), vars);
    expect(renderValueTemplate('{{ $vars.order.id }}/{{ $vars.order.lines[0].sku }}', '', ctx)).toBe('7/A');
  });

  it('evaluates predicates over variables', () => {
    const ctx = withRunVariables(contextFromInput('{"n":3}'), vars);
    expect(evaluateBool('$vars.status == "ready" && n > 2', ctx)).toBe(true);
    expect(evaluateBool('$vars.missing', ctx)).toBe(false);
  });

  it('cannot be shadowed by a payload that carries its own $vars field', () => {
    const ctx = withRunVariables(contextFromInput('{"$vars":{"orderId":"forged"}}'), vars);
    expect(renderTransform(`${RUN_VARIABLES_KEY}.orderId`, '', ctx)).toBe('7');
  });

  it('keeps a malformed JSON-looking value as the text it is', () => {
    const ctx = withRunVariables(contextFromInput('{}'), { broken: '{not json' });
    expect(renderTransform('$vars.broken', '', ctx)).toBe('{not json');
  });
});
