import { describe, it, expect } from 'vitest';
import {
  PERSONA_MODALITY_IDS,
  MODALITY_PERSONAS,
  DEFAULT_PERSONA,
  BRAIN_AGENT_ASSIGNMENTS_PATH,
  modalityPersonaChoice,
  agentPersonaChoice,
  personaModalityOf,
  personaAgentOf,
  personaSystemPrompt,
  personaOverlay,
  personaModel,
  brainPersonaAgents,
  loadBrainPersonaAgentsVia,
  type BrainPersonaAgent,
} from './brainPersona';
import { AGENT_POOL_PATHS, type PoolAgent } from './agentPool';

const reviewer: BrainPersonaAgent = { kind: 'workforce', ref: '12', name: 'Reviewer', baseModel: 'anthropic/claude-sonnet-5' };
const plain: BrainPersonaAgent = { kind: 'registered', ref: '3', name: 'Ops Bot', baseModel: null };

describe('modality personas', () => {
  it('gives every modality a glyph and a prompt carrying the strategy note', () => {
    for (const id of PERSONA_MODALITY_IDS) {
      expect(MODALITY_PERSONAS[id].icon).toBeTruthy();
      expect(MODALITY_PERSONAS[id].prompt).toContain('OKRs/Objectives');
    }
  });

  it('decodes a modality choice, and rejects an unknown id', () => {
    expect(personaModalityOf(modalityPersonaChoice('mobile'))).toBe('mobile');
    expect(personaModalityOf('modality:video')).toBeNull();
    expect(personaModalityOf(DEFAULT_PERSONA)).toBeNull();
  });
});

describe('applying a persona', () => {
  const agents = [reviewer, plain];

  it('default persona leaves the host prompt alone', () => {
    expect(personaSystemPrompt(DEFAULT_PERSONA, agents)).toBeUndefined();
    expect(personaOverlay(DEFAULT_PERSONA, agents)).toBeUndefined();
    expect(personaModel(DEFAULT_PERSONA, agents)).toBeUndefined();
  });

  it('a modality persona replaces the web prompt and LAYERS over the editor prompt', () => {
    const choice = modalityPersonaChoice('designer');
    expect(personaSystemPrompt(choice, agents)).toBe(MODALITY_PERSONAS.designer.prompt);
    const overlay = personaOverlay(choice, agents)!;
    // The overlay keeps the persona text but tells the model its real environment wins.
    expect(overlay).toContain(MODALITY_PERSONAS.designer.prompt);
    expect(overlay.indexOf('the ones above are what you actually have')).toBeLessThan(overlay.indexOf(MODALITY_PERSONAS.designer.prompt));
  });

  it('an agent persona frames the Brain as that agent and routes to its model', () => {
    const choice = agentPersonaChoice(reviewer);
    expect(personaAgentOf(choice, agents)).toEqual(reviewer);
    expect(personaSystemPrompt(choice, agents)).toContain('"Reviewer" agent');
    expect(personaOverlay(choice, agents)).toBe(personaSystemPrompt(choice, agents));
    expect(personaModel(choice, agents)).toBe('anthropic/claude-sonnet-5');
    expect(personaModel(agentPersonaChoice(plain), agents)).toBeUndefined();
  });

  it('a choice naming an agent that is no longer assigned applies nothing', () => {
    const gone = agentPersonaChoice({ kind: 'workforce', ref: '99' });
    expect(personaSystemPrompt(gone, agents)).toBeUndefined();
    expect(personaModel(gone, agents)).toBeUndefined();
  });
});

describe('brainPersonaAgents', () => {
  const pool: PoolAgent[] = [
    { kind: 'workforce', ref: '12', name: 'Reviewer', meta: 'QA', baseModel: 'anthropic/claude-sonnet-5' },
  ];

  it('names each assignment from the pool, falling back to kind:ref', () => {
    expect(brainPersonaAgents([{ agentKind: 'workforce', agentRef: '12' }, { agentKind: 'registered', agentRef: '5' }], pool)).toEqual([
      { kind: 'workforce', ref: '12', name: 'Reviewer', baseModel: 'anthropic/claude-sonnet-5' },
      { kind: 'registered', ref: '5', name: 'registered:5', baseModel: null },
    ]);
  });

  it('lists an agent assigned twice once', () => {
    expect(brainPersonaAgents([{ agentKind: 'workforce', agentRef: '12' }, { agentKind: 'workforce', agentRef: '12' }], pool)).toHaveLength(1);
  });
});

describe('loadBrainPersonaAgentsVia', () => {
  it('joins the Brain assignments to the pool through the host transport', async () => {
    const responses: Record<string, unknown> = {
      [BRAIN_AGENT_ASSIGNMENTS_PATH]: { assignments: [{ agentKind: 'workforce', agentRef: '12' }] },
      [AGENT_POOL_PATHS.owned]: [{ id: 12, name: 'Reviewer', title: 'QA', base_model: 'builderforce-default' }],
      [AGENT_POOL_PATHS.purchased]: [],
      [AGENT_POOL_PATHS.registered]: [],
    };
    const request = async <T,>(path: string): Promise<T> => responses[path] as T;
    await expect(loadBrainPersonaAgentsVia(request)).resolves.toEqual([
      { kind: 'workforce', ref: '12', name: 'Reviewer', baseModel: null },
    ]);
  });

  it('degrades to no agents when the transport fails', async () => {
    const request = async <T,>(): Promise<T> => { throw new Error('offline'); };
    await expect(loadBrainPersonaAgentsVia(request)).resolves.toEqual([]);
  });
});
